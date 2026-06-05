import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function Header() {
  return (
    <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between max-w-6xl mx-auto">
        <span className="text-xl font-bold text-emerald-400">Smartfolio</span>
        <ConnectButton />
      </div>
    </header>
  )
}
