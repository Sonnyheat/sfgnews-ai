import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { SignalArticle } from '../types'

export function useArticles(pillar: string | null) {
  return useQuery<SignalArticle[]>({
    queryKey: ['articles', pillar],
    queryFn: async (): Promise<SignalArticle[]> => {
      let query = supabase
        .from('signal_articles')
        .select('id, headline, slug, pillar, author, date_published, publish_status, persona_target, signal_event_type, content_en')
        .eq('publish_status', 'published')
        .order('date_published', { ascending: false })
        .limit(6)

      if (pillar) {
        query = query.eq('pillar', pillar)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as SignalArticle[]
    },
  })
}

export function useArticle(slug: string) {
  return useQuery<SignalArticle | null>({
    queryKey: ['article', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signal_articles')
        .select('*')
        .eq('slug', slug)
        .eq('publish_status', 'published')
        .single()

      if (error) {
        if (error.code === 'PGRST116') return null
        throw error
      }
      return data
    },
  })
}
