import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { SMF_ADDRESS, SMF_ABI } from '../contracts'

export default function MintNewForm() {
  const [open, setOpen] = useState(false)
  const [tokenId, setTokenId] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const { isConnected } = useAccount()

  const parsedId = parseInt(tokenId) || 0
  const isValid = parsedId > 0

  const { data: smfSimulation } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [BigInt(parsedId)],
    query: { enabled: isValid },
  })
  const smfRequired = smfSimulation?.[0]
  const ethNeeded = smfSimulation?.[1]

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!isValid || smfRequired === undefined) return
    const slippage = 1 + (parseFloat(slippagePct) || 1) / 100
    const maxBurn = BigInt(Math.ceil(Number(smfRequired) * slippage))
    writeContract({
      address: SMF_ADDRESS,
      abi: SMF_ABI,
      functionName: 'mintNFT',
      args: [BigInt(parsedId), maxBurn],
    })
  }

  const isDisabled = !isConnected || !isValid || smfRequired === undefined || isPending || isConfirming

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
          <div className="space-y-1">
            <label className="stat-label">Token ID</label>
            <input
              type="number"
              min={1}
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              placeholder="e.g. 42"
              className="input-money"
              style={{ width: '8rem' }}
            />
          </div>

          <div className="space-y-1">
            <label className="stat-label">Slippage tolerance</label>
            <div className="relative flex items-center" style={{ maxWidth: '8rem' }}>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={slippagePct}
                onChange={(e) => setSlippagePct(e.target.value)}
                className="input-money pr-8"
              />
              <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>%</span>
            </div>
          </div>

          {smfRequired !== undefined && isValid && (
            <div className="space-y-2">
              <div className="flex items-center justify-between box-info">
                <span className="stat-label" style={{ marginBottom: 0 }}>SMF to burn</span>
                <span className="font-semibold text-gold">{smfRequired.toString()} SMF</span>
              </div>
              {ethNeeded !== undefined && (
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

          {isConfirmed && (
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
