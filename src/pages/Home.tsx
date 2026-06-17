import { useState } from 'react'
import ArticleCard from '../components/ArticleCard'
import PillarFilter from '../components/PillarFilter'
import { useArticles } from '../hooks/useArticles'

export default function Home() {
  const [activePillar, setActivePillar] = useState<string | null>(null)
  const { data: articles, isLoading, error } = useArticles(activePillar)

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">Insurance News & Insights</h1>
        <p className="text-gray-500">
          Trusted guidance on Final Expense, Mortgage Protection, and financial planning for Florida families.
        </p>
      </div>

      <div className="mb-8">
        <PillarFilter active={activePillar} onChange={setActivePillar} />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-red-600">Failed to load articles. Please try again.</p>
      )}

      {!isLoading && !error && Array.isArray(articles) && articles.length === 0 && (
        <p className="text-gray-500">No articles found for this category.</p>
      )}

      {!isLoading && !error && Array.isArray(articles) && articles.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </main>
  )
}
