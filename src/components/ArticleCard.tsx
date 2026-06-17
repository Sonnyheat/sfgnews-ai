import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import type { SignalArticle } from '../types'
import { PILLAR_LABELS } from '../types'

interface ArticleCardProps {
  article: SignalArticle
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const pillarSlug = article.pillar ?? 'news'
  const pillarLabel = article.pillar ? (PILLAR_LABELS[article.pillar] ?? article.pillar) : 'News'
  const publishedDate = article.date_published
    ? format(new Date(article.date_published), 'MMM d, yyyy')
    : null

  return (
    <Link
      to={`/en/${pillarSlug}/${article.slug}`}
      className="group block rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block rounded-full bg-blue-100 px-3 py-0.5 text-xs font-medium text-blue-700">
          {pillarLabel}
        </span>
      </div>
      <h2 className="mb-3 text-lg font-semibold leading-snug text-gray-900 group-hover:text-blue-700 transition-colors">
        {article.headline}
      </h2>
      <div className="mt-auto flex items-center justify-between text-sm text-gray-500">
        <span>{article.author ?? 'Jeff Maiorana'}</span>
        {publishedDate && <span>{publishedDate}</span>}
      </div>
    </Link>
  )
}
