import express from 'express';
import { supabase } from '../config/supabase.js';
import { getAuthUrl, getTokensFromCode, getUserProfileEmail } from '../services/gmailService.js';
import { syncUserEmails } from '../services/syncService.js';

const router = express.Router();

// Redirect to Google Consent screen
router.get('/google', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// OAuth Callback handler
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('OAuth authorization code is missing.');
  }

  try {
    const tokens = await getTokensFromCode(code);
    const email = await getUserProfileEmail(tokens.access_token);
    
    // Save tokens and user info to database
    const userUpdates = {
      email,
      google_access_token: tokens.access_token,
      google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
    };
    
    // Save refresh token only if Google returns one (which happens on first consent)
    if (tokens.refresh_token) {
      userUpdates.google_refresh_token = tokens.refresh_token;
    }
    
    // Upsert user based on email
    const { data: user, error } = await supabase
      .from('users')
      .upsert(userUpdates, { onConflict: 'email' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Trigger an initial sync in the background (non-blocking)
    syncUserEmails(user.id).catch(err => {
      console.error(`Background initial sync failed for user ${email}:`, err.message);
    });

    // Redirect user back to the Vite frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?userId=${user.id}`);
  } catch (err) {
    console.error('OAuth callback processing failed:', err.message);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// Fetch user session/sync details
router.get('/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId parameter is required' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, sync_status, last_sync_time')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger email synchronization (non-blocking background task)
router.post('/sync', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, sync_status')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.sync_status === 'syncing') {
      return res.json({ status: 'syncing', message: 'Sync already in progress' });
    }

    // Trigger asynchronous execution without waiting for completion
    syncUserEmails(user.id, true).catch(err => {
      console.error(`Background manual sync failed for user ${user.id}:`, err.message);
    });

    res.json({ status: 'started', message: 'Synchronization task started in background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
