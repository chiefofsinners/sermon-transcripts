-- Enable pgvector extension
create extension if not exists vector;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists sermons (
  sermon_id   text primary key,
  title       text not null,
  preacher    text not null,
  preach_date date,
  bible_text  text,
  series      text,
  event_type  text,
  keywords    text,
  subtitle    text,
  transcript  text not null
);

create table if not exists sermon_chunks (
  id            bigint generated always as identity primary key,
  sermon_id     text not null references sermons(sermon_id) on delete cascade,
  chunk_index   int not null,
  text          text not null,
  embedding     vector(1536),
  unique (sermon_id, chunk_index)
);

-- ============================================================
-- Indexes
-- ============================================================

-- Vector similarity search (HNSW, cosine)
-- HNSW maintains accuracy as data is inserted, unlike IVF-Flat which
-- requires rebuilding after bulk loads.
create index if not exists idx_chunks_embedding
  on sermon_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Metadata filters on sermons
create index if not exists idx_sermons_preacher   on sermons (preacher);
create index if not exists idx_sermons_series     on sermons (series);
create index if not exists idx_sermons_preach_date on sermons (preach_date);

-- Full-text search on keywords
create index if not exists idx_sermons_keywords
  on sermons using gin (to_tsvector('english', coalesce(keywords, '')));

-- ============================================================
-- RPC: search_chunks
-- Vector similarity search with optional metadata filters.
-- Returns chunks joined with sermon metadata, ordered by similarity.
-- ============================================================

create or replace function search_chunks(
  query_embedding     vector(1536),
  match_count         int default 20,
  filter_preacher     text default null,
  filter_series       text default null,
  filter_date_from    date default null,
  filter_date_to      date default null,
  filter_bible_text   text default null
)
returns table (
  sermon_id   text,
  title       text,
  preacher    text,
  preach_date date,
  bible_text  text,
  series      text,
  chunk_index int,
  chunk_text  text,
  similarity  float
)
language plpgsql
as $$
begin
  return query
    select
      s.sermon_id,
      s.title,
      s.preacher,
      s.preach_date,
      s.bible_text,
      s.series,
      c.chunk_index,
      c.text as chunk_text,
      1 - (c.embedding <=> query_embedding) as similarity
    from sermon_chunks c
    join sermons s on s.sermon_id = c.sermon_id
    where
      (filter_preacher is null or s.preacher ilike '%' || filter_preacher || '%')
      and (filter_series is null or s.series = filter_series)
      and (filter_date_from is null or s.preach_date >= filter_date_from)
      and (filter_date_to is null or s.preach_date <= filter_date_to)
      and (filter_bible_text is null or s.bible_text ilike '%' || filter_bible_text || '%')
    order by c.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- ============================================================
-- RPC: list_sermons
-- Pure metadata search (no vectors).
-- ============================================================

create or replace function list_sermons(
  filter_preacher     text default null,
  filter_series       text default null,
  filter_date_from    date default null,
  filter_date_to      date default null,
  match_limit         int default 50
)
returns table (
  sermon_id   text,
  title       text,
  preacher    text,
  preach_date date,
  bible_text  text,
  series      text,
  event_type  text,
  subtitle    text
)
language plpgsql
as $$
begin
  return query
    select
      s.sermon_id,
      s.title,
      s.preacher,
      s.preach_date,
      s.bible_text,
      s.series,
      s.event_type,
      s.subtitle
    from sermons s
    where
      (filter_preacher is null or s.preacher ilike '%' || filter_preacher || '%')
      and (filter_series is null or s.series = filter_series)
      and (filter_date_from is null or s.preach_date >= filter_date_from)
      and (filter_date_to is null or s.preach_date <= filter_date_to)
    order by s.preach_date desc nulls last
    limit match_limit;
end;
$$;
