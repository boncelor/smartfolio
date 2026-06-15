import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, formatEther } from 'viem'
import { sepolia } from 'viem/chains'

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
  3: '#d4af37',  // SMF    — gold
  0: '#34d399',  // ERC20  — green
  1: '#60a5fa',  // AAVE   — blue
  2: '#2dd4bf',  // LP     — teal
  5: '#94a3b8',  // ETH    — silver
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
// SVG builder
// -------------------------------------------------------------------------

interface AssetBar {
  label: string
  weightBps: number
  color: string
}

interface Holding {
  label: string
  value: string
  color: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildSvg(
  id: number,
  active: boolean,
  bars: AssetBar[],
  holdings: Holding[],
): string {
  const statusColor = active ? '#34d399' : '#d4af37'
  const statusLabel = active ? 'Portfolio Active' : 'Reserve Mode'
  const statusBadgeW = active ? 140 : 118

  // Layout constants
  const LEFT  = 40
  const RIGHT = 460
  const W     = 500
  const BAR_X = 135       // bar start
  const BAR_W = 240       // bar track width
  const BAR_H = 18        // bar height
  const BAR_ROW = 40      // vertical pitch per bar row
  const PCT_X = 388       // percentage label x (right-aligned)

  // Section heights
  const headerH    = 172
  const allocH     = 28 + bars.length * BAR_ROW + 16
  const sep1H      = 28
  const holdH      = 28 + Math.ceil(holdings.length / 2) * 40 + 10
  const footerH    = 48
  const totalH     = Math.max(headerH + allocH + sep1H + holdH + footerH, 520)

  // Y anchors
  const yTopLine   = 42
  const yTitle     = 68       // "SMARTFOLIO" label
  const yId        = 116      // "#27"
  const yBadge     = 142      // status badge top
  const yDiv1      = 170      // first divider
  const yAllocLbl  = yDiv1 + 22
  const yBarsStart = yAllocLbl + 16
  const yDiv2      = yBarsStart + bars.length * BAR_ROW + 10
  const yHoldLbl   = yDiv2 + 24
  const yHoldStart = yHoldLbl + 20
  const yBottomLine = totalH - 38

  // ---- Bars ----
  const barsSvg = bars.map((bar, i) => {
    const by     = yBarsStart + i * BAR_ROW
    const fillW  = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct    = (bar.weightBps / 100).toFixed(0) + '%'
    const label  = esc(bar.label)
    const color  = bar.color
    return `
  <text x="${LEFT}" y="${by + 14}" font-family="sans-serif" font-size="11.5"
    fill="${color}" font-weight="700" letter-spacing="0.5">${label}</text>
  <rect x="${BAR_X}" y="${by + 1}" width="${BAR_W}" height="${BAR_H}" rx="4"
    fill="${color}" fill-opacity="0.08"/>
  <rect x="${BAR_X}" y="${by + 1}" width="${fillW}" height="${BAR_H}" rx="4"
    fill="${color}" fill-opacity="0.65"/>
  <text x="${PCT_X}" y="${by + 14}" font-family="sans-serif" font-size="11.5"
    fill="${color}" fill-opacity="0.9" font-weight="700" text-anchor="end">${pct}</text>`
  }).join('')

  // ---- Holdings (2-column grid) ----
  const holdSvg = holdings.map((h, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${h.color}" fill-opacity="0.55" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="#f3e5ab" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#12110a"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#d4af37" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#d4af37" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <rect width="${W}" height="${totalH}" fill="url(#shine)" rx="24"/>

  <!-- Border -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="#d4af37" stroke-opacity="0.3" stroke-width="1.5"/>

  <!-- Top accent line -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="1.5" rx="1"
    fill="#d4af37" fill-opacity="0.45"/>

  <!-- Title -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="3" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="#f3e5ab" font-weight="bold">#${id}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="11"
    fill="${statusColor}" fill-opacity="0.12"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="4"
    fill="${statusColor}" fill-opacity="0.9"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="#d4af37" stroke-opacity="0.15" stroke-width="1"/>

  <!-- Allocation label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="#d4af37" fill-opacity="0.45" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="#d4af37" stroke-opacity="0.12" stroke-width="1"/>

  <!-- Holdings label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="#d4af37" fill-opacity="0.45" letter-spacing="2.5" font-weight="600">HOLDINGS</text>

  ${holdSvg}

  <!-- Bottom accent -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1" rx="0.5"
    fill="#d4af37" fill-opacity="0.2"/>
</svg>`
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

    const symbolMap: Record<string, string>  = Object.fromEntries(erc20Assets.map((a, i) => [a.token.toLowerCase(), symbols[i] as string]))
    const holdMap:   Record<string, bigint>  = Object.fromEntries(erc20Assets.map((a, i) => [a.token.toLowerCase(), erc20HoldingsArr[i] as bigint]))

    // ---- Build allocation bars (config order) ----
    const bars: AssetBar[] = config.map(asset => {
      const label = asset.assetType === 0
        ? (symbolMap[asset.token.toLowerCase()] ?? asset.token.slice(0, 6))
        : (ASSET_TYPE_LABELS[asset.assetType] ?? `Type${asset.assetType}`)
      return {
        label,
        weightBps: asset.weightBps,
        color: ASSET_COLORS[asset.assetType] ?? '#ffffff',
      }
    })

    // ---- Build holdings list (SMF first, ETH second, then others) ----
    const smfAmt   = parseFloat(formatEther(smfHoldingsRaw as bigint))
    const reserveAmt = parseFloat(formatEther(info.reserve))
    const aaveAmt  = parseFloat(formatEther(aaveWethRaw as bigint))

    const holdings: Holding[] = []

    if (smfAmt > 0) {
      holdings.push({
        label: 'SMF',
        value: smfAmt.toLocaleString('en', { maximumFractionDigits: 2 }) + ' SMF',
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

    // ---- Generate SVG ----
    const svg      = buildSvg(tokenId, active as boolean, bars, holdings)
    const imageUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

    // ---- Metadata ----
    const smfPct = config.find(a => a.assetType === 3)?.weightBps ?? 0

    const metadata = {
      name: `Smartfolio #${tokenId}`,
      description: `A Smartfolio portfolio NFT. SMF: ${smfAmt.toLocaleString('en', { maximumFractionDigits: 2 })} SMF. Reserve: ${reserveAmt.toFixed(4)} ETH.`,
      image: imageUri,
      attributes: [
        { trait_type: 'Status',             value: active ? 'Portfolio Active' : 'Reserve Mode' },
        { trait_type: 'SMF Holdings',       value: smfAmt.toLocaleString('en', { maximumFractionDigits: 2 }) },
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
