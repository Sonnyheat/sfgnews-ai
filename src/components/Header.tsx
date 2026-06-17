import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        <Link to="/en" className="text-xl font-bold text-blue-700 tracking-tight">
          SFGNews.ai
        </Link>
        <nav className="flex gap-6 text-sm text-gray-600">
          <Link to="/en" className="hover:text-blue-700 transition-colors">Home</Link>
        </nav>
      </div>
    </header>
  )
}
