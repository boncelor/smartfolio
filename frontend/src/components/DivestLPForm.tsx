import { useState } from 'react'
import { useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export default function DivestLPForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0

  const { data } = useReadContracts({
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
    query: { enabled: !!address },
  })

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  const info        = data?.[0]?.status === 'success' ? data[0].result : null
  const balance     = data?.[1]?.status === 'success' ? data[1].result : null
  const totalSupply = data?.[2]?.status === 'success' ? data[2].result : null

  const isActive = info?.active ?? false

  // Estimate ETH out: proportional share of (deployedEth + reserve)
  let estimatedEth: bigint | null = null
  if (info && totalSupply && totalSupply > 0n && parsedAmount > 0) {
    const totalEth = info.deployedEth + info.reserve
    estimatedEth = (totalEth * BigInt(parsedAmount)) / totalSupply
  }

  const slippageBps = Math.round((parseFloat(slippagePct) || 1) * 100)
  const minEthOut =
    estimatedEth !== null
      ? (estimatedEth * BigInt(10000 - slippageBps)) / 10000n
      : 0n

  function handleDivest() {
    if (!address || !isValidAmount) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'divestLP',
      args: [BigInt(tokenId), BigInt(parsedAmount), minEthOut],
    })
  }

  const isDisabled =
    !isConnected ||
    !isValidAmount ||
    !isActive ||
    isWritePending ||
    isConfirming ||
    (balance !== null && balance !== undefined && BigInt(parsedAmount) > balance)

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Divest LP</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(212,175,55,0.5)' }}>
          Remove your proportional share of the Uniswap V3 position and receive ETH.
        </p>
      </div>

      {!isActive && (
        <div className="box-warning">
          No active LP position for this token ID.
        </div>
      )}

      <div className="space-y-1">
        <label className="stat-label">
          Amount{balance !== null && balance !== undefined ? ` (balance: ${balance.toString()})` : ''}
        </label>
        <div className="relative flex items-center">
          <input
            type="number"
            min={1}
            max={balance !== null && balance !== undefined ? Number(balance) : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-money pr-16"
          />
          <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
            tokens
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <label className="stat-label">Slippage tolerance (%)</label>
        <input
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          value={slippagePct}
          onChange={(e) => setSlippagePct(e.target.value)}
          className="input-money"
          style={{ width: '8rem' }}
        />
      </div>

      {isValidAmount && estimatedEth !== null && (
        <div className="box-info space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Estimated ETH</span>
            <span className="text-white font-medium">{formatEther(estimatedEth)} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Min ETH out</span>
            <span className="font-bold text-gold">{formatEther(minEthOut)} ETH</span>
          </div>
        </div>
      )}

      <button onClick={handleDivest} disabled={isDisabled} className="btn-gold">
        {isWritePending ? 'Confirm in wallet…' : isConfirming ? 'Divesting…' : 'Divest LP'}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
          Divested! ETH returned to your wallet.
        </p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
      {!isConnected && (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to divest.</p>
      )}
    </div>
  )
}
