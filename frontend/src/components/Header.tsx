import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function Header() {
  return (
    <header
      className="border-b px-6 py-4"
      style={{
        background: 'rgba(5, 25, 14, 0.92)',
        borderColor: 'rgba(212, 175, 55, 0.2)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black tracking-tight text-gold">Smartfolio</span>
          <span className="badge-gold hidden sm:inline">v1</span>
        </div>
        <ConnectButton />
      </div>
    </header>
  )
}
