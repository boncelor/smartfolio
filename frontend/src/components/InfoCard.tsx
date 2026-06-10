import { useEffect, useState } from 'react'
import { useReadContracts, useReadContract, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const METADATA_BASE = import.meta.env.VITE_METADATA_URL as string | undefined

export default function InfoCard({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  const [imageUri, setImageUri] = useState<string | null>(null)

  const { data, isPending } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'tokenInfo',
        args: [BigInt(tokenId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'portfolioActive',
        args: [BigInt(tokenId)],
      },
    ],
    query: { enabled: !isZeroAddress },
  })

  const { data: balance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'balanceOf',
    args: [address!, BigInt(tokenId)],
    query: { enabled: isConnected && !!address && !isZeroAddress },
  })

  // Fetch metadata image from API
  useEffect(() => {
    if (!METADATA_BASE || !tokenId) return
    setImageUri(null)
    fetch(`${METADATA_BASE}/api/metadata/${tokenId}`)
      .then((r) => r.json())
      .then((meta) => { if (meta.image) setImageUri(meta.image) })
      .catch(() => {})
  }, [tokenId])

  if (isZeroAddress) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>
          No data — contract address not configured.
        </p>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading...</p>
      </div>
    )
  }

  const tokenInfoResult = data?.[0]
  const portfolioActiveResult = data?.[1]

  const info = tokenInfoResult?.status === 'success' ? tokenInfoResult.result : null
  const portfolioActive =
    portfolioActiveResult?.status === 'success' ? portfolioActiveResult.result : null

  if (!info) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>No data</p>
      </div>
    )
  }

  return (
    <div className="card space-y-4">
      {/* NFT image */}
      {imageUri && (
        <img
          src={imageUri}
          alt={`Smartfolio #${tokenId}`}
          className="w-full rounded-lg"
          style={{ border: '1px solid rgba(212,175,55,0.15)' }}
        />
      )}

      {/* Row 1 */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="stat-label">Supply</p>
          <p className="stat-value">{info.circulatingSupply.toString()}</p>
        </div>
        <div>
          <p className="stat-label">Reserve</p>
          <p className="stat-value">{formatEther(info.reserve)} ETH</p>
        </div>
        <div>
          <p className="stat-label">Backing / Token</p>
          <p className="stat-value">{formatEther(info.backingPerToken)} ETH</p>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-3 gap-4 pt-3 border-t divider-money">
        <div>
          <p className="stat-label">Tier</p>
          <p className="stat-value">{info.currentTierIndex.toString()}</p>
        </div>
        <div>
          <p className="stat-label">Next Price</p>
          <p className="stat-value">{formatEther(info.currentPrice)} ETH</p>
        </div>
        <div>
          <p className="stat-label">Status</p>
          {portfolioActive === null ? (
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>
          ) : portfolioActive ? (
            <span className="badge-green">Portfolio Active</span>
          ) : (
            <span className="badge-gold">Reserve Mode</span>
          )}
        </div>
      </div>

      {/* User balance */}
      {isConnected && balance !== undefined && (
        <div className="pt-3 border-t divider-money flex items-center justify-between">
          <span className="stat-label" style={{ marginBottom: 0 }}>Your Balance</span>
          <span className="font-semibold text-white">{balance.toString()} tokens</span>
        </div>
      )}
    </div>
  )
}
