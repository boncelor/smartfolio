import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class CopperRenderer implements NFTRenderer {
  readonly styleName = 'copper'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — copper style
//
// Palette: deep reddish-brown background, copper (#b87333) with verdigris
// patina (#4a9a8a) accents. feTurbulence surface texture. Diagonal metallic
// sheen stripe. Per-bar gradients from copper to verdigris. Art-Deco corner
// brackets. Scattered patina blobs.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Copper palette
const C = {
  bg0:         '#0e0806',   // deep reddish-black
  bg1:         '#1a0f0a',   // dark copper-brown
  border:      '#b87333',   // copper
  accent:      '#d4945a',   // bright copper
  verdigris:   '#4a9a8a',   // patina green
  verdigrisDim:'#2d6b5e',   // dark patina
  textPrimary: '#d4945a',   // warm copper text
  textDim:     '#7a4a28',   // muted copper
  textValue:   '#f0c090',   // warm cream
  barTrack:    '#1c0e08',   // very dark track
  statusGreen: '#6ab59a',   // muted verdigris green
} as const

// Map asset colors to copper/verdigris tones
function copperBarColor(assetColor: string): string {
  const map: Record<string, string> = {
    '#d4af37': '#d4945a',  // SMF gold → copper
    '#34d399': '#4a9a8a',  // ERC20 green → verdigris
    '#60a5fa': '#5a8aa8',  // AAVE blue → muted steel-blue
    '#2dd4bf': '#4a9a8a',  // LP teal → verdigris
    '#94a3b8': '#9a8070',  // ETH silver → warm grey-brown
    '#a78bfa': '#8a6aa8',  // STAKING purple → muted mauve
  }
  return map[assetColor] ?? '#b87333'
}

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? C.statusGreen : C.verdigris
  const statusLabel  = active ? 'Portfolio Active' : 'Reserve Mode'
  const statusBadgeW = active ? 142 : 120

  const LEFT    = 40
  const RIGHT   = 460
  const W       = 500
  const BAR_X   = 135
  const BAR_W   = 240
  const BAR_H   = 17
  const BAR_ROW = 40
  const PCT_X   = 388

  const headerH = 172
  const allocH  = 28 + bars.length * BAR_ROW + 16
  const holdH   = holdings.length > 0 ? 28 + Math.ceil(holdings.length / 2) * 40 + 10 : 0
  const footerH = 52
  const totalH  = Math.max(headerH + allocH + 28 + holdH + footerH, 520)

  const yTopLine    = 42
  const yTitle      = 68
  const yId         = 116
  const yBadge      = 142
  const yDiv1       = 170
  const yAllocLbl   = yDiv1 + 22
  const yBarsStart  = yAllocLbl + 16
  const yDiv2       = yBarsStart + bars.length * BAR_ROW + 10
  const yHoldLbl    = yDiv2 + 24
  const yHoldStart  = yHoldLbl + 20
  const yBottomLine = totalH - 42

  // Per-bar gradient defs: each bar gets copper → verdigris gradient
  const barGradDefs = bars.map((bar: AssetBar, i: number) => {
    const col = copperBarColor(bar.color)
    return `<linearGradient id="bg${i}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${col}"/>
      <stop offset="100%" stop-color="${C.verdigris}"/>
    </linearGradient>`
  }).join('\n    ')

  // Allocation bars with per-bar gradients and metallic sheen line
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    const col   = copperBarColor(bar.color)
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${C.barTrack}" stroke="${C.bg0}" stroke-width="0.5"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="url(#bg${i})" fill-opacity="0.7"/>
  <line x1="${BAR_X + 2}" y1="${by + 3}" x2="${BAR_X + Math.max(fillW - 4, 0)}" y2="${by + 3}"
    stroke="white" stroke-opacity="0.12" stroke-width="1"/>
  <text x="${PCT_X}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" text-anchor="end">${pct}</text>`
  }).join('')

  // Holdings grid
  const holdSvg = holdings.map((h: Holding, i: number) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${C.textDim}" fill-opacity="0.9" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${C.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Art-Deco corner brackets — L-shaped paths at all 4 corners
  const bracketLen = 18
  const bracketInset = 14
  const brackets = `
  <g stroke="${C.accent}" stroke-width="1.5" fill="none" stroke-opacity="0.45">
    <!-- Top-left -->
    <path d="M${bracketInset + bracketLen},${bracketInset} L${bracketInset},${bracketInset} L${bracketInset},${bracketInset + bracketLen}"/>
    <!-- Top-right -->
    <path d="M${W - bracketInset - bracketLen},${bracketInset} L${W - bracketInset},${bracketInset} L${W - bracketInset},${bracketInset + bracketLen}"/>
    <!-- Bottom-left -->
    <path d="M${bracketInset},${totalH - bracketInset - bracketLen} L${bracketInset},${totalH - bracketInset} L${bracketInset + bracketLen},${totalH - bracketInset}"/>
    <!-- Bottom-right -->
    <path d="M${W - bracketInset},${totalH - bracketInset - bracketLen} L${W - bracketInset},${totalH - bracketInset} L${W - bracketInset - bracketLen},${totalH - bracketInset}"/>
  </g>`

  // Verdigris patina blobs — scattered ellipses at low opacity
  const patinaBlobs = [
    { x: 420, y: 90,  rx: 22, ry: 10, rot: 15,  op: 0.07 },
    { x: 80,  y: 180, rx: 14, ry: 7,  rot: -20, op: 0.05 },
    { x: 380, y: totalH - 100, rx: 18, ry: 8, rot: 10, op: 0.06 },
    { x: 120, y: totalH - 80,  rx: 10, ry: 5, rot: -5, op: 0.05 },
    { x: 460, y: Math.round(totalH / 2), rx: 16, ry: 6, rot: 30, op: 0.06 },
  ].map(b =>
    `<ellipse cx="${b.x}" cy="${b.y}" rx="${b.rx}" ry="${b.ry}"
      fill="${C.verdigris}" fill-opacity="${b.op}"
      transform="rotate(${b.rot} ${b.x} ${b.y})"/>`
  ).join('\n  ')

  // Diagonal metallic sheen rect (clipped to card)
  const sheen = `
  <defs>
    <clipPath id="card-clip">
      <rect width="${W}" height="${totalH}" rx="24"/>
    </clipPath>
    <linearGradient id="sheen-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${C.accent}" stop-opacity="0"/>
      <stop offset="45%"  stop-color="${C.accent}" stop-opacity="0.055"/>
      <stop offset="55%"  stop-color="${C.accent}" stop-opacity="0.055"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#card-clip)">
    <rect x="-${W}" y="${Math.round(totalH * 0.2)}" width="${W * 3}" height="${Math.round(totalH * 0.25)}"
      fill="url(#sheen-grad)"
      transform="rotate(-25 ${Math.round(W / 2)} ${Math.round(totalH / 2)})"/>
  </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%"   stop-color="${C.bg0}"/>
      <stop offset="100%" stop-color="${C.bg1}"/>
    </linearGradient>
    ${barGradDefs}
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <!-- Patina blobs -->
  ${patinaBlobs}

  <!-- Diagonal sheen -->
  ${sheen}

  <!-- Border — copper frame -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${C.border}" stroke-opacity="0.55" stroke-width="1.5"/>
  <!-- Inner frame inset — verdigris tint -->
  <rect x="6" y="6" width="${W - 12}" height="${totalH - 12}" rx="20"
    fill="none" stroke="${C.verdigrisDim}" stroke-opacity="0.35" stroke-width="0.75"/>

  <!-- Art-Deco corner brackets -->
  ${brackets}

  <!-- Top accent bar: copper left, verdigris right -->
  <rect x="${LEFT}" y="${yTopLine}" width="310" height="1.5" rx="0.5"
    fill="${C.accent}" fill-opacity="0.5"/>
  <rect x="${LEFT + 316}" y="${yTopLine}" width="104" height="1.5" rx="0.5"
    fill="${C.verdigris}" fill-opacity="0.4"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${C.textDim}" fill-opacity="0.9" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${C.textPrimary}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="5"
    fill="${statusColor}" fill-opacity="0.1"
    stroke="${statusColor}" stroke-opacity="0.3" stroke-width="0.75"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${statusColor}" fill-opacity="0.9"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 — split copper / verdigris -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${Math.round(W * 0.65)}" y2="${yDiv1}"
    stroke="${C.border}" stroke-opacity="0.3" stroke-width="0.75"/>
  <line x1="${Math.round(W * 0.65)}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${C.verdigris}" stroke-opacity="0.25" stroke-width="0.75"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${C.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 — split -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${Math.round(W * 0.65)}" y2="${yDiv2}"
    stroke="${C.border}" stroke-opacity="0.22" stroke-width="0.75"/>
  <line x1="${Math.round(W * 0.65)}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${C.verdigris}" stroke-opacity="0.18" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${C.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Bottom accent -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1"
    fill="${C.border}" fill-opacity="0.25"/>

  <!-- Style badge -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${C.textDim}" fill-opacity="0.45" letter-spacing="2" text-anchor="end"
    font-weight="600">COPPER</text>
</svg>`
}
