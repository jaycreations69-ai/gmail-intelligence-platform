import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Google Gemini Config (used for embeddings)
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is missing from environment.');
}
const genAI = new GoogleGenerativeAI(apiKey || '');

// NVIDIA NIM Config (used for text generation)
const nvidiaKey = process.env.NVIDIA_API_KEY;
if (!nvidiaKey) {
  console.warn('Warning: NVIDIA_API_KEY is missing from environment.');
}
const nvidiaClient = new OpenAI({
  apiKey: nvidiaKey || 'dummy-key',
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

// Helper to check for API rate limit errors
function isRateLimitError(err) {
  if (!err) return false;
  const errMsg = err.message || '';
  return err.status === 429 || 
         errMsg.includes('429') || 
         errMsg.toLowerCase().includes('rate limit') ||
         errMsg.toLowerCase().includes('quota') ||
         errMsg.toLowerCase().includes('exceeded');
}

// Generate text embedding using gemini-embedding-001 (dimension 768)
export async function generateEmbedding(text) {
  if (!text || text.trim() === '') {
    return new Array(768).fill(0); // Return zero vector for empty text
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    const cleanText = text.substring(0, 8000); // Limit text length to prevent token issues
    const result = await model.embedContent({
      content: { parts: [{ text: cleanText }] },
      outputDimensionality: 768
    });
    if (result && result.embedding && result.embedding.values) {
      let values = result.embedding.values;
      if (values.length > 768) {
        values = values.slice(0, 768); // Defensive slicing
      }
      return values;
    }
    throw new Error('Invalid embedding response from Gemini');
  } catch (err) {
    console.error('Error generating embedding with Gemini:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    // Return dummy 768 size vector if it fails to avoid breaking database inserts
    return new Array(768).fill(0);
  }
}

// Generate summary for a single email message (NVIDIA NIM Llama 3.1)
export async function generateSummary(emailText, subject) {
  if (!emailText || emailText.trim() === '') {
    return 'Empty email content.';
  }

  try {
    const prompt = `You are a professional email assistant. Summarize the following email in a concise, action-oriented way (2 to 3 sentences max).
    Subject: ${subject || 'No Subject'}
    Email Content:
    ${emailText.substring(0, 5000)}
    
    Summary:`;
    
    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150
    });
    
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error generating email summary:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    return 'Summary unavailable.';
  }
}

// Generate thread summary explaining the conversation arc (NVIDIA NIM Llama 3.1)
export async function generateThreadSummary(messages) {
  if (!messages || messages.length === 0) {
    return 'No conversation messages.';
  }

  try {
    const formattedMessages = messages
      .map((m, idx) => `[Message ${idx + 1}] From: ${m.from_name || m.from_address} | Date: ${m.date}\nContent:\n${m.body_text || m.snippet}`)
      .join('\n\n---\n\n');

    const prompt = `You are a professional email assistant. Generate a thread-level summary that captures the full conversation arc of this email thread. 
    Explain what was requested, how the conversation progressed, and what the final resolution or current status is. Write a concise paragraph (3-4 sentences max).

    Thread History:
    ${formattedMessages.substring(0, 10000)}
    
    Thread Summary:`;

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 250
    });
    
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error generating thread summary:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    return 'Thread summary unavailable.';
  }
}

// Generate new email draft based on prompt (NVIDIA NIM Llama 3.1)
export async function generateNewEmailDraft(promptText) {
  try {
    const prompt = `You are a professional email assistant. Generate a complete, polished, and professional email based on the following instruction.
    Include a suitable Subject line, followed by the email body. Format it clearly (using HTML line breaks or paragraphs if helpful, or plain text with double newlines).
    
    Instruction: "${promptText}"
    
    Generate output in JSON format with two fields: "subject" and "body" (the body should be formatted as HTML string with appropriate spacing). Do not wrap the JSON in markdown code blocks. Just output raw JSON.
    Example:
    {"subject": "Follow-up on product delay", "body": "Dear team,<br><br>I hope this email finds you well..."}`;

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 500
    });
    
    const textResponse = response.choices[0].message.content.trim();
    try {
      const cleanJson = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      return {
        subject: 'Draft Email',
        body: textResponse.replace(/\n/g, '<br>')
      };
    }
  } catch (err) {
    console.error('Error drafting new email:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    throw err;
  }
}

