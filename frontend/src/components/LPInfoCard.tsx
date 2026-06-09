import { useReadContracts, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function LPInfoCard({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  const { data, isPending } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'getLPInfo',
        args: [BigInt(tokenId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS as `0x${string}`, BigInt(tokenId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'totalSupply',
        args: [BigInt(tokenId)],
      },
    ],
    query: { enabled: !isZeroAddress },
  })

  if (isZeroAddress) return null

  if (isPending) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading LP info…</p>
      </div>
    )
  }

  const info        = data?.[0]?.status === 'success' ? data[0].result : null
  const balance     = data?.[1]?.status === 'success' ? data[1].result : null
  const totalSupply = data?.[2]?.status === 'success' ? data[2].result : null

  if (!info) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>No LP data available.</p>
      </div>
    )
  }

  const isActive   = info.active
  const hasBalance = balance !== null && balance !== undefined && balance > 0n
  const supplyNum  = totalSupply !== null && totalSupply !== undefined ? totalSupply : 0n

  // Estimate user's proportional ETH value (deployed + reserve)
  let userEthEstimate: bigint | null = null
  if (hasBalance && supplyNum > 0n) {
    const totalEth = info.deployedEth + info.reserve
    userEthEstimate = (totalEth * balance!) / supplyNum
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">LP Position</h3>
        <div className="flex items-center gap-2">
          <span className="badge-gold">Uniswap V3</span>
          {isActive ? (
            <span className="badge-green">Active</span>
          ) : (
            <span className="badge-red">Inactive</span>
          )}
        </div>
      </div>

      {!isActive ? (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>
          No active LP position for token ID {tokenId}. The keeper deploys the reserve once configured.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="stat-label">Position NFT ID</p>
              <p className="stat-value">#{info.positionId.toString()}</p>
            </div>
            <div>
              <p className="stat-label">Liquidity Units</p>
              <p className="stat-value">{info.liquidity.toString()}</p>
            </div>
            <div>
              <p className="stat-label">Deployed ETH</p>
              <p className="stat-value">{formatEther(info.deployedEth)} ETH</p>
            </div>
            <div>
              <p className="stat-label">Undeployed Reserve</p>
              <p className="stat-value">{formatEther(info.reserve)} ETH</p>
            </div>
          </div>

          <div className="box-info flex items-center justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Total backing</span>
            <span className="font-bold text-gold">
              {formatEther(info.deployedEth + info.reserve)} ETH
            </span>
          </div>
        </div>
      )}

      {isConnected && balance !== null && balance !== undefined && (
        <div className="pt-3 border-t divider-money space-y-2">
          <div className="flex items-center justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Your Balance</span>
            <span className="font-semibold text-white">{balance.toString()} tokens</span>
          </div>
          {isActive && userEthEstimate !== null && (
            <div className="flex items-center justify-between">
              <span className="stat-label" style={{ marginBottom: 0 }}>Your ETH share (est.)</span>
              <span className="font-semibold" style={{ color: '#34d399' }}>
                ~{formatEther(userEthEstimate)} ETH
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
