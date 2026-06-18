import express from 'express';
import { supabase } from '../config/supabase.js';
import { deduplicateNewsletters } from '../services/nvidiaService.js';

const router = express.Router();

// Retrieve newsletters and call NVIDIA NIM to deduplicate news items
router.get('/dedup', async (req, res) => {
  const { userId, days = 4 } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId parameter is required' });
  }

  try {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(days, 10));

    // 1. Fetch recent emails labeled as Newsletters
    const { data: emails, error } = await supabase
      .from('emails')
      .select('id, subject, snippet, body_text, from_name, from_address, date')
      .eq('user_id', userId)
      .eq('category', 'Newsletters')
      .gte('date', dateLimit.toISOString())
      .order('date', { ascending: false });

    if (error) {
      throw error;
    }

    if (!emails || emails.length === 0) {
      return res.json([]); // Return empty list
    }

    // 2. Perform semantic extraction and grouping
    const deduplicatedStories = await deduplicateNewsletters(emails);
    res.json(deduplicatedStories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
