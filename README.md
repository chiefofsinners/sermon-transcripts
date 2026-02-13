# Sermon Transcripts

A full-text search engine for sermon transcripts, built with Next.js. Upload MP3s, transcribe them automatically, and search across all your sermons.

## Features

- **Full-text search** across sermon titles, metadata, and transcript content with highlighted snippet previews
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
| `OPENAI_API_KEY` | For Whisper transcription |

## Data Pipeline

Sermon data is stored as JSON files in `data/sermons/`. You can populate sermons in two ways:

### 1. Upload via the web UI

Visit `/upload`, authenticate with your `UPLOAD_PASSWORD`, and upload an MP3. The sermon will be transcribed and committed to GitHub automatically.

### 2. Import from SermonAudio (optional)

If you have a SermonAudio account, set `SERMONAUDIO_API_KEY` and `SERMONAUDIO_BROADCASTER_ID` in your `.env`, then:

```bash
npm run download        # Fetch sermons from SermonAudio API
npm run generate-index  # Build the search index
```

| Command | Description |
|---|---|
| `npm run download` | Fetch new sermons from SermonAudio API |
| `npm run generate-index` | Build the compressed search index and filter options |
| `npm run pipeline` | Run the full pipeline (download + build) |

The search index is generated at build time (`prebuild`) and served as a gzipped JSON bundle from `public/`.

## Project Structure

```
data/sermons/          # Sermon JSON files (committed)
scripts/
  download.ts          # Fetches sermons from SermonAudio API
  generate-index.ts    # Builds FlexSearch index + filter metadata
  import-transcripts.sh # Import transcript text files into sermon JSON
  setup-gcs-cors.sh    # One-time GCS CORS setup for direct uploads
src/app/
  page.tsx             # Homepage — search, filters, sermon list
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

Deploy to Vercel and set all environment variables from `.env.example` in your Vercel project settings. Use `GOOGLE_CREDENTIALS` (JSON string) instead of `GOOGLE_APPLICATION_CREDENTIALS` (file path) in production.
