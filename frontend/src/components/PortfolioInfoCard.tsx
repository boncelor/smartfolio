import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'
import PortfolioConfigForm from './PortfolioConfigForm'

interface Props {
  tokenId: number
}

const ASSET_TYPE_LABELS = ['ERC20', 'AAVE', 'LP', 'SMF', 'STAKING']
const TIER_LABELS = ['Base (≥20% SMF)', 'LP (≥40% SMF)', 'Leverage (≥60% SMF)']

export default function PortfolioInfoCard({ tokenId }: Props) {
  const [configuring, setConfiguring] = useState(false)
  const id = BigInt(tokenId)

  const { data } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioActive',      args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'deployedEth',          args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'reserve',              args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'totalSupply',          args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'getPortfolioConfig',   args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'getPortfolioTierInfo', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioSMFHoldings', args: [id] },
      { address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioAaveWeth',    args: [id] },
    ],
    query: { enabled: tokenId > 0 },
  })

  const active         = data?.[0]?.status === 'success' ? (data[0].result as boolean) : undefined
  const deployedEth    = data?.[1]?.status === 'success' ? (data[1].result as bigint) : undefined
  const reserve        = data?.[2]?.status === 'success' ? (data[2].result as bigint) : undefined
  const totalSupply    = data?.[3]?.status === 'success' ? (data[3].result as bigint) : undefined
  const config         = data?.[4]?.status === 'success' ? (data[4].result as readonly { assetType: number; token: string; weightBps: number }[]) : undefined
  const tierInfo       = data?.[5]?.status === 'success' ? (data[5].result as readonly [bigint, number]) : undefined
  const smfHoldings    = data?.[6]?.status === 'success' ? (data[6].result as bigint) : undefined
  const aaveWeth       = data?.[7]?.status === 'success' ? (data[7].result as bigint) : undefined

  const smfWeightBps = tierInfo?.[0]
  const tier         = tierInfo?.[1]

  if (tokenId === 0) return null

  if (configuring) {
    return (
      <div className="relative">
        <button
          onClick={() => setConfiguring(false)}
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

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Portfolio</h2>
        <div className="flex items-center gap-2">
          {active !== undefined && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={
                active
                  ? { background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }
                  : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.1)' }
              }
            >
              {active ? 'Deployed' : 'Not Deployed'}
            </span>
          )}
          <button
            onClick={() => setConfiguring(true)}
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

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="stat-label">Reserve</p>
          <p className="text-sm font-semibold text-white">
            {reserve !== undefined ? `${formatEther(reserve)} ETH` : '—'}
          </p>
        </div>
        <div>
          <p className="stat-label">Deployed ETH</p>
          <p className="text-sm font-semibold text-white">
            {deployedEth !== undefined ? `${formatEther(deployedEth)} ETH` : '—'}
          </p>
        </div>
        <div>
          <p className="stat-label">Supply</p>
          <p className="text-sm font-semibold text-white">
            {totalSupply !== undefined ? totalSupply.toString() : '—'}
          </p>
        </div>
      </div>

      {/* Tier info */}
      {tierInfo !== undefined && smfWeightBps !== undefined && (
        <div
          className="rounded-lg px-3 py-2 flex items-center justify-between text-sm"
          style={{ background: 'rgba(212,175,55,0.07)', border: '1px solid rgba(212,175,55,0.15)' }}
        >
          <span className="stat-label" style={{ marginBottom: 0 }}>Tier</span>
          <span style={{ color: '#d4af37', fontWeight: 600 }}>
            {tier !== undefined ? TIER_LABELS[tier] ?? `Tier ${tier}` : '—'}
            {smfWeightBps !== undefined && (
              <span className="ml-2 font-normal" style={{ color: 'rgba(212,175,55,0.6)', fontSize: '0.75rem' }}>
                ({(Number(smfWeightBps) / 100).toFixed(0)}% SMF)
              </span>
            )}
          </span>
        </div>
      )}

      {/* SMF holdings — shown pre- and post-deployment */}
      {smfHoldings !== undefined && smfHoldings > 0n && (
        <div className="space-y-1.5">
          <p className="stat-label">SMF in Portfolio</p>
          <div
            className="rounded px-2.5 py-1.5 flex items-center justify-between text-sm"
            style={{ background: 'rgba(5,25,14,0.7)', border: '1px solid rgba(212,175,55,0.12)' }}
          >
            <span style={{ color: 'rgba(212,175,55,0.6)', fontSize: '0.75rem' }}>
              {active ? 'Deployed' : 'Pending deployment'}
            </span>
            <span className="font-semibold text-white">{smfHoldings.toString()} SMF</span>
          </div>
        </div>
      )}

      {/* Active holdings (AAVE etc.) */}
      {active && aaveWeth !== undefined && aaveWeth > 0n && (
        <div className="space-y-1.5">
          <p className="stat-label">Holdings</p>
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
            {config.map((asset, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded px-2.5 py-1.5 text-sm"
                style={{ background: 'rgba(5,25,14,0.5)', border: '1px solid rgba(212,175,55,0.08)' }}
              >
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
                    className="font-mono text-xs truncate"
                    style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '11rem' }}
                  >
                    {asset.token === '0x0000000000000000000000000000000000000000'
                      ? 'WETH (Aave)'
                      : asset.token}
                  </span>
                </div>
                <span className="font-bold" style={{ color: '#d4af37' }}>
                  {(asset.weightBps / 100).toFixed(0)}%
                </span>
              </div>
            ))}
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
