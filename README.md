# Sermon Transcripts

A full-text search engine for sermon transcripts, built with Next.js. Upload MP3s, transcribe them automatically, and search across all your sermons.

## Features

- **Full-text search** across sermon titles, metadata, and transcript content with highlighted snippet previews
- **AI search** — an agent retrieves relevant transcript passages from a pgvector store and answers in prose, citing the sermons it drew on
- **Filtering** by preacher, series, keywords, and Bible passage — filters narrow dynamically based on each other
- **Bible passage picker** for finding sermons on specific books, chapters, or verses
- **Upload & transcribe** MP3 sermons via OpenAI Whisper or Google Cloud Speech-to-Text
- **Auto-commit** transcribed sermons to GitHub, triggering automatic redeployment
- **Sermon reader** with configurable font size and font family
- **Dark mode** support
- **SEO** with dynamic sitemap generation

## Tech Stack

- Next.js / React / TypeScript
- Tailwind CSS v4
- FlexSearch (client-side full-text search via a pre-built compressed index)
- Supabase Postgres + pgvector (AI search vector store)
- Vercel AI SDK — Anthropic / OpenAI / Google / xAI / DeepSeek
- Google Cloud Storage + Speech-to-Text / OpenAI Whisper
- Deployed on Vercel

## Getting Started

1. **Clone this template** and install dependencies:

```bash
npm install
```

2. **Copy `.env.example` to `.env`** and fill in your values:

```bash
cp .env.example .env
```

3. **Add your church logo** as `public/logo.png` (used for OpenGraph images).

4. **Run the dev server:**

```bash
npm run dev
```

### Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_TITLE` | Displayed in the header and page title |
| `NEXT_PUBLIC_CHURCH_NAME` | Used in meta descriptions |
| `NEXT_PUBLIC_SITE_URL` | Deployed URL (used for sitemap) |
| `UPLOAD_PASSWORD` | Password for the upload page |
| `GCS_BUCKET_NAME` | Google Cloud Storage bucket for audio files |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID for Speech-to-Text |
| `GITHUB_TOKEN` | PAT for auto-committing transcribed sermons |
| `GITHUB_REPO` | `org/repo` for sermon data commits |
| `OPENAI_API_KEY` | Whisper transcription and embeddings |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (AI search vector store) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_DATABASE_URL` | Postgres connection string, for applying `supabase/schema.sql` |
| `ANTHROPIC_API_KEY` | Default provider for AI search |

## Data Pipeline

Sermon data is stored as JSON files in `data/sermons/`. You can populate sermons in two ways:

### 1. Upload via the web UI

Visit `/upload`, authenticate with your `UPLOAD_PASSWORD`, and upload an MP3. The sermon will be transcribed and committed to GitHub automatically.

This does not embed the sermon for AI search — run `npm run generate-embeddings` afterwards, or the sermon will be searchable but invisible to AI mode. See [AI Search](#ai-search).

### 2. Import from SermonAudio (optional)

If you have a SermonAudio account, set `SERMONAUDIO_API_KEY` and `SERMONAUDIO_BROADCASTER_ID` in your `.env`, then:

```bash
npm run download            # Fetch sermons from SermonAudio API
npm run generate-embeddings # Embed new sermons for AI search
npm run generate-index      # Build the search index
```

| Command | Description |
|---|---|
| `npm run download` | Fetch new sermons from SermonAudio API |
| `npm run generate-index` | Build the compressed search index and filter options |
| `npm run generate-embeddings` | Embed any not-yet-indexed chunks into Supabase, and repair filterable metadata |
| `npm run rebuild-embeddings` | Re-embed every chunk in place (see AI search below) |
| `npm run pipeline` | Run the full pipeline (download + embeddings + build) |

The search index is generated at build time (`prebuild`) and served as a gzipped JSON bundle from `public/`.

## AI Search

AI search is separate from the FlexSearch index: an agent queries a pgvector store in Supabase, so **it does not update when you deploy** — sermons only become answerable once their embeddings exist.

### One-time setup

Apply the schema, which creates the tables, the HNSW index, and the `search_chunks` / `list_sermons` functions:

```bash
psql "$SUPABASE_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

It is idempotent, so re-run it whenever `supabase/schema.sql` changes.

> Use Supabase's **session pooler** host in `SUPABASE_DATABASE_URL`, not `db.<ref>.supabase.co`. The direct host is IPv6-only and unreachable from most networks. The pooler also expects `postgres.<ref>` as the username.

Two settings on `search_chunks` matter more than they look. pgvector applies the function's `WHERE` clause *after* the HNSW index has returned its candidates, and the index stops at `ef_search` (40) of them — so a filtered search silently returns far fewer rows than asked for, often zero, which the agent reads as "no such sermon exists". `hnsw.iterative_scan = 'strict_order'` makes the index keep going until it has enough rows that pass the filter.

### Keeping it current

```bash
npm run generate-embeddings
```

Embeds any chunks not already in the store, and repairs metadata the AI filters depend on (`series_name`, canonical preacher names). Safe and quick to re-run — it reports `Metadata in sync` and `All chunks already indexed` when there is nothing to do. `npm run pipeline` includes it.

### Re-embedding everything

```bash
npm run rebuild-embeddings
```

Needed only when the embedding input changes — a different `EMBEDDING_MODEL`, or an edit to `embeddingText` in `src/lib/chunking.ts`. Rows are overwritten as their replacements arrive rather than deleted up front, so AI search keeps working throughout; chunks the current data no longer produces are pruned at the end.

### Duplicate preachers

SermonAudio sometimes holds one person under two speaker records ("Chris Richards" and "Dr. Chris Richards"), which splits them across the filter dropdown and halves what the AI agent's preacher filter can see. Add an entry to `PREACHER_ALIASES` in `src/lib/preachers.ts` and re-run `npm run generate-index` and `npm run generate-embeddings`. The JSON in `data/` keeps SermonAudio's original values, so a re-download won't undo it.

## Project Structure

```
data/sermons/          # Sermon JSON files (committed)
scripts/
  download.ts          # Fetches sermons from SermonAudio API
  generate-index.ts    # Builds FlexSearch index + filter metadata
  generate-embeddings.ts # Embeds chunks into the Supabase vector store
  import-transcripts.sh # Import transcript text files into sermon JSON
  setup-gcs-cors.sh    # One-time GCS CORS setup for direct uploads
supabase/
  schema.sql           # Tables, HNSW index, and search RPCs (apply by hand)
src/lib/
  preachers.ts         # Canonical preacher names for duplicated speakers
src/app/
  page.tsx             # Homepage — search, filters, sermon list
  api/ai-search/       # AI search agent (retrieval + streamed answer)
  sermon/[id]/         # Sermon detail page (statically generated)
  upload/              # Upload page for MP3 transcription
  api/upload/          # Upload API routes (auth, signed-url, transcription)
  api/snippets/        # API route for search result snippet extraction
  sitemap.ts           # Dynamic sitemap
public/
  logo.png             # Church logo (replace with your own)
  search-index.json.gz # Pre-built compressed search index (generated)
  filters.json         # Available filter options (generated)
```

## Deployment

Deploy to Vercel and set all environment variables from `.env.example` in your Vercel project settings. For Google Cloud credentials in production, use one of:

- `GOOGLE_CREDENTIALS` — the raw JSON string of your service account key
- `GOOGLE_CREDENTIALS_BASE64` — the base64-encoded service account JSON (useful if your platform has issues with raw JSON in env vars: `base64 < service-account-key.json`)
