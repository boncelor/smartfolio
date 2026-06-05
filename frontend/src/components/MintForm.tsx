import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function MintForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0

  const { data: cost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'mintCost',
    args: [BigInt(tokenId), BigInt(parsedAmount)],
    query: {
      enabled: isValidAmount && tokenId > 0,
    },
  })

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!address || !isValidAmount || cost === undefined) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'mint',
      args: [address, BigInt(tokenId), BigInt(parsedAmount), '0x'],
      value: cost,
    })
  }

  const isDisabled =
    !isConnected || !isValidAmount || cost === undefined || isWritePending || isConfirming

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      <h2 className="text-lg font-semibold text-gray-100">Mint Tokens</h2>

      {/* Amount input */}
      <div className="space-y-1">
        <label className="text-sm text-gray-400">Amount</label>
        <div className="relative flex items-center">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-full focus:outline-none focus:border-emerald-500 pr-16"
          />
          <span className="absolute right-3 text-sm text-gray-500 pointer-events-none">tokens</span>
        </div>
      </div>

      {/* Cost preview */}
      <div className="text-sm text-gray-400">
        Cost:{' '}
        {cost !== undefined && isValidAmount ? (
          <span className="text-gray-100 font-medium">{formatEther(cost)} ETH</span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </div>

      {/* Mint button */}
      <button
        onClick={handleMint}
        disabled={isDisabled}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
      >
        {isWritePending ? 'Confirm in wallet...' : isConfirming ? 'Minting...' : 'Mint'}
      </button>

      {/* Tx status */}
      {isConfirming && (
        <p className="text-sm text-emerald-400">Minting... waiting for confirmation.</p>
      )}
      {isConfirmed && (
        <p className="text-sm text-emerald-400 font-medium">Minted! Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm text-red-400 break-all">
          Error: {writeError.message}
        </p>
      )}
      {!isConnected && (
        <p className="text-sm text-gray-500">Connect your wallet to mint.</p>
      )}
    </div>
  )
}
