import express from 'express';
import { supabase } from '../config/supabase.js';
import { generateNewEmailDraft, generateReplyDraft } from '../services/geminiService.js';
import { getValidClient, createGmailDraft, sendGmailEmail } from '../services/gmailService.js';

const router = express.Router();

// Generate new email draft fields (subject and body text)
router.post('/generate-compose', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt parameter is required' });
  }

  try {
    const draft = await generateNewEmailDraft(prompt);
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate email thread reply response with chronological conversation context
router.post('/generate-reply', async (req, res) => {
  const { userId, threadId, prompt } = req.body;
  if (!userId || !threadId || !prompt) {
    return res.status(400).json({ error: 'userId, threadId, and prompt parameters are required' });
  }

  try {
    // 1. Fetch thread messages from database for chronological ordering context
    const { data: emails, error } = await supabase
      .from('emails')
      .select('*')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (error || !emails || emails.length === 0) {
      return res.status(404).json({ error: 'No synced emails found for this thread' });
    }

    const replyBody = await generateReplyDraft(emails, prompt);
    
    // Auto-populate default header fields
    const lastEmail = emails[emails.length - 1];
    const subject = lastEmail.subject.toLowerCase().startsWith('re:') 
      ? lastEmail.subject 
      : `Re: ${lastEmail.subject}`;
      
    // Default the reply recipient to the sender of the last received message
    const to = lastEmail.from_address;

    res.json({
      to,
      subject,
      body: replyBody,
      replyToMessageId: lastEmail.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Commit draft/send message via Gmail API
router.post('/send', async (req, res) => {
  const { userId, to, subject, body, threadId, replyToMessageId, action } = req.body; // action: 'send' | 'draft'
  
  if (!userId || !to || !subject || !body) {
    return res.status(400).json({ error: 'userId, to, subject, and body parameters are required' });
  }

  try {
    // Retrieve OAuth details from user record
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User record not found' });
    }

    const gmail = await getValidClient(user);

    let result;
    if (action === 'draft') {
      result = await createGmailDraft(gmail, {
        to,
        subject,
        body,
        threadId,
        messageId: replyToMessageId
      });
      console.log(`Created draft in Gmail for user ${user.email}`);
    } else {
      result = await sendGmailEmail(gmail, {
        to,
        subject,
        body,
        threadId,
        messageId: replyToMessageId
      });
      console.log(`Sent email via Gmail for user ${user.email}`);
    }

    res.json({
      success: true,
      action,
      data: result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
