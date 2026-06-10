import { useState } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { CONTRACT_ADDRESS, SMARTFOLIO_ABI, SMF_ADDRESS, SMF_ABI } from '../contracts'

type PayWith = 'eth' | 'smf'

export default function MintNewForm() {
  const [open, setOpen] = useState(false)
  const [tokenId, setTokenId] = useState('')
  const [amount, setAmount] = useState('')
  const [payWith, setPayWith] = useState<PayWith>('eth')
  const [slippagePct, setSlippagePct] = useState('1')
  const { address, isConnected } = useAccount()

  const parsedId = parseInt(tokenId) || 0
  const parsedAmount = parseInt(amount) || 0
  const isValid = parsedId > 0 && parsedAmount > 0

  // ETH path
  const { data: ethCost } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: SMARTFOLIO_ABI,
    functionName: 'mintCost',
    args: [BigInt(parsedAmount)],
    query: { enabled: isValid },
  })

  // SMF path
  const { data: smfSimulation } = useReadContract({
    address: SMF_ADDRESS,
    abi: SMF_ABI,
    functionName: 'smfForNFT',
    args: [BigInt(parsedId), BigInt(parsedAmount)],
    query: { enabled: isValid && payWith === 'smf' },
  })
  const smfRequired = smfSimulation?.[0]
  const smfFee = smfSimulation?.[1]

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!address || !isValid) return

    if (payWith === 'eth' && ethCost !== undefined) {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'mint',
        args: [address, BigInt(parsedId), BigInt(parsedAmount), '0x'],
        value: ethCost,
      })
    }

    if (payWith === 'smf' && smfRequired !== undefined) {
      const slippage = 1 + (parseFloat(slippagePct) || 1) / 100
      const maxBurn = BigInt(Math.ceil(Number(smfRequired) * slippage))
      writeContract({
        address: SMF_ADDRESS,
        abi: SMF_ABI,
        functionName: 'mintNFT',
        args: [BigInt(parsedId), BigInt(parsedAmount), maxBurn],
      })
    }
  }

  const isDisabled = !isConnected || !isValid || isPending || isConfirming || (
    payWith === 'eth' ? ethCost === undefined :
    smfRequired === undefined
  )

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
          {/* Pay with toggle */}
          <div className="flex gap-2">
            {(['eth', 'smf'] as PayWith[]).map((p) => (
              <button
                key={p}
                onClick={() => setPayWith(p)}
                className={`px-4 py-2 text-sm font-semibold rounded transition-colors ${
                  payWith === p ? 'tab-active-gold-pill' : 'tab-inactive'
                }`}
              >
                Pay with {p.toUpperCase()}
              </button>
            ))}
          </div>

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
            <label className="stat-label">Amount</label>
            <div className="relative flex items-center">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="input-money pr-16"
              />
              <span className="absolute right-3 text-sm pointer-events-none" style={{ color: 'rgba(212,175,55,0.5)' }}>
                tokens
              </span>
            </div>
          </div>

          {/* Slippage for SMF path */}
          {payWith === 'smf' && (
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
          )}

          {/* Cost preview */}
          <div className="space-y-2">
            {payWith === 'eth' && (
              <div className="flex items-center justify-between box-info">
                <span className="stat-label" style={{ marginBottom: 0 }}>Cost</span>
                <span className="font-semibold text-gold">
                  {ethCost !== undefined && isValid ? formatEther(ethCost) + ' ETH' : '—'}
                </span>
              </div>
            )}
            {payWith === 'smf' && smfRequired !== undefined && isValid && (
              <>
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>SMF to burn</span>
                  <span className="font-semibold text-gold">{smfRequired.toString()} SMF</span>
                </div>
                <div className="flex items-center justify-between box-info">
                  <span className="stat-label" style={{ marginBottom: 0 }}>Conversion fee</span>
                  <span className="font-semibold" style={{ color: '#f87171' }}>
                    {smfFee !== undefined ? formatEther(smfFee) + ' ETH' : '—'}
                  </span>
                </div>
              </>
            )}
          </div>

          <button onClick={handleMint} disabled={isDisabled} className="btn-money">
            {isPending ? 'Confirm in wallet…' : isConfirming ? 'Minting…' : 'Mint'}
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
