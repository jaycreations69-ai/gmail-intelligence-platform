import { supabase } from './src/config/supabase.js';

async function run() {
  try {
    console.log('Querying Supabase database...');
    
    // Count emails
    const { count, error: countError } = await supabase
      .from('emails')
      .select('*', { count: 'exact', head: true });
      
    if (countError) throw countError;
    console.log('Total emails in DB:', count);

    // Get a sample email with its summary and embedding status
    const { data: sampleEmails, error: sampleError } = await supabase
      .from('emails')
      .select('id, subject, summary, embedding')
      .limit(5);

    if (sampleError) throw sampleError;
    
    sampleEmails.forEach((email, i) => {
      const hasSummary = email.summary && email.summary !== 'Summary unavailable.' && email.summary !== 'Empty email content.';
      const hasEmbedding = email.embedding && Array.isArray(email.embedding) && email.embedding.some(v => v !== 0);
      
      console.log(`Email [${i + 1}]:`);
      console.log(`  Subject: ${email.subject}`);
      console.log(`  Has Summary: ${hasSummary} (${email.summary})`);
      console.log(`  Has Valid Embedding: ${hasEmbedding}`);
      if (email.embedding) {
        console.log(`  Embedding sample (first 5 values):`, email.embedding.slice(0, 5));
      }
    });

  } catch (err) {
    console.error('Error querying DB:', err.message);
  }
}

run();
