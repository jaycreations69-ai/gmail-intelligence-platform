import express from 'express';
import { supabase } from '../config/supabase.js';
import { generateEmbedding, generateRagResponse, parseQueryFilters } from '../services/geminiService.js';

const router = express.Router();

// AI Chat Agent endpoint implementing Hybrid RAG retrieval
router.post('/', async (req, res) => {
  const { userId, message, history } = req.body; // history: array of { role: 'user'|'model', content: string }
  
  if (!userId || !message) {
    return res.status(400).json({ error: 'userId and message parameters are required' });
  }

  try {
    const mergedResults = [];
    const seenMessageIds = new Set();

    // 1. Perform Semantic Search (pgvector)
    const queryEmbedding = await generateEmbedding(message);
    const { data: semanticResults, error: semanticError } = await supabase
      .rpc('match_emails', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 8,
        p_user_id: userId
      });

    if (semanticError) {
      console.error('Semantic search error:', semanticError.message);
    } else if (semanticResults) {
      for (const item of semanticResults) {
        seenMessageIds.add(item.id);
        mergedResults.push(item);
      }
    }

    // 2. Perform Metadata Search (extracted filters)
    const filters = await parseQueryFilters(message);
    console.log(`Extracted query filters for search:`, filters);

    if (filters.sender || filters.days || filters.category) {
      let filterQuery = supabase
        .from('emails')
        .select('id, thread_id, subject, snippet, from_name, from_address, date, category, summary')
        .eq('user_id', userId);

      if (filters.category) {
        filterQuery = filterQuery.eq('category', filters.category);
      }
      if (filters.sender) {
        filterQuery = filterQuery.or(`from_name.ilike.%${filters.sender}%,from_address.ilike.%${filters.sender}%`);
      }
      if (filters.days) {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - parseInt(filters.days, 10));
        filterQuery = filterQuery.gte('date', dateLimit.toISOString());
      }

      const { data: filterResults, error: filterError } = await filterQuery
        .order('date', { ascending: false })
        .limit(12);

      if (filterError) {
        console.error('Structured metadata query error:', filterError.message);
      } else if (filterResults) {
        for (const item of filterResults) {
          if (!seenMessageIds.has(item.id)) {
            seenMessageIds.add(item.id);
            mergedResults.push(item);
          }
        }
      }
    }

    // 3. Generate Answer using the Context
    const answer = await generateRagResponse(message, mergedResults, history || []);
    
    // 4. Return response + citation sources
    res.json({
      answer,
      sources: mergedResults.map(e => ({
        id: e.id,
        threadId: e.thread_id,
        subject: e.subject,
        fromName: e.from_name,
        fromAddress: e.from_address,
        date: e.date,
        category: e.category
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
