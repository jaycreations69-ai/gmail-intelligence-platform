import React, { useState, useEffect, useRef } from 'react';
import { 
  Mail, Bot, Sparkles, RefreshCw, Search, ArrowRight, Inbox, 
  Send, FileText, Check, AlertCircle, Copy, ExternalLink, 
  Calendar, User, Tag, ChevronDown, ChevronUp, Layers, LogOut, CheckCircle2, MessageSquare, Newspaper
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function App() {
  const [userId, setUserId] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('threads'); // 'threads' | 'chat' | 'news' | 'compose'
  
  // Status states
  const [syncLoading, setSyncLoading] = useState(false);
  const [pollingStatus, setPollingStatus] = useState(false);

  // Threads states
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);

  // Email action states
  const [replyPrompt, setReplyPrompt] = useState('');
  const [generatingReply, setGeneratingReply] = useState(false);
  const [draftReply, setDraftReply] = useState(null); // { to, subject, body, replyToMessageId }
  const [sendingEmail, setSendingEmail] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  // Compose new email states
  const [composePrompt, setComposePrompt] = useState('');
  const [generatingCompose, setGeneratingCompose] = useState(false);
  const [draftCompose, setDraftCompose] = useState(null); // { subject, body, to }

  // Chat agent states
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'model', content: 'Hello! I am your AI Gmail Assistant. I have indexed your emails. Ask me anything about them, and I will find the information and cite my sources.' }
  ]);
  const [sendingChat, setSendingChat] = useState(false);
  const [chatSources, setChatSources] = useState([]);
  const chatEndRef = useRef(null);

  // Newsletter deduplication states
  const [dedupDays, setDedupDays] = useState(4);
  const [newsFeed, setNewsFeed] = useState([]);
  const [loadingNews, setLoadingNews] = useState(false);

  // Toggles
  const [expandedEmails, setExpandedEmails] = useState({});

  // 1. Extract userId from URL query parameter or localStorage
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const userIdFromUrl = urlParams.get('userId');
    const storedUserId = localStorage.getItem('gmail_intel_user_id');

    if (userIdFromUrl) {
      localStorage.setItem('gmail_intel_user_id', userIdFromUrl);
      setUserId(userIdFromUrl);
      // Strip userId from browser URL bar for clean UI
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (storedUserId) {
      setUserId(storedUserId);
    }
  }, []);

  // 2. Fetch user status when userId is set
  useEffect(() => {
    if (!userId) return;
    fetchUserStatus();
  }, [userId]);

  const fetchUserStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/status?userId=${userId}`);
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      setUserProfile(data);
      
      // Auto-poll sync status if it is syncing
      if (data.sync_status === 'syncing') {
        setPollingStatus(true);
      } else {
        setPollingStatus(false);
      }
    } catch (err) {
      console.error(err);
      // If user not found, log them out
      handleLogout();
    }
  };

  // 3. Status Polling loop
  useEffect(() => {
    if (!pollingStatus || !userId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/status?userId=${userId}`);
        const data = await res.json();
        setUserProfile(data);
        if (data.sync_status !== 'syncing') {
          setPollingStatus(false);
          clearInterval(interval);
          // Refresh threads when sync completes
          if (activeTab === 'threads') {
            loadThreads();
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [pollingStatus, userId, activeTab]);

  // 4. Load threads list
  useEffect(() => {
    if (!userId || activeTab !== 'threads') return;
    loadThreads();
  }, [userId, selectedCategory, activeTab]);

  const loadThreads = async () => {
    setLoadingThreads(true);
    try {
      const url = new URL(`${BACKEND_URL}/api/threads`);
      url.searchParams.append('userId', userId);
      if (selectedCategory) {
        url.searchParams.append('category', selectedCategory);
      }
      if (searchQuery) {
        url.searchParams.append('search', searchQuery);
      }
      
      const res = await fetch(url);
      const data = await res.json();
      setThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching threads:', err);
    } finally {
      setLoadingThreads(false);
    }
  };

  // 5. Handle manual sync request
  const triggerSync = async () => {
    setSyncLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (data.status === 'started' || data.status === 'syncing') {
        setPollingStatus(true);
        setUserProfile(prev => ({ ...prev, sync_status: 'syncing' }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncLoading(false);
    }
  };

  // 6. Fetch single thread details
  const viewThreadDetail = async (threadId) => {
    setLoadingThreadDetail(true);
    setSelectedThread(null);
    setDraftReply(null);
    setReplyPrompt('');
    setActionSuccess('');
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/threads/${threadId}?userId=${userId}`);
      if (!res.ok) throw new Error('Failed to load thread');
      const data = await res.json();
      setSelectedThread(data);
      
      // Initialize expanded states
      const expands = {};
      if (data.emails && data.emails.length > 0) {
        // Expand the last email by default
        expands[data.emails[data.emails.length - 1].id] = true;
      }
      setExpandedEmails(expands);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingThreadDetail(false);
    }
  };

  // 7. Generate AI reply draft
  const handleGenerateReply = async () => {
    if (!replyPrompt) return;
    setGeneratingReply(true);
    setDraftReply(null);
    setActionSuccess('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/emails/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          threadId: selectedThread.id,
          prompt: replyPrompt
        })
      });
      const data = await res.json();
      setDraftReply(data);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingReply(false);
    }
  };

  // 8. Commit and send email/draft (reply or compose)
  const handleSendEmail = async (draftType, actionType) => {
    // draftType: 'reply' | 'compose', actionType: 'send' | 'draft'
    const payload = draftType === 'reply' ? draftReply : draftCompose;
    if (!payload) return;

    setSendingEmail(true);
    setActionSuccess('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/emails/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          threadId: draftType === 'reply' ? selectedThread.id : undefined,
          replyToMessageId: draftType === 'reply' ? payload.replyToMessageId : undefined,
          action: actionType
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setActionSuccess(actionType === 'draft' ? 'Draft saved in Gmail!' : 'Email sent successfully!');
        // Reset drafts
        if (draftType === 'reply') {
          setDraftReply(null);
          setReplyPrompt('');
        } else {
          setDraftCompose(null);
          setComposePrompt('');
        }
      } else {
        throw new Error(data.error || 'Failed action');
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  // 9. Generate new compose email draft
  const handleGenerateCompose = async () => {
    if (!composePrompt) return;
    setGeneratingCompose(true);
    setDraftCompose(null);
    setActionSuccess('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/emails/generate-compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: composePrompt })
      });
      const data = await res.json();
      // Add a default recipient to compose state
      setDraftCompose({
        to: '',
        subject: data.subject,
        body: data.body
      });
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingCompose(false);
    }
  };

  // 10. Chat Agent - Send message
  const handleSendChat = async (e) => {
    if (e) e.preventDefault();
    if (!chatMessage || sendingChat) return;

    const userMsg = { role: 'user', content: chatMessage };
    setChatHistory(prev => [...prev, userMsg]);
    setChatMessage('');
    setSendingChat(true);

    // Format chat history for API (excluding the message we just sent)
    const historyPayload = chatHistory.map(h => ({
      role: h.role,
      content: h.content
    }));

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          message: userMsg.content,
          history: historyPayload
        })
      });
      
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'model', content: data.answer }]);
      
      // Store sources returned
      if (data.sources && data.sources.length > 0) {
        setChatSources(data.sources);
      }
    } catch (err) {
      console.error(err);
      setChatHistory(prev => [...prev, { role: 'model', content: 'Sorry, I failed to process that query.' }]);
    } finally {
      setSendingChat(false);
    }
  };

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // 11. Newsletter Deduplication Aggregation
  const handleLoadNews = async () => {
    setLoadingNews(true);
    setNewsFeed([]);
    try {
      const res = await fetch(`${BACKEND_URL}/api/newsletters/dedup?userId=${userId}&days=${dedupDays}`);
      const data = await res.json();
      setNewsFeed(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Newsletter loading error:', err);
    } finally {
      setLoadingNews(false);
    }
  };

  // Load news initially when tab selected
  useEffect(() => {
    if (userId && activeTab === 'news') {
      handleLoadNews();
    }
  }, [userId, activeTab, dedupDays]);

  const handleLogout = () => {
    localStorage.removeItem('gmail_intel_user_id');
    setUserId('');
    setUserProfile(null);
    setThreads([]);
    setSelectedThread(null);
  };

  const toggleEmailExpand = (msgId) => {
    setExpandedEmails(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const formatCategoryBadgeColor = (category) => {
    switch (category) {
      case 'Work / Professional': return 'badge-work';
      case 'Personal': return 'badge-personal';
      case 'Finance': return 'badge-finance';
      case 'Job / Recruitment': return 'badge-job';
      case 'Notifications': return 'badge-notification';
      case 'Newsletters': return 'badge-newsletter';
      default: return 'badge-default';
    }
  };

  // RENDER LANDING PAGE IF NOT AUTHENTICATED
  if (!userId) {
    return (
      <div className="landing-container">
        <div className="landing-bg-gradients">
          <div className="grad-orb grad-orb-1"></div>
          <div className="grad-orb grad-orb-2"></div>
        </div>
        
        <div className="landing-card glass">
          <div className="landing-icon-wrapper">
            <Sparkles className="icon-sparkle-hero" />
            <Mail className="icon-mail-hero" />
          </div>
          <h1>Gmail Intelligence Platform</h1>
          <p className="landing-subtitle">
            An advanced AI assistant designed to securely integrate with your inbox, categorize threads, summarize complex conversations, and draft replies using context-aware RAG pipelines.
          </p>
          
          <div className="features-grid">
            <div className="feature-item">
              <Bot className="feat-icon" />
              <div>
                <h3>AI Chat Agent</h3>
                <p>Chat with your email knowledge base with zero hallucinations.</p>
              </div>
            </div>
            <div className="feature-item">
              <Layers className="feat-icon" />
              <div>
                <h3>Smart Classification</h3>
                <p>Emails automatically categorized into Work, Finance, Newsletters, etc.</p>
              </div>
            </div>
            <div className="feature-item">
              <Newspaper className="feat-icon" />
              <div>
                <h3>Newsletter Deduplicator</h3>
                <p>Compile recent news bulletins, removing duplicate stories semantically.</p>
              </div>
            </div>
          </div>

          <a href={`${BACKEND_URL}/api/auth/google`} className="connect-btn">
            Connect Gmail Account
            <ArrowRight className="btn-arrow" />
          </a>

          <div className="landing-footer">
            Secure Google OAuth 2.0 • Powered by Gemini & NVIDIA NIM
          </div>
        </div>
      </div>
    );
  }

  // RENDER MAIN APPLICATION DASHBOARD
  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <Sparkles className="brand-glow-icon" />
          <span>Repeatless Gmail AI</span>
        </div>

        {userProfile && (
          <div className="user-profile-widget">
            <div className="user-avatar">
              {userProfile.email ? userProfile.email[0].toUpperCase() : 'U'}
            </div>
            <div className="user-info">
              <span className="user-email-text" title={userProfile.email}>{userProfile.email}</span>
              <span className="user-status-text">
                {userProfile.sync_status === 'syncing' ? (
                  <span className="status-syncing"><RefreshCw className="spinner-mini" /> Syncing...</span>
                ) : (
                  <span className="status-synced"><Check className="check-mini" /> Connected</span>
                )}
              </span>
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'threads' ? 'active' : ''}`}
            onClick={() => { setActiveTab('threads'); setSelectedThread(null); }}
          >
            <Inbox size={18} />
            <span>Thread Explorer</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <Bot size={18} />
            <span>AI Chat Assistant</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'news' ? 'active' : ''}`}
            onClick={() => setActiveTab('news')}
          >
            <Newspaper size={18} />
            <span>News Deduplicator</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'compose' ? 'active' : ''}`}
            onClick={() => { setActiveTab('compose'); setDraftCompose(null); }}
          >
            <Send size={18} />
            <span>Compose with AI</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={16} />
            <span>Disconnect Account</span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <main className="main-content">
        {/* Header */}
        <header className="main-header glass">
          <div className="header-left">
            <h2>
              {activeTab === 'threads' && 'Inbox Thread Explorer'}
              {activeTab === 'chat' && 'AI Chat Agent'}
              {activeTab === 'news' && 'Newsletter Deduplication'}
              {activeTab === 'compose' && 'Compose New Email'}
            </h2>
          </div>
          
          <div className="header-right">
            {userProfile && (
              <div className="sync-timer-widget">
                <span className="last-sync-label">
                  Last Sync: {userProfile.last_sync_time ? new Date(userProfile.last_sync_time).toLocaleTimeString() : 'Never'}
                </span>
                <button 
                  onClick={triggerSync} 
                  disabled={userProfile.sync_status === 'syncing' || syncLoading}
                  className="sync-action-btn"
                >
                  <RefreshCw className={`sync-icon ${userProfile.sync_status === 'syncing' ? 'spin' : ''}`} size={14} />
                  <span>{userProfile.sync_status === 'syncing' ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Area */}
        <section className="tab-viewport">
          
          {/* TAB 1: THREAD EXPLORER */}
          {activeTab === 'threads' && (
            <div className="threads-viewport">
              {/* Sidebar list of threads */}
              <div className="threads-sidebar-list glass">
                <div className="list-controls">
                  <div className="search-bar-wrapper">
                    <Search className="search-bar-icon" size={16} />
                    <input 
                      type="text" 
                      placeholder="Search thread subject..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && loadThreads()}
                      className="thread-search-input"
                    />
                  </div>
                  
                  {/* Category Filter Tabs */}
                  <div className="category-scroll-tabs">
                    <button 
                      className={`cat-pill ${selectedCategory === '' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory('')}
                    >
                      All
                    </button>
                    {['Personal', 'Work / Professional', 'Finance', 'Job / Recruitment', 'Notifications', 'Newsletters'].map(cat => (
                      <button
                        key={cat}
                        className={`cat-pill ${selectedCategory === cat ? 'active' : ''}`}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="threads-scrollable">
                  {loadingThreads ? (
                    <div className="loading-spinner-container">
                      <RefreshCw className="spin large-spinner" />
                      <p>Loading email threads...</p>
                    </div>
                  ) : threads.length === 0 ? (
                    <div className="empty-inbox-state">
                      <Mail size={40} className="empty-icon" />
                      <p>No threads found. Trigger a sync or change your filters.</p>
                    </div>
                  ) : (
                    threads.map(t => (
                      <div 
                        key={t.id}
                        className={`thread-list-item ${selectedThread?.id === t.id ? 'selected' : ''}`}
                        onClick={() => viewThreadDetail(t.id)}
                      >
                        <div className="thread-item-meta">
                          <span className={`category-badge ${formatCategoryBadgeColor(t.category)}`}>
                            {t.category || 'Categorizing...'}
                          </span>
                          <span className="thread-item-date">
                            {new Date(t.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                        <h4 className="thread-item-subject">{t.subject || '(No Subject)'}</h4>
                        <p className="thread-item-summary">
                          {t.summary ? t.summary.substring(0, 85) + '...' : 'Summarizing conversation...'}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Main detail view */}
              <div className="thread-detail-pane glass">
                {loadingThreadDetail ? (
                  <div className="loading-spinner-container centered-pane">
                    <RefreshCw className="spin large-spinner" />
                    <p>Fetching thread emails and summarizing conversation...</p>
                  </div>
                ) : selectedThread ? (
                  <div className="thread-detail-scroll">
                    {/* Thread Header */}
                    <div className="thread-detail-header">
                      <div className="title-row">
                        <span className={`category-badge ${formatCategoryBadgeColor(selectedThread.category)}`}>
                          {selectedThread.category}
                        </span>
                        <h3>{selectedThread.subject}</h3>
                      </div>
                      
                      {selectedThread.summary && (
                        <div className="thread-summary-box">
                          <div className="box-title">
                            <Sparkles size={16} className="sparkle-gold" />
                            <span>AI Thread Summary (Conversation Arc)</span>
                          </div>
                          <p>{selectedThread.summary}</p>
                        </div>
                      )}
                    </div>

                    {/* Email List */}
                    <div className="emails-list-stack">
                      {selectedThread.emails && selectedThread.emails.map((email, index) => (
                        <div key={email.id} className="email-card glass">
                          <div 
                            className="email-card-header"
                            onClick={() => toggleEmailExpand(email.id)}
                          >
                            <div className="header-left-info">
                              <User size={16} className="user-icon-avatar" />
                              <div className="sender-details">
                                <span className="sender-name">{email.from_name || email.from_address}</span>
                                <span className="sender-addr">&lt;{email.from_address}&gt;</span>
                              </div>
                            </div>
                            <div className="header-right-info">
                              <span className="email-date-stamp">
                                {new Date(email.date).toLocaleString()}
                              </span>
                              {expandedEmails[email.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                          </div>

                          {expandedEmails[email.id] && (
                            <div className="email-card-content">
                              {/* Summary box inside email */}
                              {email.summary && (
                                <div className="email-summary-box">
                                  <strong>Email Summary: </strong>
                                  <span>{email.summary}</span>
                                </div>
                              )}
                              
                              <div 
                                className="email-body-render" 
                                dangerouslySetInnerHTML={{ __html: email.body_html || email.body_text?.replace(/\n/g, '<br>') }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* AI Reply Drafting Area */}
                    <div className="thread-reply-composer glass">
                      <h3><Bot size={18} className="bot-reply-icon" /> Reply with AI Assistant</h3>
                      <p className="composer-instructions">
                        Provide instructions (e.g. "Politely decline the offer" or "Ask for availability next Wednesday afternoon"). The AI will read the thread context and formulate a draft.
                      </p>
                      
                      <div className="prompt-input-area">
                        <textarea
                          placeholder="What would you like to reply? (e.g., 'Confirm that I will join the meeting tomorrow at 3 PM')"
                          value={replyPrompt}
                          onChange={(e) => setReplyPrompt(e.target.value)}
                          rows={3}
                          className="reply-prompt-textarea"
                        />
                        <button
                          onClick={handleGenerateReply}
                          disabled={generatingReply || !replyPrompt}
                          className="generate-reply-btn"
                        >
                          {generatingReply ? (
                            <>
                              <RefreshCw className="spin" size={14} />
                              <span>Drafting Reply...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} />
                              <span>Draft Reply with AI</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Display generated reply draft */}
                      {draftReply && (
                        <div className="generated-draft-review glass">
                          <div className="draft-header">
                            <h4>Review Generated Reply</h4>
                            <span className="draft-att">Thread Context Preserved</span>
                          </div>
                          
                          <div className="draft-fields">
                            <div className="draft-field">
                              <label>To:</label>
                              <input 
                                type="text" 
                                value={draftReply.to} 
                                onChange={(e) => setDraftReply({ ...draftReply, to: e.target.value })} 
                              />
                            </div>
                            <div className="draft-field">
                              <label>Subject:</label>
                              <input 
                                type="text" 
                                value={draftReply.subject} 
                                onChange={(e) => setDraftReply({ ...draftReply, subject: e.target.value })} 
                              />
                            </div>
                            <div className="draft-field-body">
                              <label>Body (HTML Edit):</label>
                              <textarea 
                                value={draftReply.body} 
                                onChange={(e) => setDraftReply({ ...draftReply, body: e.target.value })} 
                                rows={8}
                              />
                            </div>
                          </div>

                          <div className="draft-actions">
                            <button
                              onClick={() => handleSendEmail('reply', 'draft')}
                              disabled={sendingEmail}
                              className="draft-action-secondary"
                            >
                              Save to Gmail Drafts
                            </button>
                            <button
                              onClick={() => handleSendEmail('reply', 'send')}
                              disabled={sendingEmail}
                              className="draft-action-primary"
                            >
                              <Send size={14} />
                              Send Email Now
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {actionSuccess && (
                        <div className="action-success-alert">
                          <CheckCircle2 className="success-icon" size={16} />
                          <span>{actionSuccess}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="empty-detail-pane centered-pane">
                    <Mail size={48} className="placeholder-icon" />
                    <h3>No Thread Selected</h3>
                    <p>Select a thread from the list on the left to see conversation messages, generated summaries, and compose AI replies.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: AI CHAT AGENT */}
          {activeTab === 'chat' && (
            <div className="chat-tab-container glass">
              <div className="chat-dialogue-pane">
                <div className="chat-history-scroll">
                  {chatHistory.map((msg, index) => (
                    <div key={index} className={`chat-bubble-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}>
                      <div className="chat-bubble">
                        <div className="bubble-icon">
                          {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                        </div>
                        <div className="bubble-content">
                          <p className="bubble-text">{msg.content}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {sendingChat && (
                    <div className="chat-bubble-row assistant-row">
                      <div className="chat-bubble">
                        <div className="bubble-icon">
                          <Bot size={14} />
                        </div>
                        <div className="bubble-content loading-content">
                          <RefreshCw size={14} className="spin" />
                          <span>AI is searching your inbox knowledge base...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleSendChat} className="chat-input-row">
                  <input
                    type="text"
                    placeholder="Ask about your emails (e.g., 'Summarize Acme Corp emails this month' or 'Any job rejections?')"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    disabled={sendingChat}
                    className="chat-text-input"
                  />
                  <button type="submit" disabled={sendingChat || !chatMessage} className="chat-send-btn">
                    <ArrowRight size={18} />
                  </button>
                </form>
              </div>

              {/* RAG Context / Citation sources sidebar */}
              <div className="chat-sources-sidebar">
                <div className="sources-header">
                  <Layers size={16} />
                  <h3>Cited Email Sources</h3>
                </div>
                
                <div className="sources-list-scroll">
                  {chatSources.length === 0 ? (
                    <div className="sources-empty-state">
                      <MessageSquare size={32} className="placeholder-icon" />
                      <p>When you ask a question, the relevant email references cited in the AI response will appear here.</p>
                    </div>
                  ) : (
                    chatSources.map((source, index) => (
                      <div key={index} className="source-card glass">
                        <div className="source-index">Source [{index + 1}]</div>
                        <h4 className="source-subject">{source.subject}</h4>
                        <div className="source-meta">
                          <span>From: {source.fromName || source.fromAddress}</span>
                          <span>Date: {new Date(source.date).toLocaleDateString()}</span>
                        </div>
                        <div className="source-badge">
                          <span className={`category-badge-mini ${formatCategoryBadgeColor(source.category)}`}>
                            {source.category}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: NEWSLETTER DEDUPLICATOR */}
          {activeTab === 'news' && (
            <div className="news-tab-container glass">
              <div className="news-controls-row">
                <div className="controls-left">
                  <label>Show news from the past:</label>
                  <select 
                    value={dedupDays} 
                    onChange={(e) => setDedupDays(parseInt(e.target.value, 10))}
                    className="days-select"
                  >
                    <option value={2}>2 Days</option>
                    <option value={4}>4 Days</option>
                    <option value={7}>7 Days</option>
                    <option value={14}>14 Days</option>
                  </select>
                </div>
                
                <button 
                  onClick={handleLoadNews} 
                  disabled={loadingNews}
                  className="news-refresh-btn"
                >
                  <RefreshCw className={loadingNews ? 'spin' : ''} size={14} />
                  <span>Deduplicate News</span>
                </button>
              </div>

              <div className="news-feed-scroll">
                {loadingNews ? (
                  <div className="loading-spinner-container centered-pane">
                    <RefreshCw className="spin large-spinner" />
                    <p>Scanning newsletters, extracting stories, and runing semantic deduplication on NVIDIA NIM...</p>
                  </div>
                ) : newsFeed.length === 0 ? (
                  <div className="empty-news-state">
                    <Newspaper size={48} className="placeholder-icon" />
                    <h3>No News Compiled</h3>
                    <p>No recent newsletter emails found, or no topics extracted. Make sure you have newsletters synced for this time period.</p>
                  </div>
                ) : (
                  <div className="news-cards-grid">
                    {newsFeed.map((item, idx) => (
                      <div key={idx} className="news-card glass">
                        <div className="news-card-badge-row">
                          <span className="news-badge-tag">{item.category || 'Tech'}</span>
                          <span className="news-sources-count">{item.sources.length} sources</span>
                        </div>
                        <h3 className="news-title">{item.title}</h3>
                        <p className="news-summary">{item.summary}</p>
                        
                        <div className="news-sources-citations">
                          <strong>Reported by:</strong>
                          <div className="sources-pills-row">
                            {item.sources.map((src, sIdx) => (
                              <span key={sIdx} className="source-pill">{src}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: COMPOSE NEW EMAIL */}
          {activeTab === 'compose' && (
            <div className="compose-tab-container glass">
              <div className="compose-form-card">
                <h3><Sparkles size={18} className="sparkle-gold" /> Compose Professional Email with AI</h3>
                <p className="compose-instructions">
                  Input a short prompt explaining what you want to write (e.g. "Write a follow-up to client requesting feedback on our proposal"). The AI will generate a complete, professional draft.
                </p>

                <div className="compose-prompt-row">
                  <textarea
                    placeholder="Enter email instructions..."
                    value={composePrompt}
                    onChange={(e) => setComposePrompt(e.target.value)}
                    rows={4}
                    className="compose-prompt-textarea"
                  />
                  <button
                    onClick={handleGenerateCompose}
                    disabled={generatingCompose || !composePrompt}
                    className="generate-compose-btn"
                  >
                    {generatingCompose ? (
                      <>
                        <RefreshCw className="spin" size={14} />
                        <span>Generating Draft...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        <span>Generate Draft</span>
                      </>
                    )}
                  </button>
                </div>

                {draftCompose && (
                  <div className="generated-compose-review glass">
                    <div className="draft-header">
                      <h4>Edit and Output Email</h4>
                    </div>

                    <div className="draft-fields">
                      <div className="draft-field">
                        <label>To (Email):</label>
                        <input 
                          type="email" 
                          placeholder="recipient@example.com"
                          value={draftCompose.to} 
                          onChange={(e) => setDraftCompose({ ...draftCompose, to: e.target.value })} 
                        />
                      </div>
                      <div className="draft-field">
                        <label>Subject:</label>
                        <input 
                          type="text" 
                          value={draftCompose.subject} 
                          onChange={(e) => setDraftCompose({ ...draftCompose, subject: e.target.value })} 
                        />
                      </div>
                      <div className="draft-field-body">
                        <label>Body (HTML):</label>
                        <textarea 
                          value={draftCompose.body} 
                          onChange={(e) => setDraftCompose({ ...draftCompose, body: e.target.value })} 
                          rows={12}
                        />
                      </div>
                    </div>

                    <div className="draft-actions">
                      <button
                        onClick={() => handleSendEmail('compose', 'draft')}
                        disabled={sendingEmail || !draftCompose.to}
                        className="draft-action-secondary"
                        title={!draftCompose.to ? 'Enter a Recipient Email address first' : ''}
                      >
                        Save to Gmail Drafts
                      </button>
                      <button
                        onClick={() => handleSendEmail('compose', 'send')}
                        disabled={sendingEmail || !draftCompose.to}
                        className="draft-action-primary"
                        title={!draftCompose.to ? 'Enter a Recipient Email address first' : ''}
                      >
                        <Send size={14} />
                        Send Email Now
                      </button>
                    </div>
                  </div>
                )}

                {actionSuccess && (
                  <div className="action-success-alert">
                    <CheckCircle2 className="success-icon" size={16} />
                    <span>{actionSuccess}</span>
                  </div>
                )}
              </div>
            </div>
          )}

        </section>
      </main>
    </div>
  );
}
