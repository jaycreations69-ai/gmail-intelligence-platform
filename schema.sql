-- Enable the pgvector extension to work with embeddings
create extension if not exists vector;

-- Users Table
create table if not exists public.users (
    id uuid default gen_random_uuid() primary key,
    email text unique not null,
    google_access_token text,
    google_refresh_token text,
    google_token_expiry timestamptz,
    sync_status text default 'idle', -- 'idle', 'syncing', 'completed', 'failed'
    last_sync_time timestamptz,
    created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Threads Table
create table if not exists public.threads (
    id text primary key, -- Gmail Thread ID
    user_id uuid references public.users(id) on delete cascade not null,
    subject text,
    summary text,
    category text, -- Consolidated category of the thread
    updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Emails Table
create table if not exists public.emails (
    id text primary key, -- Gmail Message ID
    thread_id text references public.threads(id) on delete cascade not null,
    user_id uuid references public.users(id) on delete cascade not null,
    subject text,
    snippet text,
    body_text text,
    body_html text,
    from_address text not null,
    from_name text,
    to_address text,
    date timestamptz not null,
    labels text[] default '{}',
    category text, -- Individual categorization
    summary text, -- Individual email summary
    embedding vector(768), -- Gemini embedding (size 768)
    created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Create index on user_id for faster lookups
create index if not exists emails_user_id_idx on public.emails(user_id);
create index if not exists threads_user_id_idx on public.threads(user_id);
create index if not exists emails_date_idx on public.emails(date desc);

-- Create HNSW index for pgvector search
create index if not exists emails_embedding_hnsw_idx 
on public.emails using hnsw (embedding vector_cosine_ops);

-- Similarity Search Function
create or replace function match_emails(
    query_embedding vector(768),
    match_threshold float,
    match_count int,
    p_user_id uuid
)
returns table (
    id text,
    thread_id text,
    subject text,
    snippet text,
    from_name text,
    from_address text,
    date timestamptz,
    category text,
    summary text,
    similarity float
)
language plpgsql
as $$
begin
    return query
    select
        e.id,
        e.thread_id,
        e.subject,
        e.snippet,
        e.from_name,
        e.from_address,
        e.date,
        e.category,
        e.summary,
        1 - (e.embedding <=> query_embedding) as similarity
    from public.emails e
    where e.user_id = p_user_id
      and 1 - (e.embedding <=> query_embedding) > match_threshold
    order by e.embedding <=> query_embedding
    limit match_count;
end;
$$;
