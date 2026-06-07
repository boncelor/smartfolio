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

  const gross = burnRefundData?.[0]
  const fee   = burnRefundData?.[1]
  const net   = burnRefundData?.[2]

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-bold text-white">Burn Tokens</h2>

      {portfolioActive && (
        <div className="box-warning">
          Portfolio is active — use <strong>Divest</strong> for a fee-free exit. Burn will fail while assets are deployed.
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
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="input-money"
        />
      </div>

      {isValidAmount && burnRefundData !== undefined && (
        <div className="box-info space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Gross</span>
            <span className="text-white font-medium">{gross !== undefined ? formatEther(gross) : '—'} ETH</span>
          </div>
          <div className="flex justify-between">
            <span className="stat-label" style={{ marginBottom: 0 }}>Fee</span>
            <span style={{ color: '#fb923c' }} className="font-medium">{fee !== undefined ? formatEther(fee) : '—'} ETH</span>
          </div>
          <div
            className="flex justify-between pt-2 border-t"
            style={{ borderColor: 'rgba(212,175,55,0.12)' }}
          >
            <span className="stat-label" style={{ marginBottom: 0 }}>You receive</span>
            <span className="font-bold text-gold">{net !== undefined ? formatEther(net) : '—'} ETH</span>
          </div>
        </div>
      )}

      <button onClick={handleBurn} disabled={isDisabled} className="btn-money">
        {isWritePending ? 'Confirm in wallet…' : isConfirming ? 'Burning…' : 'Burn'}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Burned! Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
      {!isConnected && (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to burn.</p>
      )}
    </div>
  )
}
