import { PILLAR_FILTERS } from '../types'

interface PillarFilterProps {
  active: string | null
  onChange: (pillar: string | null) => void
}

export default function PillarFilter({ active, onChange }: PillarFilterProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {PILLAR_FILTERS.map(({ value, label }) => (
        <button
          key={label}
          onClick={() => onChange(value)}
          className={`inline-flex min-h-[48px] items-center justify-center rounded-full px-5 py-2 text-sm font-medium transition-colors ${
            active === value
              ? 'bg-blue-700 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
