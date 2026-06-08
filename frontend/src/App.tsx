import { useState } from 'react'
import { CONTRACT_ADDRESS } from './contracts'
import Header from './components/Header'
import InfoCard from './components/InfoCard'
import MintForm from './components/MintForm'
import BurnForm from './components/BurnForm'
import DivestForm from './components/DivestForm'
import LeverageInfoCard from './components/LeverageInfoCard'
import MintLeverageForm from './components/MintLeverageForm'
import DivestLeverageForm from './components/DivestLeverageForm'
import KeeperPanel from './components/KeeperPanel'
import WrapUnwrapPanel from './components/WrapUnwrapPanel'

type Tab = 'mint' | 'burn' | 'divest' | 'leverage' | 'wrap'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const TAB_LABELS: Record<Tab, string> = {
  mint:     'Mint',
  burn:     'Burn',
  divest:   'Divest',
  leverage: 'Leverage',
  wrap:     'Wrap / Unwrap',
}

export default function App() {
  const [tokenId, setTokenId] = useState<number>(1)
  const [activeTab, setActiveTab] = useState<Tab>('mint')

  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  return (
    <div className="min-h-screen text-white">
      <Header />

      {isZeroAddress && (
        <div
          className="px-4 py-3 text-sm text-center"
          style={{
            background: 'rgba(212,175,55,0.08)',
            borderBottom: '1px solid rgba(212,175,55,0.25)',
            color: '#f3e5ab',
          }}
        >
          Contract address not set — deploy or set{' '}
          <code className="font-mono px-1 rounded" style={{ background: 'rgba(212,175,55,0.15)' }}>
            VITE_CONTRACT_ADDRESS
          </code>{' '}
          in your <code className="font-mono px-1 rounded" style={{ background: 'rgba(212,175,55,0.15)' }}>.env</code>.
        </div>
      )}

      <main className="flex justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-6">

          {/* Token ID input */}
          <div className="flex items-center gap-4">
            <label htmlFor="token-id" className="stat-label whitespace-nowrap" style={{ fontSize: '0.8125rem' }}>
              Token ID
            </label>
            <input
              id="token-id"
              type="number"
              min={1}
              value={tokenId}
              onChange={(e) => setTokenId(Math.max(1, parseInt(e.target.value) || 1))}
              className="input-money"
              style={{ width: '7rem' }}
            />
          </div>

          {/* Info card */}
          <InfoCard tokenId={tokenId} />

          {/* Tab bar */}
          <div className="flex border-b" style={{ borderColor: 'rgba(212,175,55,0.15)' }}>
            {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? tab === 'leverage' ? 'tab-active-gold' : 'tab-active-green'
                    : 'tab-inactive'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'mint'     && <MintForm tokenId={tokenId} />}
          {activeTab === 'burn'     && <BurnForm tokenId={tokenId} />}
          {activeTab === 'divest'   && <DivestForm tokenId={tokenId} />}
          {activeTab === 'leverage' && (
            <div className="space-y-4">
              <LeverageInfoCard tokenId={tokenId} />
              <MintLeverageForm tokenId={tokenId} />
              <DivestLeverageForm tokenId={tokenId} />
              <KeeperPanel tokenId={tokenId} />
            </div>
          )}
          {activeTab === 'wrap' && <WrapUnwrapPanel tokenId={tokenId} />}
        </div>
      </main>
    </div>
  )
}
