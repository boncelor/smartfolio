import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { useState } from 'react'
import { formatEther, decodeEventLog } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

export default function MintNewForm() {
  const [open, setOpen] = useState(false)
  const [mintedId, setMintedId] = useState<bigint | null>(null)
  const { isConnected } = useAccount()

  const { data: smfSimulation, error: smfError, isLoading: smfLoading } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [],
  })
  const smfRequired = smfSimulation?.[0]
  const ethNeeded = smfSimulation?.[1]

  const costError = !smfLoading && smfError != null

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (smfRequired === undefined) return
    setMintedId(null)
    writeContract({
      address: SMF_ADDRESS,
      abi: SMF_ABI,
      functionName: 'mintNFT',
      args: [],
    })
  }

  // Parse NFTMinted event to get the assigned token ID
  if (isConfirmed && receipt && mintedId === null) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: SMF_ABI, ...log })
        if (decoded.eventName === 'NFTMinted') {
          setMintedId((decoded.args as { id: bigint }).id)
          break
        }
      } catch { /* not this event */ }
    }
  }

  const isDisabled = !isConnected || smfRequired === undefined || isPending || isConfirming

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
          <p className="text-xs" style={{ color: 'rgba(212,175,55,0.5)' }}>
            A new NFT will be created with an auto-assigned ID. The cost in SMF grows logarithmically
            with the number of NFTs minted and the ratio of locked SMF.
          </p>

          {costError && (
            <p className="text-sm" style={{ color: '#f87171' }}>
              Could not read mint cost — check contract configuration.
            </p>
          )}

          {smfLoading && (
            <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Loading mint cost…</p>
          )}

          {smfRequired !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center justify-between box-info">
                <span className="stat-label" style={{ marginBottom: 0 }}>SMF to burn</span>
                <span className="font-semibold text-gold">{formatEther(smfRequired)} SMF</span>
              </div>
              {ethNeeded !== undefined && ethNeeded > 0n && (
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>ETH locked in reserve</span>
                  <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {formatEther(ethNeeded)} ETH
                  </span>
                </div>
              )}
            </div>
          )}

          <button onClick={handleMint} disabled={isDisabled} className="btn-money">
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Minting…' : 'Mint with SMF'}
          </button>

          {isConfirmed && mintedId !== null && (
            <p className="text-sm font-semibold" style={{ color: '#34d399' }}>
              Minted! NFT #{mintedId.toString()} created.
            </p>
          )}
          {isConfirmed && mintedId === null && (
            <p className="text-sm font-semibold" style={{ color: '#34d399' }}>Minted! Transaction confirmed.</p>
          )}
          {writeError && (
            <p className="text-sm break-all" style={{ color: '#f87171' }}>Error: {writeError.message}</p>
          )}
          {!isConnected && (
            <p className="text-sm" style={{ color: 'rgba(212,175,55,0.5)' }}>Connect your wallet to mint.</p>
          )}
        </>
      )}
    </div>
  )
}
