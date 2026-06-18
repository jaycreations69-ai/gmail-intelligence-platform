import { google } from 'googleapis';
import { supabase } from '../config/supabase.js';

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

// Generate redirect Auth URL
export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Force consent to ensure we always get a refresh_token
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send'
    ]
  });
}

// Exchange authorization code for tokens
export async function getTokensFromCode(code) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Retrieve user's email address using access token
export async function getUserProfileEmail(accessToken) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  return userInfo.data.email;
}

// Get an authorized, valid client. Refreshes token automatically if expired
export async function getValidClient(userRecord) {
  const oauth2Client = getOAuth2Client();
  
  oauth2Client.setCredentials({
    access_token: userRecord.google_access_token,
    refresh_token: userRecord.google_refresh_token,
    expiry_date: userRecord.google_token_expiry ? new Date(userRecord.google_token_expiry).getTime() : null
  });

  const now = Date.now();
  const expiry = userRecord.google_token_expiry ? new Date(userRecord.google_token_expiry).getTime() : 0;
  
  // Refresh if missing or expiring in < 5 mins
  if (!userRecord.google_access_token || expiry - now < 5 * 60 * 1000) {
    if (!userRecord.google_refresh_token) {
      throw new Error('No refresh token available to refresh access token');
    }
    
    console.log(`Token expired or expiring soon for user ${userRecord.email}. Refreshing...`);
    try {
      const response = await oauth2Client.refreshAccessToken();
      const newTokens = response.credentials;
      
      const updates = {
        google_access_token: newTokens.access_token,
        google_token_expiry: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null
      };
      if (newTokens.refresh_token) {
        updates.google_refresh_token = newTokens.refresh_token;
      }
      
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userRecord.id);
        
      if (error) {
        throw error;
      }
      
      oauth2Client.setCredentials(newTokens);
      console.log(`Token refreshed successfully for user ${userRecord.email}`);
    } catch (err) {
      console.error(`Error refreshing token for user ${userRecord.email}:`, err.message);
      throw err;
    }
  }
  
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Parse body content (plain text & html) from a message payload
export function parseEmailBody(payload) {
  let bodyText = '';
  let bodyHtml = '';

  function parsePart(part) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
      bodyHtml += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      part.parts.forEach(parsePart);
    }
  }

  if (payload.parts) {
    payload.parts.forEach(parsePart);
  } else if (payload.body && payload.body.data) {
    const data = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      bodyHtml = data;
    } else {
      bodyText = data;
    }
  }

  // Fallback for empty bodyText
  if (!bodyText && bodyHtml) {
    bodyText = bodyHtml.replace(/<[^>]*>/g, ' '); // Strip HTML tags
  }

  return { 
    text: bodyText.trim(), 
    html: bodyHtml.trim() 
  };
}

// Helper to construct a base64 encoded MIME message for Gmail
function createMimeMessage({ to, subject, body, threadId, messageId }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0'
  ];

  if (threadId && messageId) {
    headers.push(`In-Reply-To: ${messageId}`);
    headers.push(`References: ${messageId}`);
  }

  const emailContent = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(emailContent)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Create an email draft in Gmail
export async function createGmailDraft(gmail, { to, subject, body, threadId, messageId }) {
  const rawMessage = createMimeMessage({ to, subject, body, threadId, messageId });
  const draftBody = {
    message: {
      raw: rawMessage
    }
  };
  
  if (threadId) {
    draftBody.message.threadId = threadId;
  }
  
  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: draftBody
  });
  return response.data;
}

// Send an email directly via Gmail
export async function sendGmailEmail(gmail, { to, subject, body, threadId, messageId }) {
  const rawMessage = createMimeMessage({ to, subject, body, threadId, messageId });
  const requestBody = {
    raw: rawMessage
  };
  
  if (threadId) {
    requestBody.threadId = threadId;
  }
  
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody
  });
  return response.data;
}
