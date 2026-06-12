import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance } from 'wagmi'
import { useState, useEffect } from 'react'
import { formatEther, decodeEventLog } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

type Phase = 'idle' | 'minting' | 'topping-up' | 'done'

export default function MintNewForm() {
  const [open, setOpen] = useState(false)
  const [extraSmf, setExtraSmf] = useState('')
  const [mintedId, setMintedId] = useState<bigint | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const { isConnected, address } = useAccount()

  const parsedExtra = parseInt(extraSmf) || 0

  // Base mint cost
  const { data: smfSimulation, error: smfError, isLoading: smfLoading } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [],
  })
  const smfRequired = smfSimulation?.[0]
  const ethNeeded = smfSimulation?.[1]

  // SMF balance
  const { data: smfBalance } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address },
  })

  // ETH equivalent of extra SMF (for display)
  const { data: extraEth } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfBurnValue',
    args: [BigInt(parsedExtra)],
    query: { enabled: parsedExtra > 0 },
  })

  // SMF contract ETH balance — addToNFT needs this to cover ethAmount
  const { data: smfContractBalance } = useBalance({ address: SMF_ADDRESS })

  // --- Tx 1: mintNFT ---
  const { writeContract: writeMint, data: mintHash, isPending: mintPending, error: mintError, reset: resetMint } = useWriteContract()
  const { isLoading: mintConfirming, isSuccess: mintConfirmed, data: mintReceipt } = useWaitForTransactionReceipt({ hash: mintHash })

  // Parse NFTMinted event
  useEffect(() => {
    if (!mintConfirmed || !mintReceipt || mintedId !== null) return
    for (const log of mintReceipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SMF_ABI, ...log })
        if (decoded.eventName === 'NFTMinted') {
          setMintedId((decoded.args as { id: bigint }).id)
          break
        }
      } catch { /* not this event */ }
    }
  }, [mintConfirmed, mintReceipt, mintedId])

  // After mint confirmed: if no extra SMF, we're done; otherwise top up
  useEffect(() => {
    if (!mintConfirmed) return
    if (parsedExtra === 0) {
      setPhase('done')
    } else {
      setPhase('topping-up')
    }
  }, [mintConfirmed])

  // --- Tx 2: addToNFT ---
  const { writeContract: writeTopUp, data: topUpHash, isPending: topUpPending, error: topUpError } = useWriteContract()
  const { isLoading: topUpConfirming, isSuccess: topUpConfirmed } = useWaitForTransactionReceipt({ hash: topUpHash })

  useEffect(() => {
    if (phase !== 'topping-up' || mintedId === null || extraEth === undefined || extraEth === 0n) return
    writeTopUp({
      address: SMF_ADDRESS,
      abi: SMF_ABI,
      functionName: 'addToNFT',
      args: [mintedId, extraEth, BigInt(parsedExtra)],
    })
  }, [phase, mintedId])

  useEffect(() => {
    if (topUpConfirmed) setPhase('done')
  }, [topUpConfirmed])

  function handleMint() {
    setMintedId(null)
    setPhase('minting')
    resetMint()
    writeMint({
      address: SMF_ADDRESS,
      abi: SMF_ABI,
      functionName: 'mintNFT',
      args: [],
    })
  }

  function handleReset() {
    setPhase('idle')
    setExtraSmf('')
    setMintedId(null)
    resetMint()
  }

  const totalSmf = smfRequired !== undefined ? smfRequired + BigInt(parsedExtra) : undefined
  const insufficientBalance = smfBalance !== undefined && totalSmf !== undefined && smfBalance < totalSmf
  // addToNFT sends ETH from the SMF contract balance — check it can cover the top-up
  const totalEthNeeded = (ethNeeded ?? 0n) + (extraEth ?? 0n)
  const insufficientContractEth = smfContractBalance !== undefined && parsedExtra > 0
    && smfContractBalance.value < totalEthNeeded
  const costError = !smfLoading && smfError != null

  const isDisabled = !isConnected || smfRequired === undefined || phase !== 'idle' || insufficientBalance || insufficientContractEth

  // Status label
  let statusLabel = 'Mint with SMF'
  if (phase === 'minting' && mintPending) statusLabel = 'Confirm in wallet…'
  else if (phase === 'minting' && mintConfirming) statusLabel = 'Minting…'
  else if (phase === 'topping-up' && topUpPending) statusLabel = 'Confirm top-up in wallet…'
  else if (phase === 'topping-up' && topUpConfirming) statusLabel = 'Topping up…'

  return (
    <div className="card space-y-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-lg font-bold text-white">Mint New NFT</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18" height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
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
              {/* Extra SMF input */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="stat-label">Extra SMF to add to reserve</label>
                  {smfBalance !== undefined && (
                    <span className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                      Balance: {smfBalance.toString()} SMF
                    </span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={extraSmf}
                    onChange={(e) => setExtraSmf(e.target.value)}
                    placeholder="0"
                    className="input-money pr-16"
                  />
                  <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>SMF</span>
                </div>
              </div>

              {/* Cost breakdown */}
              <div className="space-y-2">
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>Mint cost</span>
                  <span className="font-semibold text-gold">{smfRequired.toString()} SMF</span>
                </div>
                {parsedExtra > 0 && (
                  <div className="flex items-center justify-between box-info">
                    <span className="stat-label" style={{ marginBottom: 0 }}>Extra to reserve</span>
                    <span className="font-semibold text-gold">{parsedExtra} SMF</span>
                  </div>
                )}
                <div className="flex items-center justify-between box-info" style={{ borderColor: 'rgba(212,175,55,0.3)' }}>
                  <span className="stat-label" style={{ marginBottom: 0 }}>Total SMF</span>
                  <span className="font-semibold text-gold">{(smfRequired + BigInt(parsedExtra)).toString()} SMF</span>
                </div>
                {ethNeeded !== undefined && ethNeeded > 0n && (
                  <div className="flex items-center justify-between box-info">
                    <span className="stat-label" style={{ marginBottom: 0 }}>ETH locked in reserve</span>
                    <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {formatEther(ethNeeded + (extraEth ?? 0n))} ETH
                    </span>
                  </div>
                )}
              </div>

              {insufficientBalance && (
                <p className="text-xs" style={{ color: '#f87171' }}>
                  Insufficient SMF balance ({smfBalance?.toString()} available, {(smfRequired + BigInt(parsedExtra)).toString()} needed)
                </p>
              )}

              {insufficientContractEth && smfContractBalance !== undefined && (
                <p className="text-xs" style={{ color: '#f87171' }}>
                  The SMF contract only holds {formatEther(smfContractBalance.value)} ETH — reduce the extra SMF or buy more SMF into the pool first.
                </p>
              )}

              {parsedExtra > 0 && (
                <p className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
                  This will require 2 wallet confirmations — one to mint, one to top up the reserve.
                </p>
              )}
            </>
          )}

          {/* Progress during mint */}
          {phase !== 'idle' && phase !== 'done' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span style={{ color: mintConfirmed ? '#34d399' : 'rgba(212,175,55,0.8)' }}>
                  {mintConfirmed ? '✓' : '○'} Step 1: Mint NFT
                </span>
              </div>
              {parsedExtra > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span style={{ color: topUpConfirmed ? '#34d399' : 'rgba(255,255,255,0.3)' }}>
                    {topUpConfirmed ? '✓' : '○'} Step 2: Add {parsedExtra} SMF to reserve
                  </span>
                </div>
              )}
            </div>
          )}

          {phase === 'idle' && (
            <button onClick={handleMint} disabled={isDisabled} className="btn-money">
              {statusLabel}
            </button>
          )}

          {phase !== 'idle' && phase !== 'done' && (
            <button disabled className="btn-money">
              {statusLabel}
            </button>
          )}

          {phase === 'done' && mintedId !== null && (
            <>
              <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
                NFT #{mintedId.toString()} minted{parsedExtra > 0 ? ' and topped up' : ''} successfully.
              </p>
              <button onClick={handleReset} className="btn-money" style={{ opacity: 0.7 }}>
                Mint another
              </button>
            </>
          )}

          {(mintError || topUpError) && (
            <p className="text-sm break-all" style={{ color: '#f87171' }}>
              Error: {(mintError || topUpError)?.message}
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
