import { useState, useEffect } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

// AssetType enum: 0=ERC20, 1=AAVE, 2=LP, 3=SMF, 4=STAKING, 5=ETH
const ASSET_TYPES = [
  { value: 0, label: 'ERC20' },
  { value: 1, label: 'AAVE' },
  { value: 2, label: 'LP' },
  { value: 3, label: 'SMF' },
  { value: 5, label: 'ETH (reserve)' },
]

const POOL_FEES = [100, 500, 3000, 10000]

// Sepolia token addresses
const ERC20_TOKENS = [
  { label: 'WBTC',  address: '0x29f2D40B0605204364af54EC677bD022dA425d03' },
  { label: 'LINK',  address: '0x779877A7B0D9E8603169DdbD7836e478b4624789' },
  { label: 'AAVE',  address: '0x88541670E55cC00bEEFD87eB59EDd1b7C511AC9A' },
  { label: 'USDC',  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  { label: 'USDT',  address: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0' },
  { label: 'DAI',   address: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357' },
]

interface AssetRow {
  assetType: number
  token: string
  useCustomToken: boolean
  weightBps: number
  poolFee: string
  swapFee: string
  tickLower: string
  tickUpper: string
}

function emptyRow(): AssetRow {
  return { assetType: 0, token: '', useCustomToken: false, weightBps: 0, poolFee: '3000', swapFee: '3000', tickLower: '-887220', tickUpper: '887220' }
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

  const { data: existingConfig } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'getPortfolioConfig',
    args: [BigInt(tokenId)],
  })

  // Populate rows from on-chain config when it loads
  useEffect(() => {
    if (!existingConfig) return
    const config = existingConfig as readonly {
      assetType: number; token: string; weightBps: number
      poolFee: number; swapFee: number; tickLower: number; tickUpper: number
    }[]
    if (config.length === 0) return
    setRows(config.map(a => ({
      assetType: a.assetType,
      token: a.token,
      useCustomToken: false,
      weightBps: a.weightBps,
      poolFee: String(a.poolFee || 3000),
      swapFee: String(a.swapFee || 3000),
      tickLower: String(a.tickLower ?? -887220),
      tickUpper: String(a.tickUpper ?? 887220),
    })))
  }, [existingConfig])

  const isOwner = isConnected && address?.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  const totalWeight = rows.reduce((sum, r) => sum + r.weightBps, 0)
  const weightOk = totalWeight === 10000

  const smfWeightBps = rows
    .filter(r => r.assetType === 3)
    .reduce((sum, r) => sum + r.weightBps, 0)
  const hasLP    = rows.some(r => r.assetType === 2)
  const hasAAVE  = rows.some(r => r.assetType === 1)
  const smfOk    = smfWeightBps >= 2000
  const lpTierOk = !hasLP   || smfWeightBps >= 4000
  const lvTierOk = !hasAAVE || smfWeightBps >= 6000

  // Dynamic SMF minimum: 20% base, 40% with LP, 60% with AAVE
  const smfMinBps = hasAAVE ? 6000 : hasLP ? 4000 : 2000

  function updateRow(i: number, field: keyof AssetRow, value: string | number | boolean) {
    setRows(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      // Auto-fill SMF token address; reset token/custom on type change
      if (field === 'assetType') {
        next[i].token = value === 3 && smfAddr ? (smfAddr as string) : ''
        next[i].useCustomToken = false
      }
      return next
    })
  }

  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function removeRow(i: number) { setRows(prev => prev.filter((_, j) => j !== i)) }

  function handleSubmit() {
    const assets = rows.map(r => ({
      assetType: r.assetType,
      token:     (r.assetType === 3
        ? (smfAddr as string) || r.token
        : r.token || '0x0000000000000000000000000000000000000000') as `0x${string}`,
      weightBps: r.weightBps,
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
              {row.assetType !== 3 && (
                <button
                  onClick={() => removeRow(i)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
                >
                  Remove
                </button>
              )}
            </div>

            {/* Asset type */}
            <div className="space-y-1">
              <label className="stat-label">Type</label>
              <select
                value={row.assetType}
                onChange={e => updateRow(i, 'assetType', parseInt(e.target.value))}
                disabled={row.assetType === 3}
                className="select-money"
                style={row.assetType === 3 ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                {ASSET_TYPES.filter(t => row.assetType === 3 || t.value !== 3).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Weight slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="stat-label" style={{ marginBottom: 0 }}>Weight</label>
                <span className="text-sm font-bold" style={{ color: row.weightBps > 0 ? 'rgba(212,175,55,0.9)' : 'rgba(212,175,55,0.35)' }}>
                  {(row.weightBps / 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={row.assetType === 3 ? smfMinBps : 0}
                max={10000}
                step={500}
                value={row.weightBps}
                onChange={e => {
                  const next = parseInt(e.target.value)
                  const minVal = row.assetType === 3 ? smfMinBps : 0
                  const available = row.weightBps + (10000 - totalWeight)
                  updateRow(i, 'weightBps', Math.max(minVal, Math.min(next, available)))
                }}
                className="w-full"
                style={{ accentColor: '#d4af37' }}
              />
            </div>

            {/* Token address — not needed for AAVE or ETH */}
            {row.assetType !== 1 && row.assetType !== 5 && (
              <div className="space-y-1">
                <label className="stat-label">
                  {row.assetType === 3 ? 'SMF contract' :
                   row.assetType === 2 ? 'Token B' : 'Token'}
                </label>
                {(row.assetType === 0 || row.assetType === 2) && !row.useCustomToken ? (
                  <select
                    value={row.token}
                    onChange={e => {
                      if (e.target.value === '__custom__') {
                        setRows(prev => { const n = [...prev]; n[i] = { ...n[i], useCustomToken: true, token: '' }; return n })
                      } else {
                        updateRow(i, 'token', e.target.value)
                      }
                    }}
                    className="select-money"
                  >
                    <option value="">Select token…</option>
                    {smfAddr && <option value={smfAddr as string}>SMF</option>}
                    {ERC20_TOKENS.map(t => (
                      <option key={t.address} value={t.address}>{t.label}</option>
                    ))}
                    <option value="__custom__">Custom address…</option>
                  </select>
                ) : (row.assetType === 0 || row.assetType === 2) && row.useCustomToken ? (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={row.token}
                      onChange={e => updateRow(i, 'token', e.target.value)}
                      placeholder="0x…"
                      className="input-money font-mono text-xs"
                      autoFocus
                    />
                    <button
                      onClick={() => setRows(prev => { const n = [...prev]; n[i] = { ...n[i], useCustomToken: false, token: '' }; return n })}
                      className="text-xs"
                      style={{ color: 'rgba(212,175,55,0.5)' }}
                    >
                      ← Back to presets
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={row.token}
                    onChange={e => updateRow(i, 'token', e.target.value)}
                    placeholder="0x…"
                    className="input-money font-mono text-xs"
                  />
                )}
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

      {/* SMF requirement warnings */}
      {!smfOk && (
        <div className="box-warning text-sm">
          Portfolio must include at least <strong>20% SMF</strong> (Base tier). Add an SMF slot.
        </div>
      )}
      {!lpTierOk && (
        <div className="box-warning text-sm">
          LP positions require at least <strong>40% SMF</strong> (LP tier). Current SMF: {(smfWeightBps / 100).toFixed(0)}%.
        </div>
      )}
      {!lvTierOk && (
        <div className="box-warning text-sm">
          AAVE positions require at least <strong>60% SMF</strong> (Leverage tier). Current SMF: {(smfWeightBps / 100).toFixed(0)}%.
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!weightOk || !smfOk || !lpTierOk || !lvTierOk || isPending || isConfirming}
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
