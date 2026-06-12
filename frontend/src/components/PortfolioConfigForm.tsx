import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

// AssetType enum: 0=ERC20, 1=AAVE, 2=LP, 3=SMF
const ASSET_TYPES = [
  { value: 0, label: 'ERC20' },
  { value: 1, label: 'AAVE' },
  { value: 2, label: 'LP' },
  { value: 3, label: 'SMF' },
]

const POOL_FEES = [100, 500, 3000, 10000]

interface AssetRow {
  assetType: number
  token: string
  weightBps: string
  poolFee: string
  swapFee: string
  tickLower: string
  tickUpper: string
}

function emptyRow(): AssetRow {
  return { assetType: 3, token: '', weightBps: '', poolFee: '3000', swapFee: '3000', tickLower: '-887220', tickUpper: '887220' }
}

export default function PortfolioConfigForm({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const [rows, setRows] = useState<AssetRow[]>([emptyRow()])

  const { data: ownerAddr } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'owner',
  })

  const { data: smfAddr } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'smfContract',
  })

  const { data: portfolioActive } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'portfolioActive',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  })

  const isOwner = isConnected && address?.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const totalWeight = rows.reduce((sum, r) => sum + (parseInt(r.weightBps) || 0), 0)
  const weightOk = totalWeight === 10000

  function updateRow(i: number, field: keyof AssetRow, value: string | number) {
    setRows(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      // Auto-fill SMF token address
      if (field === 'assetType' && value === 3 && smfAddr) {
        next[i].token = smfAddr as string
      }
      return next
    })
  }

  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function removeRow(i: number) { setRows(prev => prev.filter((_, j) => j !== i)) }

  function handleSubmit() {
    const assets = rows.map(r => ({
      assetType: r.assetType,
      token:     (r.token || '0x0000000000000000000000000000000000000000') as `0x${string}`,
      weightBps: parseInt(r.weightBps) || 0,
      poolFee:   parseInt(r.poolFee) || 0,
      swapFee:   parseInt(r.swapFee) || 0,
      tickLower: parseInt(r.tickLower) || 0,
      tickUpper: parseInt(r.tickUpper) || 0,
      swapPath:  '0x' as `0x${string}`,
      sellSwapPath: '0x' as `0x${string}`,
    }))
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'setPortfolioConfig',
      args: [BigInt(tokenId), assets],
    })
  }

  if (!isOwner) return null

  return (
    <div className="card space-y-4" style={{ borderColor: 'rgba(212,175,55,0.3)' }}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Configure Portfolio</h2>
        <span className="badge-gold">Owner Only</span>
      </div>

      {portfolioActive && (
        <div className="box-warning">
          Portfolio is currently <strong>active</strong>. Divest all positions before reconfiguring.
        </div>
      )}

      {/* Asset rows */}
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div
            key={i}
            className="rounded-lg p-3 space-y-2"
            style={{ background: 'rgba(5,25,14,0.6)', border: '1px solid rgba(212,175,55,0.1)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: 'rgba(212,175,55,0.6)' }}>
                Slot {i + 1}
              </span>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Asset type */}
              <div className="space-y-1">
                <label className="stat-label">Type</label>
                <select
                  value={row.assetType}
                  onChange={e => updateRow(i, 'assetType', parseInt(e.target.value))}
                  className="select-money"
                >
                  {ASSET_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Weight */}
              <div className="space-y-1">
                <label className="stat-label">Weight (bps)</label>
                <input
                  type="number" min={1} max={10000}
                  value={row.weightBps}
                  onChange={e => updateRow(i, 'weightBps', e.target.value)}
                  placeholder="2000 = 20%"
                  className="input-money"
                />
              </div>
            </div>

            {/* Token address — not needed for AAVE */}
            {row.assetType !== 1 && (
              <div className="space-y-1">
                <label className="stat-label">
                  {row.assetType === 3 ? 'SMF contract address' :
                   row.assetType === 2 ? 'Token B address' : 'Token address'}
                </label>
                <input
                  type="text"
                  value={row.token}
                  onChange={e => updateRow(i, 'token', e.target.value)}
                  placeholder="0x…"
                  className="input-money font-mono text-xs"
                />
                {row.assetType === 3 && smfAddr && (
                  <button
                    onClick={() => updateRow(i, 'token', smfAddr as string)}
                    className="text-xs"
                    style={{ color: 'rgba(212,175,55,0.5)' }}
                  >
                    Use configured SMF contract
                  </button>
                )}
              </div>
            )}

            {/* Pool fee — ERC20 and LP */}
            {(row.assetType === 0 || row.assetType === 2) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="stat-label">{row.assetType === 2 ? 'LP Pool Fee' : 'Pool Fee'}</label>
                  <select
                    value={row.poolFee}
                    onChange={e => updateRow(i, 'poolFee', e.target.value)}
                    className="select-money"
                  >
                    {POOL_FEES.map(f => (
                      <option key={f} value={f}>{f === 100 ? '0.01%' : f === 500 ? '0.05%' : f === 3000 ? '0.3%' : '1%'}</option>
                    ))}
                  </select>
                </div>
                {row.assetType === 2 && (
                  <div className="space-y-1">
                    <label className="stat-label">Swap Fee</label>
                    <select
                      value={row.swapFee}
                      onChange={e => updateRow(i, 'swapFee', e.target.value)}
                      className="select-money"
                    >
                      {POOL_FEES.map(f => (
                        <option key={f} value={f}>{f === 100 ? '0.01%' : f === 500 ? '0.05%' : f === 3000 ? '0.3%' : '1%'}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Tick range — LP only */}
            {row.assetType === 2 && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="stat-label">Tick Lower</label>
                  <input
                    type="number"
                    value={row.tickLower}
                    onChange={e => updateRow(i, 'tickLower', e.target.value)}
                    className="input-money"
                  />
                </div>
                <div className="space-y-1">
                  <label className="stat-label">Tick Upper</label>
                  <input
                    type="number"
                    value={row.tickUpper}
                    onChange={e => updateRow(i, 'tickUpper', e.target.value)}
                    className="input-money"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add slot button */}
      <button
        onClick={addRow}
        className="w-full py-2 rounded-lg text-sm font-semibold transition-colors"
        style={{ background: 'rgba(212,175,55,0.07)', border: '1px dashed rgba(212,175,55,0.25)', color: 'rgba(212,175,55,0.6)' }}
      >
        + Add asset slot
      </button>

      {/* Weight total indicator */}
      <div className="flex items-center justify-between text-sm">
        <span className="stat-label" style={{ marginBottom: 0 }}>Total weight</span>
        <span
          className="font-bold"
          style={{ color: weightOk ? '#34d399' : totalWeight > 10000 ? '#f87171' : 'rgba(212,175,55,0.7)' }}
        >
          {(totalWeight / 100).toFixed(0)}% {weightOk ? '✓' : totalWeight > 10000 ? '(over)' : '(must reach 100%)'}
        </span>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!weightOk || isPending || isConfirming || !!portfolioActive}
        className="btn-gold"
      >
        {isPending ? 'Confirm in wallet…' : isConfirming ? 'Saving…' : 'Set Portfolio Config'}
      </button>

      {isConfirmed && (
        <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Configuration saved.</p>
      )}
      {writeError && (
        <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
      )}
    </div>
  )
}
