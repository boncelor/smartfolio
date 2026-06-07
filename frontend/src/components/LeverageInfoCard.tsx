import { useReadContracts, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function LtvGauge({ ltvBps }: { ltvBps: bigint }) {
  const pct = Number(ltvBps) / 100
  const fill = Math.min(pct / 10, 1)
  const color =
    pct >= 8 ? '#ef4444' : pct >= 5 ? '#f59e0b' : '#10b981'
  const textColor =
    pct >= 8 ? '#f87171' : pct >= 5 ? '#fbbf24' : '#34d399'

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="stat-label" style={{ marginBottom: 0 }}>LTV</span>
        <span className="text-sm font-bold" style={{ color: textColor }}>
          {pct.toFixed(2)}% / 10%
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.07)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${fill * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  )
}

function HealthFactor({ hf }: { hf: bigint }) {
  const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
  const val = hf === MAX ? Infinity : Number(hf) / 1e18
  const color = val >= 1.5 ? '#34d399' : val >= 1.1 ? '#fbbf24' : '#f87171'
  return (
    <span className="font-bold text-lg" style={{ color }}>
      {val === Infinity ? '∞' : val.toFixed(3)}
    </span>
  )
}

export default function LeverageInfoCard({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const isZeroAddress = CONTRACT_ADDRESS === ZERO_ADDRESS

  const { data, isPending } = useReadContracts({
    contracts: [
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'isLeverageToken',
        args: [BigInt(tokenId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'getLeverageInfo',
        args: [BigInt(tokenId)],
      },
      {
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'balanceOf',
        args: [address ?? ZERO_ADDRESS as `0x${string}`, BigInt(tokenId)],
      },
    ],
    query: { enabled: !isZeroAddress },
  })

  if (isZeroAddress) return null

  if (isPending) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading leverage info…</p>
      </div>
    )
  }

  const isLeverage = data?.[0]?.status === 'success' ? data[0].result : false
  if (!isLeverage) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>
          Token ID {tokenId} is not a leverage token.
        </p>
      </div>
    )
  }

  const info    = data?.[1]?.status === 'success' ? data[1].result : null
  const balance = data?.[2]?.status === 'success' ? data[2].result : null

  if (!info) {
    return (
      <div className="card">
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>No leverage data</p>
      </div>
    )
  }

  const hasPosition = info.collateralWeth > 0n
  const hasDebt     = info.debtStable > 0n

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Leverage Position</h3>
        <span className="badge-gold">Aave V3</span>
      </div>

      {!hasPosition ? (
        <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>No active leverage position.</p>
      ) : (
        <div className="space-y-4">
          <LtvGauge ltvBps={info.ltvBps} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="stat-label">Collateral (WETH)</p>
              <p className="stat-value">{formatEther(info.collateralWeth)} ETH</p>
            </div>
            <div>
              <p className="stat-label">Debt (stable)</p>
              <p className="stat-value">
                {hasDebt ? `${(Number(info.debtStable) / 1e6).toFixed(2)} USDC` : '—'}
              </p>
            </div>
            <div>
              <p className="stat-label">Health Factor</p>
              <HealthFactor hf={info.healthFactor} />
            </div>
            <div>
              <p className="stat-label">ETH / USD</p>
              <p className="stat-value">
                {info.ethPriceUsd > 0n
                  ? `$${(Number(info.ethPriceUsd) / 1e8).toFixed(2)}`
                  : <span style={{ color: 'rgba(212,175,55,0.4)', fontSize: '0.875rem' }}>No feed</span>}
              </p>
            </div>
            <div>
              <p className="stat-label">Available Borrows</p>
              <p className="stat-value">${(Number(info.availableBorrows) / 1e8).toFixed(2)}</p>
            </div>
            <div>
              <p className="stat-label">Emergency Floor</p>
              <p className="stat-value">
                {info.emergencyFloor > 0n
                  ? (Number(info.emergencyFloor) / 1e18).toFixed(2)
                  : <span style={{ color: 'rgba(212,175,55,0.4)', fontSize: '0.875rem' }}>Disabled</span>}
              </p>
            </div>
          </div>

          {hasDebt && (
            <div className="box-warning">
              Outstanding debt — divest unavailable until keeper calls leverDown to repay.
            </div>
          )}
        </div>
      )}

      {isConnected && balance !== null && balance !== undefined && (
        <div className="pt-3 border-t divider-money flex items-center justify-between">
          <span className="stat-label" style={{ marginBottom: 0 }}>Your Balance</span>
          <span className="font-semibold text-white">{balance.toString()} tokens</span>
        </div>
      )}
    </div>
  )
}
