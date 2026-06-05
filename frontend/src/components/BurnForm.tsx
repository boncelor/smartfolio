import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function BurnForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0

  const { data: burnRefundData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'burnRefund',
    args: [BigInt(tokenId), BigInt(parsedAmount)],
    query: {
      enabled: isValidAmount && tokenId > 0,
    },
  })

  const { data: portfolioActive } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'portfolioActive',
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

  function handleBurn() {
    if (!isValidAmount || portfolioActive) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'burn',
      args: [BigInt(tokenId), BigInt(parsedAmount)],
    })
  }

  const isDisabled =
    !isConnected || !isValidAmount || portfolioActive === true || isWritePending || isConfirming

  // burnRefundData is a tuple: [gross, fee, net]
  const gross = burnRefundData?.[0]
  const fee = burnRefundData?.[1]
  const net = burnRefundData?.[2]

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      <h2 className="text-lg font-semibold text-gray-100">Burn Tokens</h2>

      {/* Portfolio active warning */}
      {portfolioActive && (
        <div className="bg-orange-900/40 border border-orange-700 rounded-lg px-4 py-3 text-orange-300 text-sm">
          Portfolio is active — use Divest for fee-free exit. Burn will fail while portfolio is deployed.
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
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-full focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Fee breakdown */}
      {isValidAmount && burnRefundData !== undefined && (
        <div className="bg-gray-800/60 rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Gross</span>
            <span className="text-gray-200">{gross !== undefined ? formatEther(gross) : '—'} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Fee</span>
            <span className="text-orange-400">{fee !== undefined ? formatEther(fee) : '—'} ETH</span>
          </div>
          <div className="flex justify-between border-t border-gray-700 pt-1.5">
            <span className="text-gray-400">You receive</span>
            <span className="text-emerald-400 font-semibold">
              {net !== undefined ? formatEther(net) : '—'} ETH
            </span>
          </div>
        </div>
      )}

      {/* Burn button */}
      <button
        onClick={handleBurn}
        disabled={isDisabled}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
      >
        {isWritePending ? 'Confirm in wallet...' : isConfirming ? 'Burning...' : 'Burn'}
      </button>

      {/* Tx status */}
      {isConfirming && (
        <p className="text-sm text-emerald-400">Burning... waiting for confirmation.</p>
      )}
      {isConfirmed && (
        <p className="text-sm text-emerald-400 font-medium">Burned! Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm text-red-400 break-all">
          Error: {writeError.message}
        </p>
      )}
      {!isConnected && (
        <p className="text-sm text-gray-500">Connect your wallet to burn.</p>
      )}
    </div>
  )
}
