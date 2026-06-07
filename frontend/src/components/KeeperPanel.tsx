import { useState } from 'react'
import { useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type Action = 'leverUp' | 'leverDown' | 'emergencyDeleverage'

const ACTION_LABELS: Record<Action, string> = {
  leverUp:             'Lever Up',
  leverDown:           'Lever Down',
  emergencyDeleverage: 'Emergency',
}

export default function KeeperPanel({ tokenId }: Props) {
  const { address, isConnected } = useAccount()

  const [action, setAction]               = useState<Action>('leverUp')
  const [stableToBorrow, setStableToBorrow] = useState('')
  const [minWethOut, setMinWethOut]         = useState('')
  const [poolFee, setPoolFee]               = useState('3000')
  const [wethToWithdraw, setWethToWithdraw] = useState('')
  const [minStableOut, setMinStableOut]     = useState('')
  const [emergencyMin, setEmergencyMin]     = useState('')

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

  const isKeeper =
    address &&
    (address.toLowerCase() === (keeperAddr as string | undefined)?.toLowerCase() ||
      address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase())

  const stableUsdcUnits = Math.round((parseFloat(stableToBorrow) || 0) * 1e6)

  const { data: simulation } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'simulateLeverUp',
    args: [BigInt(tokenId), BigInt(stableUsdcUnits)],
    query: { enabled: action === 'leverUp' && stableUsdcUnits > 0 },
  })

  const { data: leverageData } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'getLeverageInfo',
        args: [BigInt(tokenId)],
      },
    ],
  })
  const info = leverageData?.[0]?.status === 'success' ? leverageData[0].result : null

  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function parseBigIntEther(val: string): bigint {
    const n = parseFloat(val)
    if (!n || n <= 0) return 0n
    return BigInt(Math.round(n * 1e18))
  }

  function handleSubmit() {
    const fee = parseInt(poolFee) as 100 | 500 | 3000 | 10000
    if (action === 'leverUp') {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'leverUp',
        args: [BigInt(tokenId), BigInt(stableUsdcUnits), parseBigIntEther(minWethOut), fee, '0x'],
      })
    } else if (action === 'leverDown') {
      const stableMin = Math.round((parseFloat(minStableOut) || 0) * 1e6)
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'leverDown',
        args: [BigInt(tokenId), parseBigIntEther(wethToWithdraw), BigInt(stableMin), fee, '0x'],
      })
    } else {
      const stableMin = Math.round((parseFloat(emergencyMin) || 0) * 1e6)
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'emergencyDeleverage',
        args: [BigInt(tokenId), BigInt(stableMin), fee, '0x'],
      })
    }
  }

  if (!isConnected || !isKeeper) return null

  return (
    <div
      className="card space-y-4"
      style={{ borderColor: 'rgba(212,175,55,0.4)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Keeper Panel</h2>
        <span className="badge-keeper">Keeper Only</span>
      </div>

      {/* Live position snapshot */}
      {info && (
        <div
          className="grid grid-cols-3 gap-3 rounded-lg p-3"
          style={{ background: 'rgba(5,25,14,0.7)', border: '1px solid rgba(212,175,55,0.12)' }}
        >
          <div>
            <p className="stat-label">Collateral</p>
            <p className="text-sm font-semibold text-white">{formatEther(info.collateralWeth)} ETH</p>
          </div>
          <div>
            <p className="stat-label">LTV</p>
            <p className="text-sm font-semibold text-white">{(Number(info.ltvBps) / 100).toFixed(2)}%</p>
          </div>
          <div>
            <p className="stat-label">Health Factor</p>
            <p className="text-sm font-semibold text-white">{(Number(info.healthFactor) / 1e18).toFixed(3)}</p>
          </div>
        </div>
      )}

      {/* Action selector */}
      <div className="flex gap-2">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
              action === a
                ? a === 'emergencyDeleverage'
                  ? 'text-white'
                  : 'text-money-darker'
                : ''
            }`}
            style={
              action === a
                ? a === 'emergencyDeleverage'
                  ? { background: '#b91c1c', borderColor: 'rgba(248,113,113,0.5)' }
                  : { background: 'var(--gold-gradient)', borderColor: 'var(--gold-foil)', color: '#05190e' }
                : { background: 'transparent', borderColor: 'rgba(212,175,55,0.2)', color: 'rgba(255,255,255,0.4)' }
            }
          >
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>

      {/* Pool fee */}
      <div className="space-y-1">
        <label className="stat-label">Pool Fee Tier</label>
        <select
          value={poolFee}
          onChange={(e) => setPoolFee(e.target.value)}
          className="select-money"
        >
          <option value="100">0.01%</option>
          <option value="500">0.05%</option>
          <option value="3000">0.3%</option>
          <option value="10000">1%</option>
        </select>
      </div>

      {/* Lever Up fields */}
      {action === 'leverUp' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="stat-label">Stable to borrow (USDC)</label>
            <input
              type="number" min="0" step="1" value={stableToBorrow}
              onChange={(e) => setStableToBorrow(e.target.value)}
              placeholder="100"
              className="input-money"
            />
          </div>
          <div className="space-y-1">
            <label className="stat-label">Min WETH out</label>
            <input
              type="number" min="0" step="0.001" value={minWethOut}
              onChange={(e) => setMinWethOut(e.target.value)}
              placeholder="0.03"
              className="input-money"
            />
          </div>
          {simulation && (
            <div className="box-info">
              <p className="stat-label mb-2">Simulation</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="stat-label">New LTV</p>
                  <p
                    className="font-bold"
                    style={{ color: simulation.wouldExceedCap ? '#f87171' : '#34d399' }}
                  >
                    {(Number(simulation.newLtvBps) / 100).toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="stat-label">New HF</p>
                  <p className="font-bold text-white">{(Number(simulation.newHealthFactor) / 1e18).toFixed(3)}</p>
                </div>
                <div>
                  <p className="stat-label">Cap Breach</p>
                  <p
                    className="font-bold"
                    style={{ color: simulation.wouldExceedCap ? '#f87171' : '#34d399' }}
                  >
                    {simulation.wouldExceedCap ? 'YES' : 'No'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lever Down fields */}
      {action === 'leverDown' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="stat-label">WETH to withdraw</label>
            <input
              type="number" min="0" step="0.001" value={wethToWithdraw}
              onChange={(e) => setWethToWithdraw(e.target.value)}
              placeholder="0.03"
              className="input-money"
            />
          </div>
          <div className="space-y-1">
            <label className="stat-label">Min stable out (USDC)</label>
            <input
              type="number" min="0" step="1" value={minStableOut}
              onChange={(e) => setMinStableOut(e.target.value)}
              placeholder="90"
              className="input-money"
            />
          </div>
        </div>
      )}

      {/* Emergency Deleverage fields */}
      {action === 'emergencyDeleverage' && (
        <div className="space-y-3">
          <div className="box-error">
            Full deleverage: withdraws all collateral, swaps to stable, repays all debt.
            Only callable when health factor is below the emergency floor.
          </div>
          <div className="space-y-1">
            <label className="stat-label">Min stable out (USDC)</label>
            <input
              type="number" min="0" step="1" value={emergencyMin}
              onChange={(e) => setEmergencyMin(e.target.value)}
              placeholder="0"
              className="input-money"
            />
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isWritePending || isConfirming}
        className={action === 'emergencyDeleverage' ? 'btn-danger' : 'btn-gold'}
      >
        {isWritePending
          ? 'Confirm in wallet…'
          : isConfirming
          ? 'Executing…'
          : ACTION_LABELS[action]}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Transaction confirmed.</p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
    </div>
  )
}
