import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function DivestForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0

  const { data: portfolioActive } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'portfolioActive',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
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

  function handleDivest() {
    if (!isValidAmount) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'divest',
      args: [BigInt(tokenId), BigInt(parsedAmount)],
    })
  }

  const isDisabled =
    !isConnected || !isValidAmount || portfolioActive === false || isWritePending || isConfirming

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-white">Divest</h2>
        <span className="badge-green">Fee-Free Exit</span>
      </div>

      {portfolioActive === false && (
        <div className="box-warning">
          Portfolio not deployed — use <strong>Burn</strong> to exit your position instead.
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="stat-label">Amount</label>
          {isConnected && balance !== undefined && (
            <span className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
              Balance: {balance.toString()}
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
            className="input-money"
          />
          {isConnected && balance !== undefined && balance > 0n && (
            <button onClick={() => setAmount(balance.toString())} className="btn-outline-gold">
              Max
            </button>
          )}
        </div>
      </div>

      <button onClick={handleDivest} disabled={isDisabled} className="btn-money">
        {isWritePending ? 'Confirm in wallet…' : isConfirming ? 'Divesting…' : 'Divest'}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Divested! Transaction confirmed.</p>
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
