import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

export default function MintLeverageForm({ tokenId }: Props) {
  const [amount, setAmount] = useState('')
  const { address, isConnected } = useAccount()

  const parsedAmount = parseInt(amount) || 0
  const isValidAmount = parsedAmount > 0

  const { data: cost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'mintCost',
    args: [BigInt(parsedAmount)],
    query: { enabled: isValidAmount },
  })

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!address || !isValidAmount || cost === undefined) return
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'mintLeverage',
      args: [BigInt(tokenId), BigInt(parsedAmount), '0x'],
      value: cost,
    })
  }

  const isDisabled =
    !isConnected || !isValidAmount || cost === undefined || isWritePending || isConfirming

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Mint Leverage Tokens</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(212,175,55,0.5)' }}>
          ETH is deposited as WETH collateral into Aave. The keeper manages the leverage position.
        </p>
      </div>

      <div className="space-y-1">
        <label className="stat-label">Amount</label>
        <div className="relative flex items-center">
          <input
            type="number"
            min={1}
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

      <div className="flex items-center justify-between box-info">
        <span className="stat-label" style={{ marginBottom: 0 }}>ETH to deposit (collateral)</span>
        {cost !== undefined && isValidAmount ? (
          <span className="font-bold text-gold">{formatEther(cost)} ETH</span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
        )}
      </div>

      <button onClick={handleMint} disabled={isDisabled} className="btn-gold">
        {isWritePending ? 'Confirm in wallet…' : isConfirming ? 'Minting…' : 'Mint Leverage'}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
          Minted! ETH deposited to Aave as collateral.
        </p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
      {!isConnected && (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to mint.</p>
      )}
    </div>
  )
}
