import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI } from '../contracts'

interface Props {
  tokenId: number
}

type Action = 'deploy' | 'rebalance'

export default function PortfolioKeeperPanel({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const [action, setAction] = useState<Action>('deploy')

  // Deploy state
  const [erc20Mins, setErc20Mins] = useState('')   // comma-separated, one per ERC20 slot

  // Rebalance state
  const [rebalInstructions, setRebalInstructions] = useState('')  // JSON array

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
  const { data: portfolioActive } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'portfolioActive',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  })
  const { data: config } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'getPortfolioConfig',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  }) as { data: readonly { assetType: number }[] | undefined }

  const isKeeper =
    isConnected &&
    address &&
    (address.toLowerCase() === (keeperAddr as string | undefined)?.toLowerCase() ||
     address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase())

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  // Count ERC20 slots (assetType === 0)
  const erc20Count = config?.filter(a => a.assetType === 0).length ?? 0

  function handleDeploy() {
    const mins = erc20Mins
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => BigInt(s))

    // Pad with zeros to match erc20Count
    while (mins.length < erc20Count) mins.push(0n)

    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'deploy',
      args: [BigInt(tokenId), mins, 0n, 0n, 0n, 0n],
      gas: 3_000_000n,
    })
  }

  function handleRebalance() {
    let instructions: {
      token: `0x${string}`
      isSell: boolean
      amountIn: bigint
      amountOutMin: bigint
      poolFee: number
      swapPath: `0x${string}`
      sellSwapPath: `0x${string}`
    }[] = []
    try {
      const parsed = JSON.parse(rebalInstructions)
      instructions = parsed.map((item: {
        token: string
        isSell: boolean
        amountIn: string
        amountOutMin?: string
        poolFee: number
      }) => ({
        token:        item.token as `0x${string}`,
        isSell:       item.isSell,
        amountIn:     BigInt(item.amountIn),
        amountOutMin: BigInt(item.amountOutMin ?? '0'),
        poolFee:      item.poolFee,
        swapPath:     '0x' as `0x${string}`,
        sellSwapPath: '0x' as `0x${string}`,
      }))
    } catch {
      return
    }
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'rebalance',
      args: [BigInt(tokenId), instructions],
    })
  }

  if (!isKeeper) return null

  return (
    <div className="card space-y-4" style={{ borderColor: 'rgba(212,175,55,0.4)' }}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Portfolio Keeper</h2>
        <span className="badge-keeper">Keeper Only</span>
      </div>

      {/* Action selector */}
      <div className="flex gap-2">
        {(['deploy', 'rebalance'] as Action[]).map(a => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors border capitalize"
            style={
              action === a
                ? { background: 'var(--gold-gradient)', borderColor: 'var(--gold-foil)', color: '#05190e' }
                : { background: 'transparent', borderColor: 'rgba(212,175,55,0.2)', color: 'rgba(255,255,255,0.4)' }
            }
          >
            {a === 'deploy' ? 'Deploy' : 'Rebalance'}
          </button>
        ))}
      </div>

      {/* Deploy */}
      {action === 'deploy' && (
        <div className="space-y-3">
          {portfolioActive && (
            <div className="box-warning">Portfolio is already deployed. Divest first to re-deploy.</div>
          )}
          {config !== undefined && config.length === 0 && (
            <div className="box-warning">No portfolio config set for this token ID.</div>
          )}
          {erc20Count > 0 && (
            <div className="space-y-1">
              <label className="stat-label">
                Min amounts for {erc20Count} ERC20 slot{erc20Count > 1 ? 's' : ''} (comma-separated wei, 0 = no slippage guard)
              </label>
              <input
                type="text"
                value={erc20Mins}
                onChange={e => setErc20Mins(e.target.value)}
                placeholder={Array(erc20Count).fill('0').join(', ')}
                className="input-money font-mono text-xs"
              />
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                One value per ERC20 asset slot in config order. Leave empty to use 0 for all.
              </p>
            </div>
          )}
          <button
            onClick={handleDeploy}
            disabled={!!portfolioActive || isPending || isConfirming}
            className="btn-gold"
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Deploying…' : 'Deploy Portfolio'}
          </button>
        </div>
      )}

      {/* Rebalance */}
      {action === 'rebalance' && (
        <div className="space-y-3">
          {!portfolioActive && (
            <div className="box-warning">Portfolio must be deployed before rebalancing.</div>
          )}
          <div className="space-y-1">
            <label className="stat-label">Instructions (JSON array)</label>
            <textarea
              value={rebalInstructions}
              onChange={e => setRebalInstructions(e.target.value)}
              rows={5}
              placeholder={`[\n  {\n    "token": "0x…",\n    "isSell": true,\n    "amountIn": "1000000000000000000",\n    "poolFee": 3000\n  }\n]`}
              className="input-money font-mono text-xs w-full resize-y"
              style={{ minHeight: '8rem' }}
            />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Each instruction: token, isSell, amountIn (wei), amountOutMin (wei, optional), poolFee.
            </p>
          </div>
          <button
            onClick={handleRebalance}
            disabled={!portfolioActive || !rebalInstructions.trim() || isPending || isConfirming}
            className="btn-gold"
          >
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Rebalancing…' : 'Rebalance'}
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
