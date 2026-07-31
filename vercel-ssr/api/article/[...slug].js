/**
 * Vercel Serverless Function — Article SSR for AI Recognition
 *
 * This function intercepts ALL requests to article URLs and serves
 * complete HTML with proper meta tags, JSON-LD schemas, and article
 * content so AI crawlers and search engines can read the page.
 *
 * Deploy: place this file at /api/article/[...slug].js in your Vercel project.
 * Then add the rewrite rules from vercel.json to route article URLs here.
 *
 * Environment variables needed:
 *   SUPABASE_URL        = https://pysqnsjvbqfwiarhrejo.supabase.co
 *   SUPABASE_ANON_KEY   = your anon/public key
 */

export default async function handler(req, res) {
  const slugParts = req.query.slug; // e.g. ["debt-action-plan", "debt-action-plan-in-port-st-lucie-florida"]
  if (!slugParts || slugParts.length === 0) {
    return res.status(404).send('Article not found');
  }

  const articleSlug = slugParts[slugParts.length - 1]; // last segment is the article slug

  try {
    // Fetch article from Supabase
    const supabaseUrl = process.env.SUPABASE_URL || 'https://pysqnsjvbqfwiarhrejo.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const apiUrl = `${supabaseUrl}/rest/v1/signal_articles?slug=eq.${encodeURIComponent(articleSlug)}&publish_status=eq.published&select=*&limit=1`;

    const response = await fetch(apiUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    const articles = await response.json();
    if (!articles || articles.length === 0) {
      return res.status(404).send('Article not found');
    }

    const article = articles[0];
    const html = buildArticlePage(article);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(html);

  } catch (error) {
    console.error('Article SSR error:', error);
    return res.status(500).send('Internal server error');
  }
}

function buildArticlePage(article) {
  const headline = article.headline || 'Untitled';
  const metaTitle = article.meta_title || `${headline} | SFGNews.ai`;
  const metaDescription = article.meta_description || article.og_description || '';
  const canonicalUrl = article.canonical_url || article.article_url || `https://www.sfgnews.ai/en/${(article.pillar || 'articles').replace(/_/g, '-')}/${article.slug}`;
  const ogTitle = article.og_title || headline;
  const ogDescription = article.og_description || metaDescription;
  const ogImage = article.og_image_url || 'https://www.sfgnews.ai/og-default.jpg';
  const datePublished = article.date_published ? new Date(article.date_published).toISOString().split('T')[0] : '';
  const dateModified = article.date_modified ? new Date(article.date_modified).toISOString().split('T')[0] : datePublished;

  // Convert markdown content to HTML
  const contentHtml = markdownToHtml(article.content_en || '');

  // Build JSON-LD blocks
  const articleSchema = article.article_schema_json || buildArticleSchema(article, canonicalUrl, datePublished, dateModified);
  const faqSchema = article.faq_schema || null;
  const breadcrumbSchema = article.breadcrumb_schema_json || buildBreadcrumbSchema(article, canonicalUrl);

  const jsonLdBlocks = [articleSchema, faqSchema, breadcrumbSchema]
    .filter(Boolean)
    .map(schema => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <!-- Primary Meta -->
    <title>${escapeHtml(metaTitle)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta name="robots" content="index, follow" />

    <!-- Open Graph -->
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(ogDescription)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:site_name" content="SFGNews.ai" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    ${datePublished ? `<meta property="article:published_time" content="${datePublished}T00:00:00-04:00" />` : ''}
    ${dateModified ? `<meta property="article:modified_time" content="${dateModified}T00:00:00-04:00" />` : ''}
    <meta property="article:author" content="Alex, SFG AI Advisor" />
    <meta property="article:section" content="${escapeHtml((article.pillar || '').replace(/[_-]/g, ' '))}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

    <!-- JSON-LD Structured Data -->
    ${jsonLdBlocks}

    <!-- Organization Schema (site-wide) -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ProfessionalService",
      "name": "Sunny Financial Group",
      "url": "https://sunnyfinancialgroup.com",
      "description": "Financial planning and life insurance education for Florida households.",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Sarasota",
        "addressRegion": "FL",
        "addressCountry": "US"
      },
      "employee": {
        "@type": "Person",
        "name": "Jeff Maiorana",
        "jobTitle": "Licensed Financial Professional",
        "qualifications": "FL License W725473"
      },
      "sameAs": ["https://www.sfgnews.ai"]
    }
    </script>

    <style>
      :root { --bg: #fff; --text: #1a1a2e; --muted: #6b7280; --accent: #1e40af; --border: #e5e7eb; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
      .container { max-width: 760px; margin: 0 auto; padding: 40px 24px; }
      .breadcrumb { font-size: 0.85rem; color: var(--muted); margin-bottom: 24px; }
      .breadcrumb a { color: var(--accent); text-decoration: none; }
      .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 32px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
      h1 { font-size: 2rem; font-weight: 700; line-height: 1.3; margin-bottom: 16px; }
      h2 { font-size: 1.4rem; font-weight: 600; margin: 32px 0 12px; }
      h3 { font-size: 1.15rem; font-weight: 600; margin: 24px 0 8px; }
      p { margin-bottom: 16px; }
      ul, ol { margin: 0 0 16px 24px; }
      li { margin-bottom: 6px; }
      a { color: var(--accent); }
      blockquote { border-left: 3px solid var(--accent); padding-left: 16px; margin: 16px 0; color: var(--muted); font-style: italic; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { padding: 10px 14px; border: 1px solid var(--border); text-align: left; }
      th { background: #f9fafb; font-weight: 600; }
      .faq-section { margin-top: 40px; }
      .faq-q { font-weight: 600; margin-top: 20px; }
      .faq-a { margin-top: 4px; }
      .cta { background: #f0f4ff; border-radius: 10px; padding: 24px; margin-top: 40px; }
      .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="https://www.sfgnews.ai/en">Home</a> &rsaquo;
            <a href="https://www.sfgnews.ai/en/${escapeHtml((article.pillar || 'articles').replace(/_/g, '-'))}">${escapeHtml((article.pillar || 'Articles').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</a> &rsaquo;
            ${escapeHtml(headline)}
        </nav>

        <article>
            <h1>${escapeHtml(headline)}</h1>
            <div class="meta">
                <span>Author: Alex, SFG AI Advisor</span> &bull;
                <span>Reviewed by: Jeff Maiorana, FL License W725473</span><br>
                ${datePublished ? `<span>Published: ${datePublished}</span>` : ''}
                ${dateModified && dateModified !== datePublished ? ` &bull; <span>Updated: ${dateModified}</span>` : ''}
            </div>
            ${contentHtml}
        </article>

        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} SFGNews.ai &mdash; An educational resource by Sunny Financial Group. All content is for informational purposes and does not constitute financial advice.</p>
        </div>
    </div>
</body>
</html>`;
}

function buildArticleSchema(article, canonicalUrl, datePublished, dateModified) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": article.headline || 'Untitled',
    "description": article.meta_description || article.og_description || '',
    "author": {
      "@type": "Person",
      "name": "Alex, SFG AI Advisor",
      "jobTitle": "AI Advisor",
      "worksFor": { "@type": "Organization", "name": "Sunny Financial Group" }
    },
    "reviewedBy": {
      "@type": "Person",
      "name": "Jeff Maiorana",
      "jobTitle": "Licensed Financial Professional",
      "qualifications": "FL License W725473",
      "worksFor": { "@type": "Organization", "name": "Sunny Financial Group" }
    },
    "publisher": {
      "@type": "Organization",
      "name": "SFGNews.ai",
      "url": "https://www.sfgnews.ai"
    },
    "datePublished": datePublished,
    "dateModified": dateModified,
    "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
    "url": canonicalUrl
  };
}

function buildBreadcrumbSchema(article, canonicalUrl) {
  const pillarSlug = (article.pillar || 'articles').replace(/_/g, '-');
  const pillarName = (article.pillar || 'articles').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.sfgnews.ai/en" },
      { "@type": "ListItem", "position": 2, "name": pillarName, "item": `https://www.sfgnews.ai/en/${pillarSlug}` },
      { "@type": "ListItem", "position": 3, "name": article.headline, "item": canonicalUrl }
    ]
  };
}

function markdownToHtml(md) {
  if (!md) return '';
  return md
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Unordered lists
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---+$/gm, '<hr>')
    // Paragraphs (lines not already tagged)
    .replace(/^(?!<[hul\/>bla])((?!\s*$).+)$/gm, '<p>$1</p>')
    // Clean up double newlines
    .replace(/\n{2,}/g, '\n');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
