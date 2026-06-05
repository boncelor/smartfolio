import { useState } from 'react'
import { CONTRACT_ADDRESS } from './contracts'
import Header from './components/Header'
import InfoCard from './components/InfoCard'
import MintForm from './components/MintForm'
import BurnForm from './components/BurnForm'
import DivestForm from './components/DivestForm'

type Tab = 'mint' | 'burn' | 'divest'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function App() {
  const [tokenId, setTokenId] = useState<number>(1)
  const [activeTab, setActiveTab] = useState<Tab>('mint')

  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  return (
    <div className="bg-gray-950 min-h-screen text-gray-100">
      <Header />

      {isZeroAddress && (
        <div className="bg-yellow-900/50 border-b border-yellow-700 px-4 py-3 text-yellow-300 text-sm text-center">
          Warning: Contract address is not set. Deploy the contract or set{' '}
          <code className="font-mono bg-yellow-900/60 px-1 rounded">VITE_CONTRACT_ADDRESS</code> in your{' '}
          <code className="font-mono bg-yellow-900/60 px-1 rounded">.env</code> file.
        </div>
      )}

      <main className="flex justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-6">
          {/* Token ID input */}
          <div className="flex items-center gap-4">
            <label htmlFor="token-id" className="text-sm font-medium text-gray-400 whitespace-nowrap">
              Token ID
            </label>
            <input
              id="token-id"
              type="number"
              min={1}
              value={tokenId}
              onChange={(e) => setTokenId(Math.max(1, parseInt(e.target.value) || 1))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-32 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Info card */}
          <InfoCard tokenId={tokenId} />

          {/* Tab bar */}
          <div className="flex border-b border-gray-800">
            {(['mint', 'burn', 'divest'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'text-emerald-400 border-b-2 border-emerald-500 -mb-px'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab === 'divest' ? 'Divest' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'mint' && <MintForm tokenId={tokenId} />}
          {activeTab === 'burn' && <BurnForm tokenId={tokenId} />}
          {activeTab === 'divest' && <DivestForm tokenId={tokenId} />}
        </div>
      </main>
    </div>
  )
}
