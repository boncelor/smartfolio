import { useReadContracts, useReadContract, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function InfoCard({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

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
    query: {
      enabled: !isZeroAddress,
    },
  })

  const { data: balance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'balanceOf',
    args: [address!, BigInt(tokenId)],
    query: {
      enabled: isConnected && !!address && !isZeroAddress,
    },
  })

  if (isZeroAddress) {
    return (
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <p className="text-gray-500 text-sm">No data — contract address not configured.</p>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <p className="text-gray-500 text-sm">Loading...</p>
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
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <p className="text-gray-500 text-sm">No data</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      {/* Row 1 */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Supply</p>
          <p className="text-lg font-semibold text-gray-100">{info.circulatingSupply.toString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Reserve</p>
          <p className="text-lg font-semibold text-gray-100">
            {formatEther(info.reserve)} ETH
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Backing/Token</p>
          <p className="text-lg font-semibold text-gray-100">
            {formatEther(info.backingPerToken)} ETH
          </p>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-3 gap-4 pt-3 border-t border-gray-800">
        <div>
          <p className="text-xs text-gray-500 mb-1">Tier</p>
          <p className="text-lg font-semibold text-gray-100">{info.currentTierIndex.toString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Next Price</p>
          <p className="text-lg font-semibold text-gray-100">
            {formatEther(info.currentPrice)} ETH/token
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Status</p>
          {portfolioActive === null ? (
            <span className="text-gray-500 text-sm">—</span>
          ) : portfolioActive ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700">
              Portfolio Active
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
              Reserve Mode
            </span>
          )}
        </div>
      </div>

      {/* User balance */}
      {isConnected && balance !== undefined && (
        <div className="pt-3 border-t border-gray-800">
          <p className="text-sm text-gray-400">
            Your Balance:{' '}
            <span className="text-gray-100 font-semibold">{balance.toString()} tokens</span>
          </p>
        </div>
      )}
    </div>
  )
}
