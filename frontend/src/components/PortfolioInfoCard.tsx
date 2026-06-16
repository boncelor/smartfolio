import { useState } from 'react'
import { useReadContracts, useWriteContract, useWaitForTransactionReceipt, useAccount, usePublicClient } from 'wagmi'
import { formatEther, parseUnits } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI, SMF_ADDRESS, SMF_ABI } from '../contracts'
import PortfolioConfigForm from './PortfolioConfigForm'
import { buildRebalanceAllInstructions, type RebalancePreview } from '../utils/rebalanceInstructions'

interface Props {
  tokenId: number
}

const ASSET_TYPE_LABELS = ['ERC20', 'AAVE', 'LP', 'SMF', 'STAKING', 'ETH']
const TIER_LABELS = ['Base (≥20% SMF)', 'LP (≥40% SMF)', 'Leverage (≥60% SMF)']

// Sepolia WETH
const WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'

type Mode = 'view' | 'config' | 'rebalance' | 'topup'

export default function PortfolioInfoCard({ tokenId }: Props) {
  const [mode, setMode] = useState<Mode>('view')
  const [preview, setPreview] = useState<RebalancePreview | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [smfInput, setSmfInput] = useState('')

  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const id = BigInt(tokenId)

  const { data, refetch } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'reserve',              args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'totalSupply',          args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'getPortfolioConfig',   args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'getPortfolioTierInfo', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioSMFHoldings', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioAaveWeth',    args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'balanceOf',            args: [address ?? '0x0000000000000000000000000000000000000000', id] },
      { address: SMF_ADDRESS,      abi: SMF_ABI,        functionName: 'balanceOf',            args: [address ?? '0x0000000000000000000000000000000000000000'] },
    ],
    query: { enabled: tokenId > 0 },
  })

  const reserve      = data?.[0]?.status === 'success' ? (data[0].result as bigint) : undefined
  const totalSupply  = data?.[1]?.status === 'success' ? (data[1].result as bigint) : undefined
  const config       = data?.[2]?.status === 'success' ? (data[2].result as readonly { assetType: number; token: string; weightBps: number; poolFee: number; sellSwapPath: string }[]) : undefined
  const tierInfo     = data?.[3]?.status === 'success' ? (data[3].result as readonly [bigint, number]) : undefined
  const smfHoldings  = data?.[4]?.status === 'success' ? (data[4].result as bigint) : undefined
  const aaveWeth     = data?.[5]?.status === 'success' ? (data[5].result as bigint) : undefined
  const holderBalance = data?.[6]?.status === 'success' ? (data[6].result as bigint) : undefined
  const userSmfBalance = data?.[7]?.status === 'success' ? (data[7].result as bigint) : undefined

  const smfWeightBps = tierInfo?.[0]
  const tier         = tierInfo?.[1]
  const isHolder     = isConnected && holderBalance !== undefined && holderBalance > 0n

  // Fetch ERC20 holdings and symbols for each ERC20 asset in config
  const erc20Assets = config?.filter(a => a.assetType === 0) ?? []
  const ERC20_SYMBOL_ABI = [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] }] as const

  const { data: holdingsData } = useReadContracts({
    contracts: erc20Assets.map(a => ({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'portfolioHoldings' as const,
      args: [id, a.token as `0x${string}`],
    })),
    query: { enabled: erc20Assets.length > 0 },
  })

  const { data: symbolsData } = useReadContracts({
    contracts: erc20Assets.map(a => ({
      address: a.token as `0x${string}`,
      abi: ERC20_SYMBOL_ABI,
      functionName: 'symbol' as const,
    })),
    query: { enabled: erc20Assets.length > 0 },
  })

  const erc20Holdings: Record<string, bigint> = Object.fromEntries(
    erc20Assets.map((a, i) => [
      a.token.toLowerCase(),
      holdingsData?.[i]?.status === 'success' ? (holdingsData[i].result as bigint) : 0n,
    ])
  )
  const erc20Symbols: Record<string, string> = Object.fromEntries(
    erc20Assets.map((a, i) => [
      a.token.toLowerCase(),
      symbolsData?.[i]?.status === 'success' ? (symbolsData[i].result as string) : a.token.slice(0, 8) + '…',
    ])
  )
  const hasReserve   = reserve !== undefined && reserve > 0n
  const hasErc20     = config !== undefined && config.some(a => a.assetType === 0)
  // Config has assets that actually need ETH deployed into them (non-ETH-slice types)
  const hasDeployableAssets = config !== undefined && config.some(a => a.assetType !== 5)

  // "Deploy Reserve" is only meaningful when there's reserve ETH AND assets to deploy into.
  // If the config only has an ETH slice, the reserve is where it's supposed to be — no deploy needed.
  const needsDeploy = isHolder && hasReserve && hasDeployableAssets
  // Show rebalance whenever the holder has ERC20 assets (to allow weight adjustments) or has reserve to deploy
  const needsRebalance = isHolder && (hasErc20 || needsDeploy)

  // Rebalance write
  const { writeContract: writeRebalance, data: rebalanceHash, isPending: rebalancePending, error: rebalanceError, reset: resetRebalance } = useWriteContract()
  const { isLoading: rebalanceConfirming, isSuccess: rebalanceConfirmed } = useWaitForTransactionReceipt({ hash: rebalanceHash })

  // Deploy reserve write
  const { writeContract: writeDeploy, data: deployHash, isPending: deployPending, error: deployError, reset: resetDeploy } = useWriteContract()
  const { isLoading: deployConfirming, isSuccess: deployConfirmed } = useWaitForTransactionReceipt({ hash: deployHash })

  // Top-up write
  const { writeContract: writeAddSMF, data: addSMFHash, isPending: addSMFPending, error: addSMFError, reset: resetAddSMF } = useWriteContract()
  const { isLoading: addSMFConfirming, isSuccess: addSMFConfirmed } = useWaitForTransactionReceipt({ hash: addSMFHash })

  if (tokenId === 0) return null

  // --- Config mode ---
  if (mode === 'config') {
    return (
      <div className="relative">
        <button
          onClick={() => setMode('view')}
          title="Back to portfolio"
          className="absolute top-4 right-4 z-10 p-1.5 rounded transition-colors"
          style={{ color: 'rgba(212,175,55,0.5)' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <PortfolioConfigForm tokenId={tokenId} />
      </div>
    )
  }

  // --- Rebalance mode ---
  if (mode === 'rebalance') {
    async function handleQuote() {
      if (!config || !publicClient) return
      setQuoting(true)
      setPreview(null)
      resetRebalance()

      // Fetch fresh ERC20 holdings
      const erc20Assets = config.filter(a => a.assetType === 0)
      const holdingResults = await Promise.all(
        erc20Assets.map(a =>
          publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: SMARTFOLIO_ABI,
            functionName: 'portfolioHoldings',
            args: [id, a.token as `0x${string}`],
          }).then(v => [a.token.toLowerCase(), v as bigint] as const).catch(() => [a.token.toLowerCase(), 0n] as const)
        )
      )
      const holdings: Record<string, bigint> = Object.fromEntries(holdingResults)

      // SMF burn value query — use flat-fee path for rebalance quotes
      const smfBurnValueFn = async (wholeTokens: bigint): Promise<bigint> => {
        return publicClient.readContract({
          address: SMF_ADDRESS,
          abi: SMF_ABI,
          functionName: 'smfBurnValueForRebalance',
          args: [wholeTokens],
        }) as Promise<bigint>
      }

      const result = await buildRebalanceAllInstructions(
        config.map(a => ({
          ...a,
          swapFee: (a as { swapFee?: number }).swapFee ?? 0,
          tickLower: (a as { tickLower?: number }).tickLower ?? 0,
          tickUpper: (a as { tickUpper?: number }).tickUpper ?? 0,
          swapPath: (a as { swapPath?: string }).swapPath ?? '0x',
          sellSwapPath: (a as { sellSwapPath?: string }).sellSwapPath ?? '0x',
        })),
        smfHoldings ?? 0n,
        holdings,
        reserve ?? 0n,
        WETH_ADDRESS,
        publicClient,
        smfBurnValueFn,
      )
      setPreview(result)
      setQuoting(false)
    }

    function handleExecute() {
      if (!preview || preview.instructions.length === 0) return
      resetRebalance()
      writeRebalance({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'rebalanceAll',
        args: [
          id,
          preview.instructions.map(inst => ({
            token:        inst.token as `0x${string}`,
            isSell:       inst.isSell,
            amountIn:     inst.amountIn,
            amountOutMin: inst.amountOutMin,
            poolFee:      inst.poolFee,
            swapPath:     inst.swapPath as `0x${string}`,
            sellSwapPath: inst.sellSwapPath as `0x${string}`,
          })),
        ],
      })
    }

    const tokenLabel = (addr: string) =>
      addr.toLowerCase() === SMF_ADDRESS.toLowerCase()
        ? 'SMF'
        : erc20Symbols[addr.toLowerCase()] ?? addr.slice(0, 8) + '…'

    return (
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Rebalance</h2>
          <button
            onClick={() => { setMode('view'); setPreview(null) }}
            className="p-1.5 rounded"
            style={{ color: 'rgba(212,175,55,0.5)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Rebalances SMF and ERC20 positions to match config weights. SMF sells go via bonding curve;
          ERC20s swap via Uniswap. All settlement flows through the ETH reserve. AAVE and LP slices are not touched.
        </p>

        {/* Deploy reserve section — shown when there is fresh ETH in reserve to deploy */}
        {needsDeploy && reserve !== undefined && (
          <div className="space-y-2 pb-3" style={{ borderBottom: '1px solid rgba(212,175,55,0.1)' }}>
            <p className="stat-label">Deploy Reserve</p>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {formatEther(reserve)} ETH in reserve — deploy into basket per config weights first.
            </p>
            <button
              onClick={() => {
                if (!config || reserve === undefined) return
                resetDeploy()
                const erc20Count = config.filter(a => a.assetType === 0).length
                writeDeploy({
                  address: CONTRACT_ADDRESS,
                  abi: SMARTFOLIO_ABI,
                  functionName: 'deploy',
                  args: [id, Array(erc20Count).fill(0n), 0n, 0n, 0n, 0n],
                  gas: 3_000_000n,
                })
              }}
              disabled={deployPending || deployConfirming}
              className="btn-outline-gold w-full"
            >
              {deployPending ? 'Confirm…' : deployConfirming ? 'Deploying…' : 'Deploy Reserve'}
            </button>
            {deployConfirmed && <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Reserve deployed.</p>}
            {deployError && <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {deployError.message}</p>}
          </div>
        )}

        {!preview && (
          <button onClick={handleQuote} disabled={quoting} className="btn-outline-gold">
            {quoting ? 'Getting quotes…' : 'Get Quote'}
          </button>
        )}

        {preview?.error && (
          <p className="text-sm" style={{ color: '#f87171' }}>{preview.error}</p>
        )}

        {preview && !preview.error && (
          <div className="space-y-3">
            {preview.sells.length > 0 && (
              <div className="space-y-1">
                <p className="stat-label">Sells → ETH reserve</p>
                {preview.sells.map((s, i) => (
                  <div key={i} className="flex justify-between text-sm rounded px-2.5 py-1.5" style={{ background: 'rgba(5,25,14,0.5)', border: '1px solid rgba(212,175,55,0.08)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.65)' }}>{tokenLabel(s.token)}</span>
                    <span style={{ color: '#f87171' }}>→ ~{parseFloat(formatEther(s.estimatedEth)).toFixed(5)} ETH</span>
                  </div>
                ))}
              </div>
            )}
            {preview.buys.length > 0 && (
              <div className="space-y-1">
                <p className="stat-label">Buys ← ETH reserve</p>
                {preview.buys.map((b, i) => (
                  <div key={i} className="flex justify-between text-sm rounded px-2.5 py-1.5" style={{ background: 'rgba(5,25,14,0.5)', border: '1px solid rgba(212,175,55,0.08)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.65)' }}>{tokenLabel(b.token)}</span>
                    <span style={{ color: '#34d399' }}>{parseFloat(formatEther(b.amountIn)).toFixed(5)} ETH ({(b.weightBps / 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleQuote} disabled={quoting} className="btn-outline-gold flex-1">
                {quoting ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={handleExecute}
                disabled={rebalancePending || rebalanceConfirming || preview.instructions.length === 0}
                className="btn-money flex-1"
              >
                {rebalancePending ? 'Confirm…' : rebalanceConfirming ? 'Rebalancing…' : 'Execute'}
              </button>
            </div>
          </div>
        )}

        {rebalanceConfirmed && (
          <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
            Rebalanced successfully.
          </p>
        )}
        {rebalanceError && (
          <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {rebalanceError.message}</p>
        )}
      </div>
    )
  }

  // --- Top-up mode ---
  if (mode === 'topup') {
    function handleAddSMF() {
      if (!smfInput) return
      resetAddSMF()
      writeAddSMF({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'addSMFToNFT',
        args: [id, parseUnits(smfInput, 18)],
      })
    }

    return (
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Top Up Portfolio</h2>
          <button
            onClick={() => { setMode('view'); setSmfInput('') }}
            className="p-1.5 rounded"
            style={{ color: 'rgba(212,175,55,0.5)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {userSmfBalance !== undefined && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Your SMF balance: <span style={{ color: 'rgba(255,255,255,0.65)' }}>{parseFloat(formatEther(userSmfBalance)).toLocaleString(undefined, { maximumFractionDigits: 2 })} SMF</span>
          </p>
        )}

        <div className="space-y-1">
          <label className="stat-label">SMF amount</label>
          <input
            type="number" min={1}
            value={smfInput}
            onChange={e => setSmfInput(e.target.value)}
            placeholder="e.g. 100"
            className="input-money"
          />
        </div>
        <button
          onClick={handleAddSMF}
          disabled={!smfInput || addSMFPending || addSMFConfirming}
          className="btn-gold w-full"
        >
          {addSMFPending ? 'Confirm…' : addSMFConfirming ? 'Adding…' : 'Add SMF to Portfolio'}
        </button>
        {addSMFConfirmed && <p className="text-sm font-semibold" style={{ color: '#34d399' }}>SMF added.</p>}
        {addSMFError && <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {addSMFError.message}</p>}
      </div>
    )
  }

  // --- Normal view ---
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Portfolio</h2>
        <div className="flex items-center gap-1">
          {isHolder && (
            <button
              onClick={() => setMode('topup')}
              title="Top up — add SMF or ETH to reserve"
              className="p-1.5 rounded transition-colors text-xs font-semibold"
              style={{ color: 'rgba(212,175,55,0.6)' }}
            >
              +
            </button>
          )}
          {needsRebalance && (
            <button
              onClick={() => { setMode('rebalance'); setPreview(null) }}
              title="Portfolio out of sync with config — rebalance needed"
              className="p-1.5 rounded transition-colors text-xs font-semibold"
              style={{ color: '#f59e0b' }}
            >
              ⚠ Rebalance
            </button>
          )}
          <button
            onClick={() => setMode('config')}
            title="Configure portfolio"
            className="p-1.5 rounded transition-colors"
            style={{ color: 'rgba(212,175,55,0.4)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* SMF holdings — first */}
      {smfHoldings !== undefined && smfHoldings > 0n && (
        <div className="space-y-1.5">
          <p className="stat-label">SMF in Portfolio</p>
          <div
            className="rounded px-2.5 py-1.5 flex items-center justify-between text-sm"
            style={{ background: 'rgba(5,25,14,0.7)', border: '1px solid rgba(212,175,55,0.12)' }}
          >
            <span className="font-semibold text-white">{parseFloat(formatEther(smfHoldings)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SMF</span>
          </div>
        </div>
      )}

      {/* ETH reserve — second */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="stat-label">Reserve</p>
          <p className="text-sm font-semibold text-white">
            {reserve !== undefined ? `${formatEther(reserve)} ETH` : '—'}
          </p>
        </div>
        <div>
          <p className="stat-label">Supply</p>
          <p className="text-sm font-semibold text-white">
            {totalSupply !== undefined ? totalSupply.toString() : '—'}
          </p>
        </div>
      </div>

      {/* AAVE holdings */}
      {aaveWeth !== undefined && aaveWeth > 0n && (
        <div className="space-y-1.5">
          <p className="stat-label">AAVE</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div
              className="rounded px-2.5 py-1.5"
              style={{ background: 'rgba(5,25,14,0.7)', border: '1px solid rgba(212,175,55,0.12)' }}
            >
              <p className="stat-label" style={{ fontSize: '0.65rem' }}>AAVE WETH</p>
              <p className="font-semibold text-white">{formatEther(aaveWeth)} ETH</p>
            </div>
          </div>
        </div>
      )}

      {/* Asset config table */}
      {config !== undefined && config.length > 0 && (
        <div className="space-y-1.5">
          <p className="stat-label">Asset Allocation</p>
          <div className="space-y-1">
            {config.map((asset, i) => {
              const holding = asset.assetType === 0
                ? erc20Holdings[asset.token.toLowerCase()]
                : asset.assetType === 5
                ? reserve  // ETH slice lives in reserve
                : undefined
              return (
                <div
                  key={i}
                  className="rounded px-2.5 py-1.5 text-sm"
                  style={{
                    background: 'rgba(5,25,14,0.5)',
                    border: needsRebalance && asset.assetType === 0 && (erc20Holdings[asset.token.toLowerCase()] ?? 0n) === 0n
                      ? '1px solid rgba(245,158,11,0.4)'
                      : '1px solid rgba(212,175,55,0.08)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={
                          asset.assetType === 3
                            ? { background: 'rgba(212,175,55,0.15)', color: '#d4af37' }
                            : { background: 'rgba(52,211,153,0.1)', color: '#34d399' }
                        }
                      >
                        {ASSET_TYPE_LABELS[asset.assetType] ?? `Type ${asset.assetType}`}
                      </span>
                      <span
                        className="text-xs truncate"
                        style={{ color: 'rgba(255,255,255,0.65)', maxWidth: '9rem' }}
                      >
                        {asset.assetType === 0
                          ? erc20Symbols[asset.token.toLowerCase()] ?? asset.token
                          : asset.assetType === 1
                          ? 'WETH (Aave)'
                          : asset.assetType === 3
                          ? 'SMF'
                          : asset.assetType === 5
                          ? 'ETH'
                          : asset.token}
                      </span>
                    </div>
                    <span className="font-bold" style={{ color: '#d4af37' }}>
                      {(asset.weightBps / 100).toFixed(0)}%
                    </span>
                  </div>
                  {holding !== undefined && holding > 0n && (
                    <div className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {asset.assetType === 5 ? 'Reserve: ' : 'Balance: '}
                      <span style={{ color: 'rgba(255,255,255,0.65)' }}>
                        {formatEther(holding)}{asset.assetType === 5 ? ' ETH' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {config !== undefined && config.length === 0 && (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
          No portfolio configured for this token ID.
        </p>
      )}
    </div>
  )
}
