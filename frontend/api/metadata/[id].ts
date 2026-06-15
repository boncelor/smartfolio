import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, formatEther } from 'viem'
import { sepolia } from 'viem/chains'
import { selectRenderer } from './renderers/selectRenderer.js'
import type { RenderContext, AssetBar, Holding } from './renderers/types.js'

const CONTRACT_ADDRESS = process.env.VITE_CONTRACT_ADDRESS as `0x${string}`

// -------------------------------------------------------------------------
// ABIs
// -------------------------------------------------------------------------

const SMARTFOLIO_ABI = [
  {
    name: 'tokenInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'circulatingSupply', type: 'uint256' },
        { name: 'totalMinted',       type: 'uint256' },
        { name: 'reserve',           type: 'uint256' },
        { name: 'backingPerToken',   type: 'uint256' },
        { name: 'currentTierIndex',  type: 'uint256' },
        { name: 'currentPrice',      type: 'uint256' },
      ],
    }],
  },
  {
    name: 'portfolioActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'portfolioSMFHoldings',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getPortfolioConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple[]',
      components: [
        { name: 'assetType',    type: 'uint8' },
        { name: 'token',        type: 'address' },
        { name: 'weightBps',    type: 'uint16' },
        { name: 'poolFee',      type: 'uint24' },
        { name: 'swapFee',      type: 'uint24' },
        { name: 'tickLower',    type: 'int24' },
        { name: 'tickUpper',    type: 'int24' },
        { name: 'swapPath',     type: 'bytes' },
        { name: 'sellSwapPath', type: 'bytes' },
      ],
    }],
  },
  {
    name: 'portfolioHoldings',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'id',    type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'portfolioAaveWeth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const ERC20_SYMBOL_ABI = [{
  name: 'symbol',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'string' }],
}] as const

// -------------------------------------------------------------------------
// Asset type config
// -------------------------------------------------------------------------

const ASSET_COLORS: Record<number, string> = {
  3: '#d4af37',  // SMF     — gold
  0: '#34d399',  // ERC20   — green
  1: '#60a5fa',  // AAVE    — blue
  2: '#2dd4bf',  // LP      — teal
  5: '#94a3b8',  // ETH     — silver
  4: '#a78bfa',  // STAKING — purple
}

const ASSET_TYPE_LABELS: Record<number, string> = {
  3: 'SMF',
  1: 'AAVE',
  2: 'LP',
  5: 'ETH',
  4: 'STAKING',
}

