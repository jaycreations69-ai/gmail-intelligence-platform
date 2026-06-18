# Gmail Intelligence Platform

An advanced, AI-powered Gmail executive dashboard that syncs your inbox, summarizes messages & threads, enables context-aware replies preserving thread headers, automatically classifies messages by category, and integrates an AI Chat Agent (RAG pipeline) that cites sources and reasons across your emails.

This platform was built as part of the Repeatless AI Automation Executive assignment.

---

## Folder & Module Structure

```
gmail-intelligence-platform/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── supabase.js     # Supabase initialization client
│   │   ├── services/
│   │   │   ├── gmailService.js  # OAuth, MIME generation, message fetching
│   │   │   ├── geminiService.js # Summarization, embeddings, RAG responses
│   │   │   ├── nvidiaService.js # Llama email categorization & news dedup
│   │   │   └── syncService.js   # Paginated and incremental sync coordinator
│   │   ├── routes/
│   │   │   ├── authRoutes.js    # Google OAuth flow & sync status
│   │   │   ├── threadRoutes.js  # Thread queries & category filters
│   │   │   ├── emailRoutes.js   # Compose & reply generation/sending
│   │   │   ├── chatRoutes.js    # AI Chat Agent RAG endpoint
│   │   │   └── newsRoutes.js    # Newsletter semantic deduplication
│   │   └── index.js             # Server entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main React SPA component
│   │   ├── App.css              # Cyber-slate dark-mode CSS styling
│   │   └── main.jsx             # React DOM entry point
│   ├── index.html               # Main template
│   ├── vite.config.js           # Vite server configuration
│   └── package.json
├── schema.sql                   # SQL script to initialize Supabase
├── Architecture.md              # Detailed Design & Architecture document
└── .env.example                 # Template for local environment configuration
```

---

## Technical Stack

- **Frontend**: React + Vite (Vanilla CSS styling with premium dark-mode glassmorphic aesthetics).
- **Backend**: Node.js + Express (Modular service architecture).
- **Database**: Supabase (PostgreSQL with `pgvector` for semantic search).
- **Primary Text Engine**: NVIDIA NIM (`meta/llama-3.1-8b-instruct` for email/thread summarization, reply compose drafts, query parsing, and conversational RAG response generation).
- **Embedding Engine**: Google Gemini (`gemini-embedding-001` with custom 768 output dimensionality for semantic pgvector search).

---

## Setup & Local Run Instructions

### 1. Database Setup (Supabase)
1. Create a project at [Supabase](https://supabase.com).
2. Go to the **SQL Editor** tab in your Supabase dashboard.
3. Paste the contents of the [schema.sql](schema.sql) file and click **Run**. This will enable the `vector` extension and configure the tables, indexes, and similarity matching function.

### 2. Google Cloud OAuth Credentials Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Create a project and enable the **Gmail API** (APIs & Services -> Library).
3. Set up your **OAuth consent screen** (Internal or External with test users added). Ensure you add scopes:
   - `.../auth/userinfo.email`
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.modify`
   - `.../auth/gmail.compose`
   - `.../auth/gmail.send`
4. Create an **OAuth 2.0 Client ID** (Application Type: *Web Application*).
5. Set the Authorized Redirect URIs to:
   - `http://localhost:5000/api/auth/google/callback`

### 3. Clone and Install Dependencies
Open your terminal and run:

```bash
# Clone the project (if downloading as zip, navigate into folder)
cd gmail-intelligence-platform

# Install Backend dependencies
cd backend
npm install

# Install Frontend dependencies
cd ../frontend
npm install
```

### 4. Configure Environment Variables
Create a `.env` file in the **backend** directory (copy the template from `.env.example` in the root) and populate your credentials:

```env
PORT=5000
FRONTEND_URL=http://localhost:5173

# Supabase URL & Service Role Key (from Supabase -> API Settings)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyxxxx...

# Google Cloud OAuth Credentials
GOOGLE_CLIENT_ID=xxxx-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOxxxx-xxxx
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Gemini API Key (from Google AI Studio)
GEMINI_API_KEY=AIzaSy...

# NVIDIA NIM API Key (from build.nvidia.com)
NVIDIA_API_KEY=nvapi-...
```

### 5. Running the Application Locally

Run the backend and frontend servers in separate terminals:

**Terminal 1 (Backend API)**:
```bash
cd backend
npm run dev
# Starts server on http://localhost:5000
```

**Terminal 2 (Frontend UI)**:
```bash
cd frontend
npm run dev
# Starts server on http://localhost:5173
```

Now, navigate to **`http://localhost:5173`** in your browser to explore the platform!

---

## OAuth Testing & Evaluation Guide (For Graders / Reviewers)

When running the system locally or evaluating it, you will set up your own **Google Cloud Console OAuth Credentials**. By default, Google Cloud puts new OAuth applications in **"Testing"** mode.

### Option A: Testing Mode (Recommended for Single Evaluator)
If you keep the OAuth Consent Screen in **Testing** mode:
1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Navigate to **APIs & Services** -> **OAuth Consent Screen**.
3. Under the **Test Users** section, click **Add Users**.
4. Add the Gmail address of the account you plan to use for testing.
5. Only accounts added here will be allowed to log in; others will receive a `403 Access Blocked: project is in testing` error from Google.

### Option B: Publish App (Recommended for Public Testing)
If you want **any Google account** to be able to sign up and test your project:
1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Navigate to **APIs & Services** -> **OAuth Consent Screen**.
3. Under **Publishing status**, click the **Publish App** button and confirm.
4. Now, any Gmail user can sign in. Note: Users will see a warning screen saying *"Google hasn't verified this app"*. You can safely bypass this during grading by clicking **Advanced** -> **Go to [App Name] (unsafe)**.

