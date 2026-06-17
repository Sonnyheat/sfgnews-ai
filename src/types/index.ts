export interface SignalArticle {
  id: string
  headline: string
  slug: string
  pillar: string | null
  author: string | null
  date_published: string | null
  content_en: string | null
  publish_status: string | null
  persona_target: string | null
  signal_event_type: string | null
}

export type Pillar = 'final-expense' | 'mortgage-protection' | 'debt-action-plan' | 'news' | null

export const PILLAR_LABELS: Record<string, string> = {
  'final-expense': 'Final Expense',
  'mortgage-protection': 'Mortgage Protection',
  'debt-action-plan': 'Debt Action Plan',
  'news': 'News',
}

export const PILLAR_FILTERS = [
  { value: null, label: 'All' },
  { value: 'final-expense', label: 'Final Expense' },
  { value: 'mortgage-protection', label: 'Mortgage Protection' },
  { value: 'debt-action-plan', label: 'Debt Action Plan' },
  { value: 'news', label: 'News' },
]