// -------------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query
  const tokenId = parseInt(id as string)

  if (isNaN(tokenId) || tokenId < 1) {
    return res.status(400).json({ error: 'Invalid token ID' })
  }

  try {
    const rpcUrl = process.env.ALCHEMY_API_KEY
      ? `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : undefined

    const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
    const bid = BigInt(tokenId)

    // Fetch core data in parallel
    const [info, active, smfHoldingsRaw, configRaw, aaveWethRaw] = await Promise.all([
      client.readContract({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'tokenInfo',            args: [bid] }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioActive',      args: [bid] }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioSMFHoldings', args: [bid] }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'getPortfolioConfig',   args: [bid] }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: SMARTFOLIO_ABI, functionName: 'portfolioAaveWeth',    args: [bid] }),
    ])

    const config = configRaw as readonly { assetType: number; token: string; weightBps: number }[]

    // ERC20 assets need symbol lookups + holdings
    const erc20Assets = config.filter(a => a.assetType === 0)

    const [symbols, erc20HoldingsArr] = await Promise.all([
      Promise.all(
        erc20Assets.map(a =>
          client.readContract({
            address: a.token as `0x${string}`,
            abi: ERC20_SYMBOL_ABI,
            functionName: 'symbol',
          }).catch(() => a.token.slice(0, 6))
        )
      ),
      Promise.all(
        erc20Assets.map(a =>
          client.readContract({
            address: CONTRACT_ADDRESS,
            abi: SMARTFOLIO_ABI,
            functionName: 'portfolioHoldings',
            args: [bid, a.token as `0x${string}`],
          }).catch(() => 0n)
        )
      ),
    ])

    const symbolMap: Record<string, string> = Object.fromEntries(erc20Assets.map((a, i) => [a.token.toLowerCase(), symbols[i] as string]))
    const holdMap:   Record<string, bigint> = Object.fromEntries(erc20Assets.map((a, i) => [a.token.toLowerCase(), erc20HoldingsArr[i] as bigint]))

    // ---- Build allocation bars (config order) ----
    const bars: AssetBar[] = config.map(asset => ({
      label: asset.assetType === 0
        ? (symbolMap[asset.token.toLowerCase()] ?? asset.token.slice(0, 6))
        : (ASSET_TYPE_LABELS[asset.assetType] ?? `Type${asset.assetType}`),
      weightBps: asset.weightBps,
      color: ASSET_COLORS[asset.assetType] ?? '#ffffff',
    }))

    // ---- Build holdings list (SMF first, ETH second, then others) ----
    const smfAmount    = parseFloat(formatEther(smfHoldingsRaw as bigint))
    const reserveAmt   = parseFloat(formatEther(info.reserve))
    const aaveAmt      = parseFloat(formatEther(aaveWethRaw as bigint))

    const holdings: Holding[] = []

    if (smfAmount > 0) {
      holdings.push({
        label: 'SMF',
        value: smfAmount.toLocaleString('en', { maximumFractionDigits: 2 }) + ' SMF',
        color: '#d4af37',
      })
    }
    if (reserveAmt > 0) {
      holdings.push({
        label: 'ETH RESERVE',
        value: reserveAmt.toFixed(4) + ' ETH',
        color: '#94a3b8',
      })
    }
    if (aaveAmt > 0) {
      holdings.push({
        label: 'AAVE WETH',
        value: aaveAmt.toFixed(4) + ' WETH',
        color: '#60a5fa',
      })
    }
    for (const asset of erc20Assets) {
      const holding = holdMap[asset.token.toLowerCase()] ?? 0n
      if (holding > 0n) {
        const sym = symbolMap[asset.token.toLowerCase()] ?? 'ERC20'
        holdings.push({
          label: sym,
          value: parseFloat(formatEther(holding)).toLocaleString('en', { maximumFractionDigits: 4 }),
          color: '#34d399',
        })
      }
    }

    // ---- Select renderer and generate SVG ----
    const ctx: RenderContext = {
      tokenId,
      active: active as boolean,
      smfAmount,
      bars,
      holdings,
    }

    const renderer = selectRenderer(active as boolean, smfAmount)
    const svg      = renderer.render(ctx)
    const imageUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

    // ---- Metadata ----
    const smfPct = config.find(a => a.assetType === 3)?.weightBps ?? 0

    const metadata = {
      name: `Smartfolio #${tokenId}`,
      description: `A Smartfolio portfolio NFT. SMF: ${smfAmount.toLocaleString('en', { maximumFractionDigits: 2 })} SMF. Reserve: ${reserveAmt.toFixed(4)} ETH.`,
      image: imageUri,
      attributes: [
        { trait_type: 'Style',              value: renderer.styleName },
        { trait_type: 'Status',             value: active ? 'Portfolio Active' : 'Reserve Mode' },
        { trait_type: 'SMF Holdings',       value: smfAmount.toLocaleString('en', { maximumFractionDigits: 2 }) },
        { trait_type: 'ETH Reserve',        value: reserveAmt.toFixed(4) },
        { trait_type: 'SMF Weight',         value: `${(smfPct / 100).toFixed(0)}%` },
        { trait_type: 'Asset Count',        value: config.length },
        { trait_type: 'Circulating Supply', value: info.circulatingSupply.toString() },
      ],
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json(metadata)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(err)
    return res.status(500).json({ error: msg })
  }
}
