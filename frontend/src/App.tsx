import { useState, useEffect } from 'react'
import { CONTRACT_ADDRESS } from './contracts'
import Header from './components/Header'
import InfoCard from './components/InfoCard'
import BurnForm from './components/BurnForm'
import DivestForm from './components/DivestForm'
import LeverageInfoCard from './components/LeverageInfoCard'
import MintLeverageForm from './components/MintLeverageForm'
import DivestLeverageForm from './components/DivestLeverageForm'
import KeeperPanel from './components/KeeperPanel'
import LPInfoCard from './components/LPInfoCard'
import DivestLPForm from './components/DivestLPForm'
import LPKeeperPanel from './components/LPKeeperPanel'
import SMFPanel from './components/SMFPanel'
import NFTList from './components/NFTList'
import MintNewForm from './components/MintNewForm'
import PortfolioInfoCard from './components/PortfolioInfoCard'
import PortfolioConfigForm from './components/PortfolioConfigForm'
import PortfolioKeeperPanel from './components/PortfolioKeeperPanel'

type Tab = 'smf' | 'nft' | 'portfolio' | 'divest' | 'leverage' | 'lp'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const TAB_LABELS: Record<Tab, string> = {
  smf:       'SMF',
  nft:       'NFT',
  portfolio: 'Portfolio',
  divest:    'Divest',
  leverage:  'Leverage',
  lp:        'LP',
}

const TABS = Object.keys(TAB_LABELS) as Tab[]

function tabFromHash(): Tab {
  const hash = window.location.hash.slice(1) as Tab
  return TABS.includes(hash) ? hash : 'smf'
}

function TokenIdInput({ tokenId, setTokenId }: { tokenId: number; setTokenId: (v: number) => void }) {
  return (
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
  )
}

export default function App() {
  const [tokenId, setTokenId] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<Tab>(tabFromHash)

  useEffect(() => {
    function onHashChange() {
      setActiveTab(tabFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function switchTab(tab: Tab) {
    window.location.hash = tab
    if (tab !== 'nft') setTokenId(tab === 'smf' ? 0 : 1)
    else setTokenId(0)
  }

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

          {/* Tab bar */}
          <div className="flex border-b" style={{ borderColor: 'rgba(212,175,55,0.15)' }}>
            {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => switchTab(tab)}
                className={`px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? (tab === 'leverage' || tab === 'lp' || tab === 'smf' || tab === 'portfolio') ? 'tab-active-gold' : 'tab-active-green'
                    : 'tab-inactive'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'smf' && <SMFPanel />}
          {activeTab === 'nft' && (
            <div className="space-y-4">
              {tokenId === 0 ? (
                <>
                  <NFTList onSelect={(id) => setTokenId(id)} />
                  <MintNewForm />
                </>
              ) : (
                <>
                  <button
                    onClick={() => setTokenId(0)}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'rgba(212,175,55,0.6)' }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    All NFTs
                  </button>
                  <TokenIdInput tokenId={tokenId} setTokenId={setTokenId} />
                  <InfoCard tokenId={tokenId} />
                  <BurnForm tokenId={tokenId} />
                </>
              )}
            </div>
          )}
          {activeTab === 'portfolio' && (
            <div className="space-y-4">
              <TokenIdInput tokenId={tokenId} setTokenId={setTokenId} />
              <PortfolioInfoCard tokenId={tokenId} />
              <DivestForm tokenId={tokenId} />
              <PortfolioKeeperPanel tokenId={tokenId} />
              <PortfolioConfigForm tokenId={tokenId} />
            </div>
          )}
          {activeTab === 'divest' && (
            <div className="space-y-4">
              <TokenIdInput tokenId={tokenId} setTokenId={setTokenId} />
              <DivestForm tokenId={tokenId} />
            </div>
          )}
          {activeTab === 'leverage' && (
            <div className="space-y-4">
              <TokenIdInput tokenId={tokenId} setTokenId={setTokenId} />
              <LeverageInfoCard tokenId={tokenId} />
              <MintLeverageForm tokenId={tokenId} />
              <DivestLeverageForm tokenId={tokenId} />
              <KeeperPanel tokenId={tokenId} />
            </div>
          )}
          {activeTab === 'lp' && (
            <div className="space-y-4">
              <TokenIdInput tokenId={tokenId} setTokenId={setTokenId} />
              <LPInfoCard tokenId={tokenId} />
              <DivestLPForm tokenId={tokenId} />
              <LPKeeperPanel tokenId={tokenId} />
            </div>
          )}
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
