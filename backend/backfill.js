import { supabase } from './src/config/supabase.js';
import { generateSummary, generateThreadSummary, generateEmbedding } from './src/services/geminiService.js';
import { categorizeEmail } from './src/services/nvidiaService.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Robust retry wrapper that detects 429 rate limit or quota errors
async function callWithRetry(fn, retries = 5, delayMs = 2000) {
  try {
    return await fn();
  } catch (err) {
    const errMsg = err.message || '';
    const isRateLimit = 
      err.status === 429 || 
      errMsg.includes('429') || 
      errMsg.toLowerCase().includes('rate limit') ||
      errMsg.toLowerCase().includes('quota') ||
      errMsg.toLowerCase().includes('exceeded');

    if (isRateLimit) {
      console.log(`\n[Rate Limit / Quota Detected] Waiting 65 seconds for the rate limit window to reset...`);
      await delay(65000);
      return callWithRetry(fn, retries - 1, delayMs);
    }

    if (retries > 0) {
      console.log(`API Error: ${err.message}. Retrying in ${delayMs}ms...`);
      await delay(delayMs);
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

async function getSummaryWithRetry(bodyText, subject) {
  return callWithRetry(async () => {
    const summary = await generateSummary(bodyText, subject);
    if (summary === 'Summary unavailable.') {
      throw new Error('Gemini summary generation returned failure fallback (or rate limit)');
    }
    return summary;
  });
}

async function getEmbeddingWithRetry(text) {
  return callWithRetry(async () => {
    const embedding = await generateEmbedding(text);
    const isValid = embedding && Array.isArray(embedding) && embedding.some(v => v !== 0);
    if (!isValid) {
      throw new Error('Gemini embedding generation returned failure fallback (or rate limit)');
    }
    return embedding;
  });
}

async function run() {
  try {
    console.log('--- Starting Robust Database Backfill Script ---');
    
    // 1. Fetch emails needing backfill
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, thread_id, subject, snippet, body_text, from_name, from_address, date')
      .eq('summary', 'Summary unavailable.');

    if (emailsError) {
      throw emailsError;
    }

    console.log(`Found ${emails.length} emails needing summary/embedding regeneration.`);

    if (emails.length === 0) {
      console.log('No backfill needed. All emails have valid summaries.');
      return;
    }

    const uniqueThreadIds = new Set();

    // 2. Loop through and regenerate
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      console.log(`\n[${i + 1}/${emails.length}] Processing Email: "${email.subject}" (ID: ${email.id})`);
      uniqueThreadIds.add(email.thread_id);

      try {
        // a. Individual summary
        console.log('  Generating summary...');
        const summary = await getSummaryWithRetry(email.body_text || email.snippet, email.subject);
        
        // b. Categorization (Meta Llama on NVIDIA NIM)
        console.log('  Categorizing email...');
        const category = await categorizeEmail({
          subject: email.subject,
          snippet: email.snippet,
          from_name: email.from_name,
          from_address: email.from_address
        });

        // c. Embedding
        console.log('  Generating embedding...');
        const embeddingText = `From: ${email.from_name || email.from_address}\nSubject: ${email.subject}\nSummary: ${summary}\nSnippet: ${email.snippet}`;
        const embedding = await getEmbeddingWithRetry(embeddingText);

        // d. Update record in Supabase
        console.log('  Updating database...');
        const { error: updateError } = await supabase
          .from('emails')
          .update({
            summary,
            category,
            embedding
          })
          .eq('id', email.id);

        if (updateError) {
          console.error(`  Error updating email ${email.id}:`, updateError.message);
        } else {
          console.log(`  Successfully updated email.`);
        }

      } catch (itemErr) {
        console.error(`  Failed to process email ${email.id}:`, itemErr.message);
      }

      // Small delay between successful runs
      await delay(1000);
    }

    console.log('\n--- Regenerating Thread Summaries ---');
    const threadIdArray = Array.from(uniqueThreadIds);
    console.log(`Need to update summaries for ${threadIdArray.length} threads.`);

    for (let t = 0; t < threadIdArray.length; t++) {
      const threadId = threadIdArray[t];
      console.log(`[${t + 1}/${threadIdArray.length}] Updating Thread ID: ${threadId}`);

      try {
        // Fetch all emails in thread to construct summary
        const { data: dbEmails, error: fetchError } = await supabase
          .from('emails')
          .select('*')
          .eq('thread_id', threadId)
          .order('date', { ascending: true });

        if (fetchError) throw fetchError;

        if (dbEmails && dbEmails.length > 0) {
          console.log(`  Generating thread summary from ${dbEmails.length} messages...`);
          // Wrap thread summary generation in retry too
          const threadSummary = await callWithRetry(async () => {
            const summary = await generateThreadSummary(dbEmails);
            if (summary === 'Thread summary unavailable.') {
              throw new Error('Gemini thread summary generation returned failure fallback');
            }
            return summary;
          });
          
          // Latest email category
          const latestCategory = dbEmails[dbEmails.length - 1].category || 'Work / Professional';

          const { error: threadUpdateError } = await supabase
            .from('threads')
            .update({
              summary: threadSummary,
              category: latestCategory
            })
            .eq('id', threadId);

          if (threadUpdateError) {
            console.error(`  Error updating thread ${threadId} metadata:`, threadUpdateError.message);
          } else {
            console.log(`  Successfully updated thread summary.`);
          }
        }
      } catch (threadErr) {
        console.error(`  Failed to update thread ${threadId}:`, threadErr.message);
      }

      await delay(1000);
    }

    console.log('\n--- Backfill completed successfully! ---');

  } catch (err) {
    console.error('Backfill script failed:', err.message);
  }
}

run();
