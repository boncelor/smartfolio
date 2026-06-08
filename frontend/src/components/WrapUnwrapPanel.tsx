import { useState } from 'react'
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from 'wagmi'
import { formatEther } from 'viem'
import {
  CONTRACT_ADDRESS,
  FACTORY_ADDRESS,
  FACTORY_ABI,
  SMARTFOLIO_ABI,
  SMARTFOLIO_TOKEN_ABI,
} from '../contracts'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

interface Props {
  tokenId: number
}

export default function WrapUnwrapPanel({ tokenId }: Props) {
  const { address, isConnected } = useAccount()
  const [wrapAmount, setWrapAmount]     = useState('')
  const [unwrapAmount, setUnwrapAmount] = useState('')

  const factoryDeployed = FACTORY_ADDRESS !== ZERO_ADDRESS

  // Resolve wrapper address for this token ID
  const { data: wrapperAddress } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'wrappers',
    args: [BigInt(tokenId)],
    query: { enabled: factoryDeployed && tokenId > 0 },
  })

  const hasWrapper = !!wrapperAddress && wrapperAddress !== ZERO_ADDRESS

  // ERC20 token metadata
  const { data: tokenName }   = useReadContract({
    address: wrapperAddress as `0x${string}`,
    abi: SMARTFOLIO_TOKEN_ABI,
    functionName: 'name',
    query: { enabled: hasWrapper },
  })
  const { data: tokenSymbol } = useReadContract({
    address: wrapperAddress as `0x${string}`,
    abi: SMARTFOLIO_TOKEN_ABI,
    functionName: 'symbol',
    query: { enabled: hasWrapper },
  })
  const { data: erc20TotalSupply } = useReadContract({
    address: wrapperAddress as `0x${string}`,
    abi: SMARTFOLIO_TOKEN_ABI,
    functionName: 'totalSupply',
    query: { enabled: hasWrapper },
  })

  // Balances
  const { data: erc1155Balance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'balanceOf',
    args: [address!, BigInt(tokenId)],
    query: { enabled: isConnected && !!address && tokenId > 0 },
  })
  const { data: erc20Balance } = useReadContract({
    address: wrapperAddress as `0x${string}`,
    abi: SMARTFOLIO_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: isConnected && !!address && hasWrapper },
  })

  // ERC1155 approval
  const { data: isApproved, refetch: refetchApproval } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'isApprovedForAll',
    args: [address!, wrapperAddress as `0x${string}`],
    query: { enabled: isConnected && !!address && hasWrapper },
  })

  // Approval tx
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApprovePending,
  } = useWriteContract()
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  // Wrap tx
  const {
    writeContract: writeWrap,
    data: wrapTxHash,
    isPending: isWrapPending,
    error: wrapError,
  } = useWriteContract()
  const { isLoading: isWrapConfirming, isSuccess: isWrapConfirmed } =
    useWaitForTransactionReceipt({ hash: wrapTxHash })

  // Unwrap tx
  const {
    writeContract: writeUnwrap,
    data: unwrapTxHash,
    isPending: isUnwrapPending,
    error: unwrapError,
  } = useWriteContract()
  const { isLoading: isUnwrapConfirming, isSuccess: isUnwrapConfirmed } =
    useWaitForTransactionReceipt({ hash: unwrapTxHash })

  const parsedWrap   = parseInt(wrapAmount) || 0
  const parsedUnwrap = parseInt(unwrapAmount) || 0

  function handleApprove() {
    if (!wrapperAddress) return
    writeApprove({
      address: CONTRACT_ADDRESS,
      abi: SMARTFOLIO_ABI,
      functionName: 'setApprovalForAll',
      args: [wrapperAddress as `0x${string}`, true],
    })
  }

  function handleWrap() {
    if (!wrapperAddress || parsedWrap <= 0 || !isApproved) return
    writeWrap({
      address: wrapperAddress as `0x${string}`,
      abi: SMARTFOLIO_TOKEN_ABI,
      functionName: 'wrap',
      args: [BigInt(parsedWrap)],
    })
  }

  function handleUnwrap() {
    if (!wrapperAddress || parsedUnwrap <= 0) return
    writeUnwrap({
      address: wrapperAddress as `0x${string}`,
      abi: SMARTFOLIO_TOKEN_ABI,
      functionName: 'unwrap',
      args: [BigInt(parsedUnwrap)],
    })
  }

  // ── No factory configured ─────────────────────────────────────────────────
  if (!factoryDeployed) {
    return (
      <div className="card space-y-3">
        <h2 className="text-lg font-bold text-white">Wrap / Unwrap</h2>
        <div className="box-warning">
          Factory not deployed — set{' '}
          <code className="font-mono px-1 rounded" style={{ background: 'rgba(212,175,55,0.15)' }}>
            VITE_FACTORY_ADDRESS
          </code>{' '}
          in your <code className="font-mono" style={{ background: 'rgba(212,175,55,0.15)' }}>.env</code> after deploying{' '}
          <code className="font-mono">SmartfolioTokenFactory</code>.
        </div>
      </div>
    )
  }

  // ── No wrapper for this token ID ──────────────────────────────────────────
  if (!hasWrapper) {
    return (
      <div className="card space-y-3">
        <h2 className="text-lg font-bold text-white">Wrap / Unwrap</h2>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          No ERC20 wrapper deployed for token ID {tokenId}. The owner must call{' '}
          <code className="font-mono">factory.deploy({tokenId}, name, symbol)</code>.
        </p>
      </div>
    )
  }

  // ── Wrapper found ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Token info */}
      <div className="card space-y-3">
        <h2 className="text-lg font-bold text-white">ERC20 Wrapper</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="stat-label">Token</p>
            <p className="font-semibold text-gold">{tokenName ?? '…'} ({tokenSymbol ?? '…'})</p>
          </div>
          <div>
            <p className="stat-label">Total ERC20 Supply</p>
            <p className="font-semibold text-white">
              {erc20TotalSupply !== undefined ? erc20TotalSupply.toString() : '…'}
            </p>
          </div>
          <div>
            <p className="stat-label">Your ERC1155 Balance</p>
            <p className="font-semibold text-white">
              {erc1155Balance !== undefined ? erc1155Balance.toString() : '—'}
            </p>
          </div>
          <div>
            <p className="stat-label">Your ERC20 Balance</p>
            <p className="font-semibold text-white">
              {erc20Balance !== undefined ? erc20Balance.toString() : '—'}
            </p>
          </div>
        </div>
        <p className="text-xs break-all" style={{ color: 'rgba(255,255,255,0.25)' }}>
          {wrapperAddress}
        </p>
      </div>

      {/* Approval */}
      {isConnected && !isApproved && (
        <div className="card space-y-3">
          <h2 className="text-lg font-bold text-white">Step 1 — Approve Wrapper</h2>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Approve the wrapper contract as an ERC1155 operator before wrapping.
          </p>
          <button
            onClick={handleApprove}
            disabled={isApprovePending || isApproveConfirming}
            className="btn-money"
          >
            {isApprovePending
              ? 'Confirm in wallet…'
              : isApproveConfirming
              ? 'Approving…'
              : 'Approve Wrapper'}
          </button>
          {isApproveConfirmed && (
            <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
              Approved! You can now wrap tokens.
            </p>
          )}
        </div>
      )}

      {/* Wrap */}
      <div className="card space-y-4">
        <h2 className="text-lg font-bold text-white">
          {isApproved ? 'Wrap' : 'Step 2 — Wrap'}
        </h2>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Deposit ERC1155 tokens and receive ERC20 1:1.
        </p>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="stat-label">Amount</label>
            {isConnected && erc1155Balance !== undefined && (
              <span className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                ERC1155 balance: {erc1155Balance.toString()}
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              type="number"
              min={1}
              value={wrapAmount}
              onChange={(e) => setWrapAmount(e.target.value)}
              placeholder="0"
              className="input-money pr-20"
            />
            <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
              {tokenSymbol ?? 'tokens'}
            </span>
          </div>
        </div>

        <button
          onClick={handleWrap}
          disabled={!isConnected || parsedWrap <= 0 || !isApproved || isWrapPending || isWrapConfirming}
          className="btn-money"
        >
          {isWrapPending ? 'Confirm in wallet…' : isWrapConfirming ? 'Wrapping…' : 'Wrap'}
        </button>

        {!isApproved && isConnected && (
          <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Approve the wrapper first.</p>
        )}
        {isWrapConfirmed && (
          <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Wrapped! ERC20 tokens received.</p>
        )}
        {wrapError && (
          <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {wrapError.message}</p>
        )}
      </div>

      {/* Unwrap */}
      <div className="card space-y-4">
        <h2 className="text-lg font-bold text-white">Unwrap</h2>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Burn ERC20 tokens and receive ERC1155 1:1.
        </p>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label className="stat-label">Amount</label>
            {isConnected && erc20Balance !== undefined && (
              <span className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                ERC20 balance: {erc20Balance.toString()}
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              type="number"
              min={1}
              value={unwrapAmount}
              onChange={(e) => setUnwrapAmount(e.target.value)}
              placeholder="0"
              className="input-money pr-20"
            />
            <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
              {tokenSymbol ?? 'tokens'}
            </span>
          </div>
        </div>

        <button
          onClick={handleUnwrap}
          disabled={!isConnected || parsedUnwrap <= 0 || isUnwrapPending || isUnwrapConfirming}
          className="btn-money"
        >
          {isUnwrapPending ? 'Confirm in wallet…' : isUnwrapConfirming ? 'Unwrapping…' : 'Unwrap'}
        </button>

        {isUnwrapConfirmed && (
          <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Unwrapped! ERC1155 tokens returned.</p>
        )}
        {unwrapError && (
          <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {unwrapError.message}</p>
        )}
        {!isConnected && (
          <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to unwrap.</p>
        )}
      </div>

    </div>
  )
}
