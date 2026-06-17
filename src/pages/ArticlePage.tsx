import { useParams, Link, Navigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { format } from 'date-fns'
import { useArticle } from '../hooks/useArticles'
import { PILLAR_LABELS } from '../types'

export default function ArticlePage() {
  const { pillar, slug } = useParams<{ pillar: string; slug: string }>()
  const { data: article, isLoading, error } = useArticle(slug ?? '')

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="space-y-4">
          <div className="h-8 w-3/4 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (error || article === null) {
    return <Navigate to="/en" replace />
  }

  if (!article) return null

  const pillarSlug = article.pillar ?? 'news'
  const pillarLabel = article.pillar ? (PILLAR_LABELS[article.pillar] ?? article.pillar) : 'News'
  const publishedDate = article.date_published
    ? format(new Date(article.date_published), 'MMMM d, yyyy')
    : null

  // If pillar in URL doesn't match the article's pillar, redirect to correct URL
  if (pillar && article.pillar && pillar !== article.pillar) {
    return <Navigate to={`/en/${article.pillar}/${article.slug}`} replace />
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/en" className="hover:text-blue-700 transition-colors">Home</Link>
        <span>/</span>
        <Link
          to={`/en?pillar=${pillarSlug}`}
          className="hover:text-blue-700 transition-colors"
        >
          {pillarLabel}
        </Link>
        <span>/</span>
        <span className="truncate text-gray-700">{article.headline}</span>
      </nav>

      <div className="mb-4">
        <span className="inline-block rounded-full bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-700">
          {pillarLabel}
        </span>
      </div>

      <h1 className="mb-4 text-3xl font-bold leading-snug text-gray-900">
        {article.headline}
      </h1>

      <div className="mb-8 flex items-center gap-3 text-sm text-gray-500">
        <span>{article.author ?? 'Jeff Maiorana'}</span>
        {publishedDate && (
          <>
            <span>·</span>
            <time dateTime={article.date_published ?? undefined}>{publishedDate}</time>
          </>
        )}
      </div>

      <article className="prose prose-gray max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {article.content_en ?? ''}
        </ReactMarkdown>
      </article>

      <div className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <p>
          Licensed Insurance Agent — FL License W725473 &middot; Sunny Financial Group
        </p>
      </div>
    </main>
  )
}
