import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class SilverRenderer implements NFTRenderer {
  readonly styleName = 'silver'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — silver style
//
// Palette: cool dark blue-grey background, silver (#c0c8d4), platinum (#e8edf2).
// feTurbulence with high x-frequency creates horizontal brushed-metal streaks.
// Mirror-finish reflection overlay. Concentric coin-face emblem top-right.
// Asset colors shifted toward cool silver tones.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Silver palette
const SV = {
  bg0:         '#080c10',   // near-black cool
  bg1:         '#121820',   // dark blue-grey
  border:      '#8090a0',   // steel grey
  borderBright:'#c0c8d4',   // silver
  accent:      '#c0c8d4',   // silver
  accentBright:'#e8edf2',   // platinum
  textPrimary: '#c8d4e0',   // cool silver
  textDim:     '#506070',   // muted steel
  textValue:   '#e8edf2',   // platinum
  barTrack:    '#0c1018',   // very dark track
  statusGreen: '#60b090',   // cool green
} as const

// Shift asset colors toward cool silver tones
function silverBarColor(assetColor: string): string {
  const map: Record<string, string> = {
    '#d4af37': '#b0b870',  // SMF gold → yellow-silver
    '#34d399': '#60a890',  // ERC20 green → cool teal-grey
    '#60a5fa': '#80a8c8',  // AAVE blue → steel blue
    '#2dd4bf': '#60b0b0',  // LP teal → cool teal
    '#94a3b8': '#c0c8d4',  // ETH silver → full silver
    '#a78bfa': '#9090c0',  // STAKING purple → cool mauve
  }
  return map[assetColor] ?? '#c0c8d4'
}

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? SV.statusGreen : SV.accent
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

  // Allocation bars — colors shifted to silver tones
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    const col   = silverBarColor(bar.color)
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${SV.barTrack}" stroke="${SV.bg0}" stroke-width="0.5"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="${col}" fill-opacity="0.6"/>
  <line x1="${BAR_X + 2}" y1="${by + 3}" x2="${BAR_X + Math.max(fillW - 4, 0)}" y2="${by + 3}"
    stroke="white" stroke-opacity="0.18" stroke-width="1.5"/>
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
    fill="${SV.textDim}" fill-opacity="0.9" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${SV.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Coin-face emblem — concentric circles top-right
  const ex = W - 52
  const ey = 52
  const coinRings = [30, 22, 15, 8, 3].map((r, i) =>
    `<circle cx="${ex}" cy="${ey}" r="${r}" fill="none"
      stroke="${SV.borderBright}" stroke-width="${i === 0 ? 1.2 : 0.6}"
      stroke-opacity="${0.08 + i * 0.05}"/>`
  ).join('\n    ')

  // Horizontal brushed-metal streaks
  const brushLines = Array.from({ length: 20 }, (_, i) => {
    const gy = 60 + i * 24
    const opacity = 0.025 + (i % 4 === 0 ? 0.02 : 0)
    return `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}"
      stroke="${SV.accentBright}" stroke-width="${i % 5 === 0 ? 1 : 0.5}" stroke-opacity="${opacity}"/>`
  }).join('\n  ')

  // Mirror-finish reflection band across middle
  const reflectY = Math.round(totalH * 0.38)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%"   stop-color="${SV.bg0}"/>
      <stop offset="100%" stop-color="${SV.bg1}"/>
    </linearGradient>
    <!-- Brushed metal texture -->
    <filter id="grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.8 0.03" numOctaves="4"
        seed="11" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="matrix"
        values="0.06 0 0 0 0.04
                0.06 0 0 0 0.05
                0.07 0 0 0 0.06
                0    0 0 5 -2" in="noise" result="tinted"/>
      <feBlend in="SourceGraphic" in2="tinted" mode="screen"/>
    </filter>
    <!-- Mirror reflection gradient -->
    <linearGradient id="reflect" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${SV.accentBright}" stop-opacity="0"/>
      <stop offset="50%"  stop-color="${SV.accentBright}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${SV.accentBright}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="card-clip">
      <rect width="${W}" height="${totalH}" rx="24"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <rect width="${W}" height="${totalH}" rx="24" fill="white" fill-opacity="0.001" filter="url(#grain)"/>

  <!-- Brushed lines -->
  <g clip-path="url(#card-clip)">
    ${brushLines}
  </g>

  <!-- Mirror-finish band -->
  <rect x="0" y="${reflectY}" width="${W}" height="${Math.round(totalH * 0.22)}"
    fill="url(#reflect)" clip-path="url(#card-clip)"/>

  <!-- Border — bright silver outer -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${SV.borderBright}" stroke-opacity="0.5" stroke-width="1.5"/>
  <!-- Inner frame — dimmer steel -->
  <rect x="5" y="5" width="${W - 10}" height="${totalH - 10}" rx="21"
    fill="none" stroke="${SV.border}" stroke-opacity="0.2" stroke-width="0.75"/>

  <!-- Coin-face emblem -->
  ${coinRings}

  <!-- Top accent line — bright silver -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="1.5" rx="0.5"
    fill="${SV.accent}" fill-opacity="0.55"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${SV.textDim}" fill-opacity="0.9" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${SV.textPrimary}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="4"
    fill="${statusColor}" fill-opacity="0.1"
    stroke="${statusColor}" stroke-opacity="0.3" stroke-width="0.75"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${statusColor}" fill-opacity="0.85"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${SV.border}" stroke-opacity="0.35" stroke-width="0.75"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${SV.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${SV.border}" stroke-opacity="0.25" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${SV.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Bottom accent -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1"
    fill="${SV.accent}" fill-opacity="0.3"/>

  <!-- Style badge -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${SV.textDim}" fill-opacity="0.45" letter-spacing="2" text-anchor="end"
    font-weight="600">SILVER</text>
</svg>`
}
