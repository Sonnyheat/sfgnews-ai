# Vercel SSR for SFGNews.ai — Deployment Guide

## What This Does

This serverless function intercepts article URLs and serves complete HTML with:
- Proper `<title>`, meta description, canonical URL
- Open Graph + Twitter Card tags (for social sharing & AI crawlers)
- JSON-LD structured data (Article, FAQPage, BreadcrumbList, ProfessionalService)
- Full article content rendered as HTML (not blank SPA shell)

AI crawlers (ChatGPT, Perplexity, Google AI Overviews) will now see your full article content instead of an empty React shell.

## Files

```
vercel-ssr/
├── api/
│   └── article/
│       └── [...slug].js    ← Serverless function (catch-all route)
├── vercel.json              ← Rewrite rules
└── DEPLOY.md                ← This file
```

## Setup Steps

### 1. Environment Variables

In your Vercel project dashboard → Settings → Environment Variables, add:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://pysqnsjvbqfwiarhrejo.supabase.co` |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |

### 2. Add Files to Your Vercel Project

Copy the `api/` folder and `vercel.json` into the root of your Vercel project (the one connected to sfgnews.ai).

**If you already have a `vercel.json`**, merge the `rewrites` array into your existing file. The rewrites should come BEFORE any catch-all SPA rewrite.

### 3. Deploy

Push to your connected Git repo, or run:
```bash
vercel --prod
```

### 4. Verify

After deploying, test with curl to confirm AI crawlers see the full page:

```bash
curl -s https://www.sfgnews.ai/en/debt-action-plan/debt-action-plan-in-port-st-lucie-florida | head -50
```

You should see a full `<!DOCTYPE html>` page with `<title>`, `<meta>`, and `<script type="application/ld+json">` tags.

## How It Works

1. A request hits `/en/debt-action-plan/some-article-slug`
2. Vercel's rewrite routes it to `/api/article/debt-action-plan/some-article-slug`
3. The serverless function extracts the last slug segment
4. It queries `signal_articles` in Supabase for that slug
5. It renders complete HTML with all SEO/AI metadata and returns it
6. Response is cached for 1 hour (`s-maxage=3600`) with stale-while-revalidate

## Notes

- The function uses the **last** URL segment as the article slug, so both `/en/pillar/slug` and `/en/slug` patterns work.
- Existing client-side routing still works — the SSR page includes the full article content, and the React app can hydrate on top if needed.
- Cache headers ensure fast responses while keeping content fresh.
