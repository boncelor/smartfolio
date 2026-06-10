import { useReadContract, useReadContracts, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  onSelect: (id: number) => void
}

export default function NFTList({ onSelect }: Props) {
  const { address, isConnected } = useAccount()

  const { data: globalMinted } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'globalTotalMinted',
    query: { enabled: isConnected && !!address },
  })

  const maxId = globalMinted !== undefined ? Math.min(Number(globalMinted), 100) : -1

  const balanceCalls = Array.from({ length: maxId }, (_, i) => ({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'balanceOf' as const,
    args: [address!, BigInt(i + 1)] as [`0x${string}`, bigint],
  }))

  const { data: balances } = useReadContracts({
    contracts: balanceCalls,
    query: { enabled: isConnected && !!address && maxId > 0 },
  })

  const owned = balances
    ?.map((r, i) => ({ id: i + 1, balance: r.status === 'success' ? Number(r.result) : 0 }))
    .filter((t) => t.balance > 0) ?? []

  if (!isConnected) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to see your NFTs.</p>
      </div>
    )
  }

  if (maxId === -1 || !balances) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading…</p>
      </div>
    )
  }

  if (maxId === 0 || owned.length === 0) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>You don't hold any Smartfolio NFTs.</p>
      </div>
    )
  }

  return (
    <div className="card space-y-2">
      <h2 className="text-lg font-bold text-white">Your NFTs</h2>
      <div className="space-y-2">
        {owned.map(({ id, balance }) => (
          <NFTRow key={id} id={id} balance={balance} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function NFTRow({ id, balance, onSelect }: { id: number; balance: number; onSelect: (id: number) => void }) {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'tokenInfo',
    args: [BigInt(id)],
  })

  return (
    <button
      onClick={() => onSelect(id)}
      className="w-full flex items-center justify-between px-4 py-3 rounded transition-colors text-left"
      style={{
        background: 'rgba(212,175,55,0.05)',
        border: '1px solid rgba(212,175,55,0.15)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(212,175,55,0.1)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(212,175,55,0.05)')}
    >
      <div className="flex items-center gap-4">
        <span className="font-bold text-gold" style={{ minWidth: '3rem' }}>#{id}</span>
        <div className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {balance} token{balance !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="flex items-center gap-6 text-sm">
        {data && (
          <>
            <div className="text-right">
              <div className="stat-label" style={{ marginBottom: 0 }}>Reserve</div>
              <div className="font-semibold text-white">{formatEther(data.reserve)} ETH</div>
            </div>
            <div className="text-right">
              <div className="stat-label" style={{ marginBottom: 0 }}>Backing</div>
              <div className="font-semibold text-white">{formatEther(data.backingPerToken)} ETH</div>
            </div>
          </>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(212,175,55,0.4)', flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </button>
  )
}
