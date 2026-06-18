import express from 'express';
import { supabase } from '../config/supabase.js';

const router = express.Router();

// List threads (supports user validation, category sorting, subject keyword searches)
router.get('/', async (req, res) => {
  const { userId, category, search } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId parameter is required' });
  }

  try {
    let dbQuery = supabase
      .from('threads')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    // Filter by specific category (e.g. Newsletters, Finance)
    if (category) {
      dbQuery = dbQuery.eq('category', category);
    }

    // Filter by subject line match
    if (search) {
      dbQuery = dbQuery.ilike('subject', `%${search}%`);
    }

    const { data: threads, error } = await dbQuery;
    if (error) {
      throw error;
    }

    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch full thread containing all messages ordered chronologically
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // 1. Get Thread Metadata
    const { data: thread, error: threadError } = await supabase
      .from('threads')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (threadError || !thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // 2. Fetch child emails
    const { data: emails, error: emailsError } = await supabase
      .from('emails')
      .select('id, subject, snippet, body_text, body_html, from_name, from_address, to_address, date, labels, category, summary')
      .eq('thread_id', id)
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (emailsError) {
      throw emailsError;
    }

    res.json({
      ...thread,
      emails
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