// Generate draft reply to thread with context (NVIDIA NIM Llama 3.1)
export async function generateReplyDraft(messages, replyPrompt) {
  try {
    const formattedMessages = messages
      .map((m, idx) => `[Message ${idx + 1}] From: ${m.from_name || m.from_address} | Date: ${m.date}\nContent:\n${m.body_text || m.snippet}`)
      .join('\n\n---\n\n');

    const prompt = `You are a professional email assistant. Draft a reply to the following email thread based on the user prompt. 
    You must understand what was previously discussed in the thread and construct an appropriate, professional response.

    Thread Context:
    ${formattedMessages.substring(0, 8000)}

    User Prompt for Reply: "${replyPrompt}"

    Draft the reply body. Format it as a clean HTML string (using <br> for breaks, no <html> or <body> tags, just paragraphs and formatting). Keep it concise, polite, and aligned with the thread context. 
    Do not output subject, only the reply body. Just output the raw draft text.`;

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 500
    });
    
    return response.choices[0].message.content.trim().replace(/^```html/, '').replace(/```$/, '').trim();
  } catch (err) {
    console.error('Error drafting reply:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    throw err;
  }
}

// Answer Chat Agent Queries using RAG Context (NVIDIA NIM Llama 3.1)
export async function generateRagResponse(query, retrievedEmails, chatHistory = []) {
  try {
    // Format retrieved emails as knowledge source
    const formattedContext = retrievedEmails && retrievedEmails.length > 0 
      ? retrievedEmails.map((e, idx) => `
Source [${idx + 1}]:
- Message ID: ${e.id}
- Thread ID: ${e.thread_id}
- From: ${e.from_name ? `${e.from_name} <${e.from_address}>` : e.from_address}
- Date: ${new Date(e.date).toLocaleString()}
- Subject: ${e.subject}
- Summary: ${e.summary || e.snippet}
- Content Snippet: ${e.snippet}
---`).join('\n')
      : 'No email records found matching the query.';

    const systemPrompt = `You are the core AI Chat Agent for a Gmail Intelligence Platform. You act as an executive assistant who has read all the user's emails.
Your knowledge base is strictly limited to the provided emails in the "Email Context" below.

RULES:
1. Only answer queries using information found in the Email Context.
2. If the user asks a question that cannot be answered using the provided Email Context, politely reply that you cannot find this information in their email archives. Do NOT hallucinate.
3. Be transparent and maintain "Source Clarity". Whenever you output facts, state which Source(s) (e.g., "[1]", "[2]", sender, date, or subject) the information came from.
4. Support cross-email reasoning. If the user asks about a project discussed in multiple messages, synthesize the information across all relevant sources in a clean, professional way.
5. If the user asks about a general question not related to their emails, you should answer standard questions briefly, but remind them you are primarily here to assist with their emails.

Email Context:
${formattedContext}`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Append chat history
    for (const msg of chatHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }

    // Append current query
    messages.push({ role: 'user', content: query });

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages,
      temperature: 0.3,
      max_tokens: 800
    });
    
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('Error generating RAG response:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    return 'I encountered an issue processing that query. Please try again.';
  }
}

// Parse user query for structural filters (NVIDIA NIM Llama 3.1)
export async function parseQueryFilters(query) {
  try {
    const prompt = `Analyze the user's search query and extract search filters for a PostgreSQL database.
    Query: "${query}"
    
    Supported filters (keys):
    - "sender": string (e.g., email or name, extract if they query "from Acme" or "from contact@test.com")
    - "days": integer (extract if they ask for "past 4 days" or "this week" (7), "this month" (30), etc.)
    - "category": string (one of: "Newsletters", "Job / Recruitment", "Finance", "Notifications", "Personal", "Work / Professional")
    - "searchTerm": string (keywords to search for, like "data migration" or "Kubernetes")
    
    Return a raw JSON object with these keys. If a filter is not specified, set it to null.
    Do not wrap the response in markdown code blocks. Just output raw JSON.
    Example:
    {"sender": "Acme Corp", "days": 30, "category": null, "searchTerm": "migration"}`;

    const response = await nvidiaClient.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 150
    });
    
    const textResponse = response.choices[0].message.content.trim();
    try {
      const cleanJson = textResponse.replace(/^```json/, '').replace(/```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      return { sender: null, days: null, category: null, searchTerm: query };
    }
  } catch (err) {
    console.error('Error parsing query filters:', err.message);
    if (isRateLimitError(err)) {
      throw err;
    }
    return { sender: null, days: null, category: null, searchTerm: query };
  }
}
