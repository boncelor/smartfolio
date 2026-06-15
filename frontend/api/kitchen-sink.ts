import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { RenderContext } from './metadata/renderers/types.js'
import { StoneRenderer }  from './metadata/renderers/stone.js'
import { WoodRenderer }   from './metadata/renderers/wood.js'
import { CopperRenderer } from './metadata/renderers/copper.js'
import { SilverRenderer } from './metadata/renderers/silver.js'
import { GoldRenderer }   from './metadata/renderers/gold.js'
import { DeluxeRenderer } from './metadata/renderers/deluxe.js'

// ---------------------------------------------------------------------------
// Sample render context — representative portfolio with mixed assets
// ---------------------------------------------------------------------------
const SAMPLE_BARS = [
  { label: 'SMF',   weightBps: 2000, color: '#d4af37' },
  { label: 'ETH',   weightBps: 3000, color: '#94a3b8' },
  { label: 'USDC',  weightBps: 2500, color: '#34d399' },
  { label: 'AAVE',  weightBps: 1500, color: '#60a5fa' },
  { label: 'WBTC',  weightBps: 1000, color: '#2dd4bf' },
]

const SAMPLE_HOLDINGS = [
  { label: 'SMF',        value: '42.00 SMF',   color: '#d4af37' },
  { label: 'ETH RESERVE',value: '1.2500 ETH',  color: '#94a3b8' },
  { label: 'AAVE WETH',  value: '0.3100 WETH', color: '#60a5fa' },
  { label: 'USDC',       value: '5,000',        color: '#34d399' },
]

// One context per renderer — vary smfAmount so each is representatively named
const RENDERERS = [
  { renderer: new StoneRenderer(),  label: 'Stone',  sub: 'Reserve Mode / 0 SMF',   ctx: baseCtx(false, 0) },
  { renderer: new WoodRenderer(),   label: 'Wood',   sub: '0 < SMF < 1',             ctx: baseCtx(true, 0.5) },
  { renderer: new CopperRenderer(), label: 'Copper', sub: '1 ≤ SMF < 10',            ctx: baseCtx(true, 5) },
  { renderer: new SilverRenderer(), label: 'Silver', sub: '10 ≤ SMF < 100',          ctx: baseCtx(true, 42) },
  { renderer: new GoldRenderer(),   label: 'Gold',   sub: '100 ≤ SMF < 1000',        ctx: baseCtx(true, 250) },
  { renderer: new DeluxeRenderer(), label: 'Deluxe', sub: 'SMF ≥ 1000',              ctx: baseCtx(true, 2500) },
]

function baseCtx(active: boolean, smfAmount: number): RenderContext {
  const tokenId = active ? 27 : 3
  const bars = active ? SAMPLE_BARS : SAMPLE_BARS.map(b => ({ ...b, weightBps: 0 === b.label.indexOf('SMF') ? 0 : b.weightBps }))
  return { tokenId, active, smfAmount, bars: SAMPLE_BARS, holdings: active ? SAMPLE_HOLDINGS : [] }
}

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const cards = RENDERERS.map(({ renderer, label, sub, ctx }) => {
    const svg = renderer.render(ctx)
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    return `
    <div class="card">
      <img src="${dataUri}" alt="${label}" width="500"/>
      <div class="caption">
        <span class="name">${label}</span>
        <span class="range">${sub}</span>
      </div>
    </div>`
  }).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Smartfolio — NFT Style Kitchen Sink</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a0a;
      color: #ccc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 48px 24px;
    }
    h1 {
      text-align: center;
      font-size: 13px;
      letter-spacing: 4px;
      color: #555;
      font-weight: 500;
      text-transform: uppercase;
      margin-bottom: 48px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
      gap: 40px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card img {
      width: 100%;
      height: auto;
      border-radius: 24px;
    }
    .caption {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 0 4px;
    }
    .name {
      font-size: 12px;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #888;
      font-weight: 600;
    }
    .range {
      font-size: 11px;
      color: #444;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <h1>Smartfolio — NFT Renderer Styles</h1>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=3600')
  return res.status(200).send(html)
}
