# Architecture & Design Document: AI-powered Gmail Intelligence Platform

This document describes the design principles, architectural schemas, AI pipelines, and strategic choices made in building the platform.

---

## 1. System Architecture

The system follows a decoupled, service-oriented full-stack structure that maintains a clear separation of concerns between client interaction, data storage, network synchronization, and cognitive AI services.

```
+--------------------------------------------------------+
|                      CLIENT LAYER                      |
|                 Vite + React Frontend                  |
|          (Vanilla CSS UI + Responsive Views)           |
+---------------------------+----------------------------+
                            | HTTP / OAuth Redirects
                            v
+--------------------------------------------------------+
|                     BACKEND LAYER                      |
|                  Node.js / Express                     |
|                                                        |
|  +--------------------+      +----------------------+  |
|  |   Auth Controller  |      |   Threads Controller |  |
|  +--------------------+      +----------------------+  |
|  |  Emails Controller |      |     Chat Controller  |  |
|  +--------------------+      +----------------------+  |
|                                                        |
|                 Background Sync Task                   |
|           (Throttling + Paginated Sync)                |
+--------+------------------+------------------+---------+
         |                  |                  |
         | Read/Write       | Google APIs      | Cognition / Embeddings
         v                  v                  v
+--------+-------+  +-------+-------+  +-------+-------+
| DATABASE LAYER |  | EXTERNAL API  |  |   AI ENGINE   |
| Supabase Cloud |  |   Gmail API   |  | Google Gemini |
|   (Postgres +  |  |  (OAuth 2.0)  |  |  + NVIDIA NIM |
|   pgvector)    |  |               |  |  (Llama 3.1)  |
+----------------+  +---------------+  +---------------+
```

### Components and Interactions
1. **React Frontend**: Communicates with the Express backend via JSON REST calls. It maintains user context by extracting the database `userId` upon Google OAuth redirect and persisting it in browser local storage.
2. **Express Backend**: Contains a set of API controllers and houses our custom email sync coordinator. It uses a non-blocking background queue to sync, process, and summarize emails.
3. **Database (Supabase)**: Serves as our persistent layer. The postgres DB is augmented with `pgvector` columns and index configurations for instant semantic indexing and vector-similarity lookup.
4. **Google Gmail API**: Accessed using the Google APIs client library. Authorized credentials are automatically evaluated and refreshed on-demand by the backend before interacting with Google APIs.
5. **AI Engine**:
   - **Google Gemini API**: Utilized for text-to-vector embeddings (`text-embedding-004`), conversational message drafting, and multi-document synthesis (RAG pipeline).
   - **NVIDIA NIM API**: An OpenAI-compatible endpoint hosting `meta/llama-3.1-8b-instruct`. It handles low-latency, high-throughput few-shot categorization and semantic newsletter deduplication.

---

## 2. Database Schema

Our Supabase schema uses three highly indexed relational tables: `users`, `threads`, and `emails`.

### SQL Definition
Please refer to the complete SQL schema in [schema.sql](schema.sql).

### Data Modeling Justifications
- **`users` Table**: Stores the OAuth access token, encrypted refresh token, and token expiration timestamps. It also maintains a `sync_status` state (`'idle'`, `'syncing'`, `'completed'`, `'failed'`) allowing the UI to display live feedback, alongside `last_sync_time` for delta calculations.
- **`threads` Table**: Represents conversation threads as first-class citizens. By indexing `user_id` and `updated_at`, we ensure sub-millisecond retrieval of the main inbox view. It houses a `summary` column storing the thread-level conversation arc summary.
- **`emails` Table**: Stores individual email messages. It maps the parent `thread_id` and the owner `user_id` with cascading deletes. The `embedding` column is of type `vector(768)`.
- **HNSW Indexing**: We configure a Hierarchical Navigable Small World (HNSW) index on the `emails.embedding` column (`hnsw (embedding vector_cosine_ops)`). HNSW is superior to IVFFlat for dynamic datasets because it does not require a training phase and provides high-recall fast searches even as emails are continuously synced.

### Embedding Strategy
We generate text embeddings on a compiled string of each email:
`From: [Sender] | Subject: [Subject] | Summary: [Summary] | Snippet: [Snippet]`
By embedding the *AI-generated summary* together with the sender and subject, we ensure that semantic search captures high-level conceptual requests even if the email body contains verbose formatting or long corporate templates. We set the vector dimension size to **768** to match Google's `text-embedding-004` output.

---

## 3. AI Design & Prompt Engineering

### Email Summarization Strategy
- **Individual Emails**: Summaries must be quick and action-oriented. We supply the parsed body text to Gemini `gemini-1.5-flash` with strict length limits (2-3 sentences).
- **Threads (Conversation Arc)**: To summarize a thread, we fetch all synced email records for that thread and sort them chronologically. We construct a sequence listing the sender, date, and body text. The LLM prompt instructs the model to describe the trajectory of the conversation: *what was initially requested, how the parties responded, and what was decided/resolved*.

