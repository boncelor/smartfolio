import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { useState, useEffect } from 'react'
import { decodeEventLog, parseUnits, formatEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

type Phase = 'idle' | 'approving' | 'minting' | 'approving-top' | 'topping-up' | 'done'

export default function MintNewForm() {
  const [open, setOpen] = useState(false)
  const [extraSmf, setExtraSmf] = useState('')
  const [mintedId, setMintedId] = useState<bigint | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const { isConnected, address } = useAccount()

  // Parse extra SMF as 18-decimal units for contract calls; raw number for display/logic
  const parsedExtraUnits = extraSmf && !isNaN(Number(extraSmf)) && Number(extraSmf) > 0
    ? parseUnits(extraSmf, 18)
    : 0n
  const hasExtra = parsedExtraUnits > 0n

  // Base mint cost (single uint256 now)
  const { data: smfRequired, error: smfError, isLoading: smfLoading } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [],
  })

  // SMF balance
  const { data: smfBalance } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address },
  })

  const totalSmf = smfRequired !== undefined ? smfRequired + parsedExtraUnits : undefined
  const insufficientBalance = smfBalance !== undefined && totalSmf !== undefined && smfBalance < totalSmf
  const costError = !smfLoading && smfError != null

  // --- Tx 1: approve mintCost ---
  const { writeContract: writeApprove, data: approveHash, isPending: approvePending, error: approveError, reset: resetApprove } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash })

  // --- Tx 2: mintNFT ---
  const { writeContract: writeMint, data: mintHash, isPending: mintPending, error: mintError, reset: resetMint } = useWriteContract()
  const { isLoading: mintConfirming, isSuccess: mintConfirmed, data: mintReceipt } = useWaitForTransactionReceipt({ hash: mintHash })

  // --- Tx 3: approve extra SMF ---
  const { writeContract: writeApproveTop, data: approveTopHash, isPending: approveTopPending, error: approveTopError } = useWriteContract()
  const { isLoading: approveTopConfirming, isSuccess: approveTopConfirmed } = useWaitForTransactionReceipt({ hash: approveTopHash })

  // --- Tx 4: addSMFToNFT ---
  const { writeContract: writeTopUp, data: topUpHash, isPending: topUpPending, error: topUpError } = useWriteContract()
  const { isLoading: topUpConfirming, isSuccess: topUpConfirmed } = useWaitForTransactionReceipt({ hash: topUpHash })

  // Step machine
  useEffect(() => {
    if (phase === 'approving' && approveConfirmed && smfRequired !== undefined) {
      setPhase('minting')
      writeMint({ address: SMF_ADDRESS, abi: SMF_ABI, functionName: 'mintNFT', args: [] })
    }
  }, [phase, approveConfirmed])

  useEffect(() => {
    if (!mintConfirmed || !mintReceipt) return
    // Parse NFTMinted event
    for (const log of mintReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SMF_ABI, ...log })
        if (decoded.eventName === 'NFTMinted') {
          setMintedId((decoded.args as { id: bigint }).id)
          break
        }
      } catch { /* not this event */ }
    }
    if (hasExtra) {
      setPhase('approving-top')
    } else {
      setPhase('done')
    }
  }, [mintConfirmed, mintReceipt])

  useEffect(() => {
    if (phase === 'approving-top' && mintedId !== null) {
      writeApproveTop({
        address: SMF_ADDRESS, abi: SMF_ABI, functionName: 'approve',
        args: [SMF_ADDRESS, parsedExtraUnits],
      })
    }
  }, [phase, mintedId])

  useEffect(() => {
    if (phase === 'approving-top' && approveTopConfirmed && mintedId !== null) {
      setPhase('topping-up')
      writeTopUp({
        address: SMF_ADDRESS, abi: SMF_ABI, functionName: 'addSMFToNFT',
        args: [mintedId, parsedExtraUnits],
      })
    }
  }, [phase, approveTopConfirmed])

  useEffect(() => {
    if (topUpConfirmed) setPhase('done')
  }, [topUpConfirmed])

  function handleMint() {
    if (!smfRequired) return
    setMintedId(null)
    setPhase('approving')
    resetApprove()
    resetMint()
    writeApprove({
      address: SMF_ADDRESS, abi: SMF_ABI, functionName: 'approve',
      args: [SMF_ADDRESS, smfRequired],
    })
  }

  function handleReset() {
    setPhase('idle')
    setExtraSmf('')
    setMintedId(null)
    resetApprove()
    resetMint()
  }

  const isDisabled = !isConnected || smfRequired === undefined || phase !== 'idle' || insufficientBalance

  function stepLabel(): string {
    if (phase === 'approving' && approvePending) return 'Confirm approval in wallet…'
    if (phase === 'approving' && approveConfirming) return 'Approving…'
    if (phase === 'minting' && mintPending) return 'Confirm mint in wallet…'
    if (phase === 'minting' && mintConfirming) return 'Minting…'
    if (phase === 'approving-top' && approveTopPending) return 'Confirm approval…'
    if (phase === 'approving-top' && approveTopConfirming) return 'Approving…'
    if (phase === 'topping-up' && topUpPending) return 'Confirm top-up in wallet…'
    if (phase === 'topping-up' && topUpConfirming) return 'Adding SMF…'
    return 'Mint with SMF'
  }

  const anyError = approveError || mintError || approveTopError || topUpError

  const txCount = hasExtra ? 4 : 2

  return (
    <div className="card space-y-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-lg font-bold text-white">Mint New NFT</span>
        <svg
          xmlns="http://www.w3.org/2000/svg" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            color: 'rgba(212,175,55,0.5)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <>
          {costError && (
            <p className="text-sm" style={{ color: '#f87171' }}>
              Could not read mint cost — check contract configuration.
            </p>
          )}
          {smfLoading && (
            <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading mint cost…</p>
          )}

          {smfRequired !== undefined && phase === 'idle' && (
            <>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="stat-label">Extra SMF to add to portfolio</label>
                  {smfBalance !== undefined && (
                    <span className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                      Balance: {parseFloat(formatEther(smfBalance as bigint)).toLocaleString(undefined, { maximumFractionDigits: 2 })} SMF
                    </span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="number" min={0} step={1}
                    value={extraSmf}
                    onChange={(e) => setExtraSmf(e.target.value)}
                    placeholder="0"
                    className="input-money pr-16"
                  />
                  <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>SMF</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>Mint cost</span>
                  <span className="font-semibold text-gold">{parseFloat(formatEther(smfRequired as bigint)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SMF</span>
                </div>
                {hasExtra && (
                  <div className="flex items-center justify-between box-info">
                    <span className="stat-label" style={{ marginBottom: 0 }}>Extra to portfolio</span>
                    <span className="font-semibold text-gold">{extraSmf} SMF</span>
                  </div>
                )}
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>Total SMF</span>
                  <span className="font-semibold text-gold">{parseFloat(formatEther((smfRequired as bigint) + parsedExtraUnits)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SMF</span>
                </div>
              </div>

              <p className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                SMF is transferred directly into the NFT — no ETH conversion until the keeper deploys. Requires {txCount} wallet confirmations.
              </p>

              {insufficientBalance && (
                <p className="text-xs" style={{ color: '#f87171' }}>
                  Insufficient balance ({parseFloat(formatEther(smfBalance as bigint)).toLocaleString(undefined, { maximumFractionDigits: 2 })} available, {parseFloat(formatEther(totalSmf as bigint)).toLocaleString(undefined, { maximumFractionDigits: 4 })} needed)
                </p>
              )}
            </>
          )}

          {/* Step progress */}
          {phase !== 'idle' && phase !== 'done' && (
            <div className="space-y-1">
              {[
                { label: 'Approve mint cost', done: ['minting','approving-top','topping-up','done'].includes(phase) },
                { label: 'Mint NFT', done: ['approving-top','topping-up','done'].includes(phase) },
                ...(hasExtra ? [
                  { label: `Approve ${extraSmf} extra SMF`, done: ['topping-up','done'].includes(phase) },
                  { label: 'Add SMF to portfolio', done: ['done'].includes(phase) },
                ] : []),
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span style={{ color: step.done ? '#34d399' : 'rgba(212,175,55,0.8)' }}>
                    {step.done ? '✓' : '○'} {step.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {phase === 'idle' && (
            <button onClick={handleMint} disabled={isDisabled} className="btn-money">
              Mint with SMF
            </button>
          )}

          {phase !== 'idle' && phase !== 'done' && (
            <button disabled className="btn-money">{stepLabel()}</button>
          )}

          {phase === 'done' && mintedId !== null && (
            <>
              <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
                NFT #{mintedId.toString()} minted{hasExtra ? ` with ${parseFloat(formatEther((smfRequired ?? 0n) + parsedExtraUnits)).toLocaleString(undefined, { maximumFractionDigits: 4 })} SMF` : ''}.
              </p>
              <button onClick={handleReset} className="btn-money" style={{ opacity: 0.7 }}>
                Mint another
              </button>
            </>
          )}

          {anyError && (
            <p className="text-sm break-all" style={{ color: '#f87171' }}>
              Error: {anyError.message}
            </p>
          )}
          {!isConnected && (
            <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to mint.</p>
          )}
        </>
      )}
    </div>
  )
}
