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
import LPInfoCard from './components/LPInfoCard'
import DivestLPForm from './components/DivestLPForm'

type Tab = 'mint' | 'burn' | 'divest' | 'leverage' | 'lp' | 'wrap'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const TAB_LABELS: Record<Tab, string> = {
  mint:     'Mint',
  burn:     'Burn',
  divest:   'Divest',
  leverage: 'Leverage',
  lp:       'LP',
  wrap:     'Wrap / Unwrap',
}

export default function App() {
  const [tokenId, setTokenId] = useState<number>(1)
  const [activeTab, setActiveTab] = useState<Tab>('mint')

  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  return (
    <div className="min-h-screen text-white flex flex-col">
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

      <main className="flex-1 flex justify-center px-4 py-8">
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
                    ? (tab === 'leverage' || tab === 'lp') ? 'tab-active-gold' : 'tab-active-green'
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
          {activeTab === 'lp' && (
            <div className="space-y-4">
              <LPInfoCard tokenId={tokenId} />
              <DivestLPForm tokenId={tokenId} />
            </div>
          )}
          {activeTab === 'wrap' && <WrapUnwrapPanel tokenId={tokenId} />}
        </div>
      </main>
      <footer
        className="px-4 py-5 text-center text-xs leading-relaxed"
        style={{
          borderTop: '1px solid rgba(212,175,55,0.12)',
          color: 'rgba(255,255,255,0.35)',
        }}
      >
        <p>
          <span style={{ color: '#fb923c', fontWeight: 600 }}>Experimental software — use at your own risk.</span>
          {' '}This protocol is unaudited. Interactions with smart contracts may result in partial or total loss of funds.
          By using this interface you acknowledge that you understand the risks and accept sole responsibility for your actions.
        </p>
      </footer>
    </div>
  )
}
