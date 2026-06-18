import { supabase } from '../config/supabase.js';
import { getValidClient, parseEmailBody } from './gmailService.js';
import { generateSummary, generateThreadSummary, generateEmbedding } from './geminiService.js';
import { categorizeEmail } from './nvidiaService.js';

// Helper for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry mechanism with exponential backoff for API calls
async function retryWithBackoff(fn, retries = 3, delayMs = 1000) {
  try {
    return await fn();
  } catch (err) {
    const errMsg = err.message || '';
    const isRateLimit = 
      err.status === 429 || 
      errMsg.includes('429') || 
      (err.response && err.response.status === 429) ||
      errMsg.toLowerCase().includes('rate limit') ||
      errMsg.toLowerCase().includes('quota') ||
      errMsg.toLowerCase().includes('exceeded');

    if (retries > 0) {
      // Free tier rate limits reset every minute, so we wait 65 seconds.
      const waitTime = isRateLimit ? 65000 : delayMs * 1.5;
      console.log(`API Call Error: ${err.message}. Retrying in ${waitTime}ms... (${retries} retries left)`);
      await delay(waitTime);
      return retryWithBackoff(fn, retries - 1, isRateLimit ? delayMs : waitTime);
    }
    throw err;
  }
}

// Process a single Gmail thread
async function processThread(gmail, userId, threadId) {
  console.log(`Processing thread: ${threadId}`);
  
  // 1. Fetch thread details from Gmail API
  const threadResponse = await retryWithBackoff(() => 
    gmail.users.threads.get({
      userId: 'me',
      id: threadId
    })
  );

  const gmailThread = threadResponse.data;
  if (!gmailThread || !gmailThread.messages || gmailThread.messages.length === 0) {
    return;
  }

  // Find the subject from the first message
  const firstMessage = gmailThread.messages[0];
  const headers = firstMessage.payload.headers || [];
  const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
  const subject = subjectHeader ? subjectHeader.value : 'No Subject';

  // 2. Upsert the thread record in Supabase
  const { error: threadUpsertError } = await supabase
    .from('threads')
    .upsert({
      id: threadId,
      user_id: userId,
      subject: subject,
      updated_at: new Date().toISOString()
    });

  if (threadUpsertError) {
    console.error(`Error saving thread ${threadId} metadata:`, threadUpsertError.message);
  }

  let newEmailsProcessed = false;

  // 3. Process each message in the thread
  for (const message of gmailThread.messages) {
    // Check if email already exists in DB to prevent redundant work
    const { data: existingEmail } = await supabase
      .from('emails')
      .select('id')
      .eq('id', message.id)
      .maybeSingle();

    if (existingEmail) {
      continue; // Skip, already synced
    }

    const msgHeaders = message.payload.headers || [];
    const msgSubject = (msgHeaders.find(h => h.name.toLowerCase() === 'subject') || {}).value || subject;
    const msgFromHeader = (msgHeaders.find(h => h.name.toLowerCase() === 'from') || {}).value || '';
    const msgToHeader = (msgHeaders.find(h => h.name.toLowerCase() === 'to') || {}).value || '';
    const msgDateHeader = (msgHeaders.find(h => h.name.toLowerCase() === 'date') || {}).value || '';
    const msgDate = msgDateHeader ? new Date(msgDateHeader).toISOString() : new Date().toISOString();
    
    // Parse From Header
    let from_name = '';
    let from_address = msgFromHeader;
    const match = msgFromHeader.match(/^(.*?)\s*<([^>]+)>/);
    if (match) {
      from_name = match[1].replace(/['"]/g, '').trim();
      from_address = match[2].trim();
    }

    const snippet = message.snippet || '';
    const { text: body_text, html: body_html } = parseEmailBody(message.payload);

    console.log(`Syncing new email: "${msgSubject}" from ${from_name || from_address}`);

    // AI Enrichment Pipeline:
    // a. Categorization (NIM)
    const category = await retryWithBackoff(() => 
      categorizeEmail({
        subject: msgSubject,
        snippet,
        from_name,
        from_address
      })
    );

    // b. Individual Summarization (Gemini)
    const summary = await retryWithBackoff(() => 
      generateSummary(body_text || snippet, msgSubject)
    );

    // c. Embedding Generation (Gemini)
    const embeddingText = `From: ${from_name || from_address}\nSubject: ${msgSubject}\nSummary: ${summary}\nSnippet: ${snippet}`;
    const embedding = await retryWithBackoff(() => 
      generateEmbedding(embeddingText)
    );

    // d. Save to Supabase
    const { error: insertError } = await supabase
      .from('emails')
      .insert({
        id: message.id,
        thread_id: threadId,
        user_id: userId,
        subject: msgSubject,
        snippet,
        body_text,
        body_html,
        from_address,
        from_name,
        to_address: msgToHeader,
        date: msgDate,
        labels: message.labelIds || [],
        category,
        summary,
        embedding
      });

    if (insertError) {
      console.error(`Failed to insert email ${message.id}:`, insertError.message);
    } else {
      newEmailsProcessed = true;
    }
    
    // Subtle rate-limiting throttle to avoid hammering Gemini/NIM too fast in a tight loop
    await delay(200);
  }

  // 4. If any new emails were written, regenerate the thread summary
  if (newEmailsProcessed) {
    const { data: dbEmails } = await supabase
      .from('emails')
      .select('*')
      .eq('thread_id', threadId)
      .order('date', { ascending: true });

    if (dbEmails && dbEmails.length > 0) {
      const threadSummary = await retryWithBackoff(() => 
        generateThreadSummary(dbEmails)
      );

      // Thread category is defined by its latest email's category
      const latestCategory = dbEmails[dbEmails.length - 1].category || 'Work / Professional';

      await supabase
        .from('threads')
        .update({
          summary: threadSummary,
          category: latestCategory
        })
        .eq('id', threadId);
    }
  }
}

// Orchestrate the synchronization workflow
export async function syncUserEmails(userId, isForce = false) {
  // Fetch user details
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    throw new Error(`User not found: ${userError?.message || 'Empty record'}`);
  }

  // Prevent double sync collisions
  if (user.sync_status === 'syncing' && !isForce) {
    console.log(`Sync already running for ${user.email}. Skipping execution.`);
    return;
  }

  // Set syncing status
  await supabase
    .from('users')
    .update({ sync_status: 'syncing' })
    .eq('id', userId);

  try {
    const gmail = await getValidClient(user);
    
    // Construct search query for listing. If last_sync_time exists, do incremental sync.
    let query = '';
    if (user.last_sync_time && !isForce) {
      const epochSeconds = Math.floor(new Date(user.last_sync_time).getTime() / 1000);
      query = `after:${epochSeconds}`;
      console.log(`Performing incremental sync for ${user.email}. Query: ${query}`);
    } else {
      console.log(`Performing full sync for ${user.email}`);
    }

    let pageToken = null;
    let syncedMessages = [];
    const maxMessagesLimit = 100; // Cap to list the latest 100 messages for quick sync

    do {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 50,
        pageToken
      });

      if (listResponse.data.messages) {
        syncedMessages.push(...listResponse.data.messages);
      }
      pageToken = listResponse.data.nextPageToken;

      if (syncedMessages.length >= maxMessagesLimit) {
        break;
      }
    } while (pageToken);

    if (syncedMessages.length === 0) {
      console.log(`No new messages found to sync for ${user.email}`);
      await supabase
        .from('users')
        .update({ 
          sync_status: 'completed',
          last_sync_time: new Date().toISOString()
        })
        .eq('id', userId);
      return;
    }

    // Extract unique thread IDs from the synced messages
    const threadIds = [...new Set(syncedMessages.map(m => m.threadId))];
    console.log(`Identified ${threadIds.length} threads to sync for user ${user.email}`);

    // Process each thread
    for (const threadId of threadIds) {
      try {
        await processThread(gmail, userId, threadId);
      } catch (err) {
        console.error(`Skipping thread ${threadId} due to processing failure:`, err.message);
      }
    }

    // Finish sync successfully
    await supabase
      .from('users')
      .update({
        sync_status: 'completed',
        last_sync_time: new Date().toISOString()
      })
      .eq('id', userId);

    console.log(`Synchronization completed successfully for ${user.email}`);
  } catch (err) {
    console.error(`Sync execution failed for ${user.email}:`, err.message);
    await supabase
      .from('users')
      .update({ sync_status: 'failed' })
      .eq('id', userId);
    throw err;
  }
}
