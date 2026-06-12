import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { parseEther, formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

type Action = 'deploy' | 'collectFees'

export default function LPKeeperPanel({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const [action, setAction] = useState<Action>('deploy')

  const [wethForSwap, setWethForSwap]           = useState('')
  const [swapAmountOutMin, setSwapAmountOutMin] = useState('0')
  const [amount0Min, setAmount0Min]             = useState('0')
  const [amount1Min, setAmount1Min]             = useState('0')

  const { data: keeperAddr } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'keeper',
  })
  const { data: ownerAddr } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'owner',
  })
  const { data: lpInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'getLPInfo',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  })

  const isKeeper =
    isConnected &&
    address &&
    (address.toLowerCase() === (keeperAddr as string | undefined)?.toLowerCase() ||
     address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase())

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const isActive = (lpInfo as { active?: boolean } | undefined)?.active ?? false
  const reserve  = (lpInfo as { reserve?: bigint } | undefined)?.reserve

  function handleDeploy() {
    const wethWei = wethForSwap ? parseEther(wethForSwap) : 0n
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'deployLP',
      args: [
        BigInt(tokenId),
        wethWei,
        BigInt(swapAmountOutMin || '0'),
        BigInt(amount0Min || '0'),
        BigInt(amount1Min || '0'),
      ],
    })
  }

  function handleCollectFees() {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'collectFees',
      args: [BigInt(tokenId)],
    })
  }

  if (!isKeeper) return null

  return (
    <div className="card space-y-4" style={{ borderColor: 'rgba(212,175,55,0.4)' }}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">LP Keeper</h2>
        <span className="badge-keeper">Keeper Only</span>
      </div>

      {/* Action selector */}
      <div className="flex gap-2">
        {(['deploy', 'collectFees'] as Action[]).map(a => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border"
            style={
              action === a
                ? { background: 'var(--gold-gradient)', borderColor: 'var(--gold-foil)', color: '#05190e' }
                : { background: 'transparent', borderColor: 'rgba(212,175,55,0.2)', color: 'rgba(255,255,255,0.4)' }
            }
          >
            {a === 'deploy' ? 'Deploy LP' : 'Collect Fees'}
          </button>
        ))}
      </div>

      {/* Deploy */}
      {action === 'deploy' && (
        <div className="space-y-3">
          {isActive && (
            <div className="box-warning">LP position already active. Divest first to redeploy.</div>
          )}
          {reserve !== undefined && (
            <div className="box-info flex justify-between text-sm">
              <span className="stat-label" style={{ marginBottom: 0 }}>Available reserve</span>
              <span className="font-semibold text-white">{formatEther(reserve)} ETH</span>
            </div>
          )}
          <div className="space-y-1">
            <label className="stat-label">WETH to swap for token B (ETH)</label>
            <input
              type="number" min="0" step="0.001"
              value={wethForSwap}
              onChange={e => setWethForSwap(e.target.value)}
              placeholder="0.0"
              className="input-money"
            />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Portion of reserve swapped to the paired token before providing liquidity.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="stat-label">Min token B out</label>
              <input
                type="number" min="0"
                value={swapAmountOutMin}
                onChange={e => setSwapAmountOutMin(e.target.value)}
                className="input-money"
              />
            </div>
            <div className="space-y-1">
              <label className="stat-label">Min amount0</label>
              <input
                type="number" min="0"
                value={amount0Min}
                onChange={e => setAmount0Min(e.target.value)}
                className="input-money"
              />
            </div>
            <div className="space-y-1">
              <label className="stat-label">Min amount1</label>
              <input
                type="number" min="0"
                value={amount1Min}
                onChange={e => setAmount1Min(e.target.value)}
                className="input-money"
              />
            </div>
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Min amounts are slippage guards in token base units. Set to 0 to skip.
          </p>
          <button
            onClick={handleDeploy}
            disabled={isActive || isPending || isConfirming}
            className="btn-gold"
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Deploying…' : 'Deploy LP'}
          </button>
        </div>
      )}

      {/* Collect Fees */}
      {action === 'collectFees' && (
        <div className="space-y-3">
          {!isActive && (
            <div className="box-warning">No active LP position — nothing to collect.</div>
          )}
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Collects accrued Uniswap V3 fees and adds them to the token reserve.
          </p>
          <button
            onClick={handleCollectFees}
            disabled={!isActive || isPending || isConfirming}
            className="btn-gold"
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Collecting…' : 'Collect Fees'}
          </button>
        </div>
      )}

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
    </div>
  )
}
