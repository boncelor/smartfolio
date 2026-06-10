import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createPublicClient, http, formatEther } from 'viem'
import { sepolia } from 'viem/chains'

const CONTRACT_ADDRESS = process.env.VITE_CONTRACT_ADDRESS as `0x${string}`
const ALCHEMY_API_KEY  = process.env.ALCHEMY_API_KEY as string

const SMARTFOLIO_ABI = [
  {
    name: 'tokenInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'circulatingSupply', type: 'uint256' },
          { name: 'totalMinted',       type: 'uint256' },
          { name: 'reserve',           type: 'uint256' },
          { name: 'backingPerToken',   type: 'uint256' },
          { name: 'currentTierIndex',  type: 'uint256' },
          { name: 'currentPrice',      type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'portfolioActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

function buildSvg(
  id: number,
  supply: string,
  reserve: string,
  backing: string,
  tier: string,
  price: string,
  active: boolean,
): string {
  const statusColor = active ? '#34d399' : '#d4af37'
  const statusLabel = active ? 'Portfolio Active' : 'Reserve Mode'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#12110a"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#d4af37" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#d4af37" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="500" height="500" fill="url(#bg)" rx="24"/>
  <rect width="500" height="500" fill="url(#shine)" rx="24"/>

  <!-- Border -->
  <rect x="1" y="1" width="498" height="498" rx="23" fill="none"
    stroke="#d4af37" stroke-opacity="0.3" stroke-width="1.5"/>

  <!-- Top accent line -->
  <rect x="40" y="40" width="420" height="2" rx="1" fill="#d4af37" fill-opacity="0.5"/>

  <!-- Title -->
  <text x="40" y="90" font-family="Georgia, serif" font-size="13"
    fill="#d4af37" fill-opacity="0.6" letter-spacing="3">SMARTFOLIO</text>
  <text x="40" y="130" font-family="Georgia, serif" font-size="40"
    fill="#f3e5ab" font-weight="bold">#${id}</text>

  <!-- Status badge -->
  <rect x="40" y="148" width="${active ? 138 : 112}" height="24" rx="12"
    fill="${statusColor}" fill-opacity="0.15"/>
  <circle cx="56" cy="160" r="4" fill="${statusColor}"/>
  <text x="66" y="165" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider -->
  <line x1="40" y1="200" x2="460" y2="200" stroke="#d4af37" stroke-opacity="0.15" stroke-width="1"/>

  <!-- Stats grid -->
  <!-- Reserve -->
  <text x="40" y="235" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="1">RESERVE</text>
  <text x="40" y="268" font-family="Georgia, serif" font-size="26"
    fill="#f3e5ab" font-weight="bold">${reserve}</text>
  <text x="${40 + reserve.length * 16 + 4}" y="268" font-family="sans-serif" font-size="13"
    fill="#d4af37" fill-opacity="0.6">ETH</text>

  <!-- Backing per token -->
  <text x="40" y="315" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="1">BACKING / TOKEN</text>
  <text x="40" y="348" font-family="Georgia, serif" font-size="26"
    fill="#f3e5ab" font-weight="bold">${backing}</text>
  <text x="${40 + backing.length * 16 + 4}" y="348" font-family="sans-serif" font-size="13"
    fill="#d4af37" fill-opacity="0.6">ETH</text>

  <!-- Bottom row -->
  <line x1="40" y1="380" x2="460" y2="380" stroke="#d4af37" stroke-opacity="0.15" stroke-width="1"/>

  <!-- Supply -->
  <text x="40" y="412" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="1">SUPPLY</text>
  <text x="40" y="440" font-family="Georgia, serif" font-size="20"
    fill="#ffffff" fill-opacity="0.8">${supply}</text>

  <!-- Tier -->
  <text x="200" y="412" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="1">TIER</text>
  <text x="200" y="440" font-family="Georgia, serif" font-size="20"
    fill="#ffffff" fill-opacity="0.8">${tier}</text>

  <!-- Next price -->
  <text x="320" y="412" font-family="sans-serif" font-size="11"
    fill="#d4af37" fill-opacity="0.5" letter-spacing="1">NEXT PRICE</text>
  <text x="320" y="440" font-family="Georgia, serif" font-size="20"
    fill="#ffffff" fill-opacity="0.8">${price} ETH</text>

  <!-- Bottom accent -->
  <rect x="40" y="460" width="420" height="1" rx="0.5" fill="#d4af37" fill-opacity="0.2"/>
</svg>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query
  const tokenId = parseInt(id as string)

  if (isNaN(tokenId) || tokenId < 1) {
    return res.status(400).json({ error: 'Invalid token ID' })
  }

  try {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(`https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`),
    })

    const [info, active] = await Promise.all([
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'tokenInfo',
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: SMARTFOLIO_ABI,
        functionName: 'portfolioActive',
        args: [BigInt(tokenId)],
      }),
    ])

    const reserve  = parseFloat(formatEther(info.reserve)).toFixed(4)
    const backing  = parseFloat(formatEther(info.backingPerToken)).toFixed(6)
    const supply   = info.circulatingSupply.toString()
    const tier     = info.currentTierIndex.toString()
    const price    = parseFloat(formatEther(info.currentPrice)).toFixed(4)

    const svg = buildSvg(tokenId, supply, reserve, backing, tier, price, active)
    const svgBase64 = Buffer.from(svg).toString('base64')
    const imageUri = `data:image/svg+xml;base64,${svgBase64}`

    const metadata = {
      name: `Smartfolio #${tokenId}`,
      description: `A Smartfolio ERC1155 token. Reserve: ${reserve} ETH. Backing per token: ${backing} ETH.`,
      image: imageUri,
      attributes: [
        { trait_type: 'Reserve (ETH)',        value: reserve },
        { trait_type: 'Backing per Token',    value: backing },
        { trait_type: 'Circulating Supply',   value: supply  },
        { trait_type: 'Tier',                 value: tier    },
        { trait_type: 'Next Mint Price',      value: price   },
        { trait_type: 'Status', value: active ? 'Portfolio Active' : 'Reserve Mode' },
      ],
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json(metadata)

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch token data' })
  }
}
