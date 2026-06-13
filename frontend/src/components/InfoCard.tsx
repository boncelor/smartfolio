import { useEffect, useState } from 'react'
import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function InfoCard({ tokenId }: Props) {
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
        functionName: 'portfolioSMFHoldings',
        args: [BigInt(tokenId)],
      },
    ],
    query: { enabled: !isZeroAddress },
  })

  // Fetch metadata image from API
  useEffect(() => {
    if (!tokenId) return
    setImageUri(null)
    fetch(`/api/metadata/${tokenId}`)
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

  const info = data?.[0]?.status === 'success' ? data[0].result : null
  const smfHoldings = data?.[1]?.status === 'success' ? (data[1].result as bigint) : undefined

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

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="stat-label">SMF Balance</p>
          <p className="stat-value">{smfHoldings !== undefined ? smfHoldings.toString() : '—'} SMF</p>
        </div>
        <div>
          <p className="stat-label">ETH Balance</p>
          <p className="stat-value">{formatEther(info.reserve)} ETH</p>
        </div>
        <div>
          <p className="stat-label">Tier</p>
          <p className="stat-value">{info.currentTierIndex.toString()}</p>
        </div>
      </div>
    </div>
  )
}