### RAG Pipeline & Chat Agent Design
1. **Query Intent Parsing**: The user's query is first sent to Gemini. It acts as an intent parser, extracting structural criteria: sender name, date limits, category requirements, or pure keywords.
2. **Hybrid Retrieval**:
   - If structured filters are extracted, we generate a target SQL query against the database (e.g. searching emails `where user_id = X and date >= Y`).
   - Concurrently, we embed the query and execute a cosine-similarity similarity search using Supabase RPC `match_emails(query_embedding, threshold, limit)`.
   - We merge the lists, eliminating duplicates. This hybrid approach ensures that queries like *"find invoices from last week"* return exact metadata matches, while *"what projects are slipping"* returns conceptual matches.
3. **Source Attribution**: We format the merged context block explicitly, prefixing each entry with a clear citation header: `Source [1] (Message ID: x, Sender: y, Date: z)`. The LLM system prompt mandates that the agent answers *only* using these sources and places citation numbers (e.g., `[1]`, `[2]`) next to every synthesized claim.
4. **Hallucination Prevention**: If the context is empty or the retrieved emails do not contain information related to the question, the prompt forces the LLM to output a standard fallback: *"I cannot find this information in your email archives."*

### NVIDIA NIM Integration
We select **`meta/llama-3.1-8b-instruct`** on NVIDIA NIM.
- **Role**: High-speed, high-throughput text operations—specifically **Email Categorization** and **Newsletter Deduplication**.
- **Justification**: Email classification and newsletter clustering run in loops during synchronization. Running them on Llama 8B hosted on NIM's low-latency developer infrastructure saves our Google Gemini token quotas. It optimizes costs and improves synchronization speed while yielding accurate classification.

### Newsletter Deduplication (Bonus)
1. We query all emails under the `Newsletters` category for the specified date range.
2. We feed the emails' sender, subject, and content to NVIDIA NIM.
3. The prompt instructs Llama 3.1 to scan the articles, identify stories discussing the same global news events (even with different headlines), merge them into a single synthesized topic, and list all original senders as sources.
4. The output is parsed directly into a JSON structure for the frontend feed.

---

## 4. Gmail API Strategy

### Initial vs. Incremental Sync
- **Initial Sync**: Lists the latest 100 messages for the user. It extracts unique thread IDs, fetches each thread's complete history, runs categorization/summarization, generates embeddings, and saves records.
- **Incremental Sync**: When a synced user triggers a reload, we read their `last_sync_time` from Supabase and query the Gmail list endpoint with `q=after:[timestamp]`. This fetches only messages received since the last execution, performing a delta update, avoiding redundant reprocessing of old emails, and preserving API quotas.

### Pagination
We fetch lists of messages page-by-page. The sync loops using Google's `nextPageToken` as the list cursor. To keep the developer assessment responsive and avoid hitting rate limits, we set a default cap of 100 messages for initial synchronization.

### Rate Limiting and Quota Management
- Google Gmail API enforces strict user rate limits (e.g., 250 quota points per user per second).
- To prevent `429 Too Many Requests` or quota exceptions, our `syncService.js` wraps all external calls in an **exponential backoff retry utility** (`retryWithBackoff`).
- If a rate limit error is thrown, the handler detects the error, pauses execution using an asynchronous sleep timer, and retries the call. The wait time starts at 1-2 seconds and doubles for subsequent retries (up to 3 attempts), ensuring the system recovers from transient API throttling.

---

## 5. Tool & Technology Decisions

- **React + Vite**: Vite offers near-instant hot module replacement and compilation, providing a productive environment for developing React SPAs.
- **Supabase Cloud**: Offers a managed PostgreSQL database with native `pgvector` support, which simplifies deployment and avoids hosting a separate vector database.
- **Vanilla CSS (App.css)**: Chosen to fulfill the instruction for premium, flexible styling. It avoids the overhead of CSS compilation tools and provides direct control over glassmorphism backdrops, gradients, and custom animations.
- **OpenAI Node SDK (for NVIDIA NIM)**: NVIDIA NIM utilizes an OpenAI-compatible spec, which allows us to use the official `openai` NPM package to query Llama 3.1 easily.

---

## 6. Trade-offs & Limitations

1. **Local Sync vs. Cron Jobs**: In a production enterprise app, synchronization would be handled by a queue broker (like BullMQ or RabbitMQ) run by background worker processes. For this assignment, we implement sync as an asynchronous, non-blocking promise loop directly inside Express. This removes dependencies on external queues or Redis, while still keeping backend API calls responsive.
2. **Mail Storage Cap**: We cap the message retrieval limit to the latest 100 emails to ensure the initial sync completes quickly during assessment evaluation. In production, this cap would be removed, and a paginated sync queue would run continuously.
3. **Drafting Format**: We support HTML draft composing and sending, which covers formatting requirements, but we do not parse attachments or inline image attachments, focusing instead on core email text intelligence.
