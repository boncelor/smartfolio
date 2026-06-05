import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function DivestForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('0.5')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0
  const slippagePercent = parseFloat(slippage) || 0.5

  const { data: portfolioActive } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'portfolioActive',
    args: [BigInt(tokenId)],
    query: {
      enabled: tokenId > 0,
    },
  })

  const { data: deployedEth } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'deployedEth',
    args: [BigInt(tokenId)],
    query: {
      enabled: tokenId > 0,
    },
  })

  const { data: totalSupply } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'totalSupply',
    args: [BigInt(tokenId)],
    query: {
      enabled: tokenId > 0,
    },
  })

  const { data: balance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'balanceOf',
    args: [address!, BigInt(tokenId)],
    query: {
      enabled: isConnected && !!address && tokenId > 0,
    },
  })

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  // Compute estimated ETH out locally
  let estimatedEth: bigint | null = null
  if (
    isValidAmount &&
    deployedEth !== undefined &&
    totalSupply !== undefined &&
    totalSupply > 0n
  ) {
    // proportion = amount / totalSupply; estimated = proportion * deployedEth
    // Use BigInt math: (amount * deployedEth) / totalSupply
    estimatedEth = (BigInt(parsedAmount) * deployedEth) / totalSupply
  }

  // minEthOut = estimated * (1 - slippage/100)
  let minEthOut: bigint = 0n
  if (estimatedEth !== null && estimatedEth > 0n) {
    const slippageBps = BigInt(Math.round(slippagePercent * 100))
    minEthOut = (estimatedEth * (10000n - slippageBps)) / 10000n
  }

  function handleDivest() {
    if (!isValidAmount) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'divest',
      args: [BigInt(tokenId), BigInt(parsedAmount), minEthOut],
    })
  }

  const isDisabled =
    !isConnected || !isValidAmount || portfolioActive === false || isWritePending || isConfirming

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-100">Divest (Fee-Free Exit)</h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700">
          Fee-Free
        </span>
      </div>

      {/* Portfolio not active warning */}
      {portfolioActive === false && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-400 text-sm">
          Portfolio is not deployed — use Burn instead to exit your position.
        </div>
      )}

      {/* Amount input */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">Amount</label>
          {isConnected && balance !== undefined && (
            <span className="text-xs text-gray-500">
              Balance: {balance.toString()} tokens
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-full focus:outline-none focus:border-emerald-500"
          />
          {isConnected && balance !== undefined && balance > 0n && (
            <button
              onClick={() => setAmount(balance.toString())}
              className="px-3 py-2 text-sm text-emerald-400 border border-emerald-700 rounded-lg hover:bg-emerald-900/30 transition-colors whitespace-nowrap"
            >
              Max
            </button>
          )}
        </div>
      </div>

      {/* Slippage tolerance */}
      <div className="space-y-1">
        <label className="text-sm text-gray-400">Slippage Tolerance (%)</label>
        <input
          type="number"
          min={0.01}
          max={50}
          step={0.1}
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-32 focus:outline-none focus:border-emerald-500"
        />
        <p className="text-xs text-gray-600">Applied as minEthOut slippage guard</p>
      </div>

      {/* ETH estimate */}
      {estimatedEth !== null && (
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Estimated ETH out</span>
            <span className="text-gray-200">{formatEther(estimatedEth)} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Min ETH out ({slippagePercent}% slippage)</span>
            <span className="text-emerald-400">{formatEther(minEthOut)} ETH</span>
          </div>
          <p className="text-xs text-gray-600 pt-1">
            ~{formatEther(estimatedEth)} ETH (estimated, subject to swap rates)
          </p>
        </div>
      )}

      {/* Divest button */}
      <button
        onClick={handleDivest}
        disabled={isDisabled}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
      >
        {isWritePending ? 'Confirm in wallet...' : isConfirming ? 'Divesting...' : 'Divest'}
      </button>

      {/* Tx status */}
      {isConfirming && (
        <p className="text-sm text-emerald-400">Divesting... waiting for confirmation.</p>
      )}
      {isConfirmed && (
        <p className="text-sm text-emerald-400 font-medium">Divested! Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm text-red-400 break-all">
          Error: {writeError.message}
        </p>
      )}
      {!isConnected && (
        <p className="text-sm text-gray-500">Connect your wallet to divest.</p>
      )}
    </div>
  )
}
