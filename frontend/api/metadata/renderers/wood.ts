import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class WoodRenderer implements NFTRenderer {
  readonly styleName = 'wood'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — wood style
//
// Palette: dark mahogany background, warm amber accents.
// feTurbulence with high y-frequency creates horizontal wood grain lines.
// Ring-arc decorations simulate a cross-section wood knot in the top-right.
// Allocation bars in warm amber — asset colours softened toward brown.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Wood palette
const W_ = {
  bg0:         '#100b06',   // near-black mahogany
  bg1:         '#1c1208',   // dark walnut
  grain0:      '#2a1a09',   // dark grain line
  grain1:      '#1a0f05',   // darker groove
  border:      '#7c4a1e',   // mid mahogany
  accent:      '#b5651d',   // saddle brown
  accentWarm:  '#c8813a',   // warm amber-brown
  textPrimary: '#d4956a',   // warm light brown
  textDim:     '#7c4a1e',   // muted brown
  textValue:   '#f0c090',   // warm cream
  barTrack:    '#1e1008',   // very dark track
  statusDot:   '#c8813a',
  sectionLbl:  '#7c4a1e',
} as const

// Soften asset bar colours toward the wood palette
function woodenBarColor(assetColor: string): string {
  const map: Record<string, string> = {
    '#d4af37': '#c8813a',  // SMF gold → amber-brown
    '#34d399': '#8faf6a',  // ERC20 green → muted olive
    '#60a5fa': '#7a9ec8',  // AAVE blue → muted steel
    '#2dd4bf': '#6ab5a8',  // LP teal → muted teal
    '#94a3b8': '#9aa080',  // ETH silver → warm sage
    '#a78bfa': '#9a80c8',  // STAKING purple → muted mauve
  }
  return map[assetColor] ?? '#b5651d'
}

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? '#8faf6a' : W_.accentWarm
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

  // Allocation bars — colours softened to wood tones
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    const col   = woodenBarColor(bar.color)
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${col}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${W_.barTrack}" stroke="${W_.grain0}" stroke-width="0.5"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="${col}" fill-opacity="0.75"/>
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
    fill="${W_.textDim}" fill-opacity="0.8" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${W_.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Wood knot — concentric arcs top-right corner
  const kx = W - 52
  const ky = 52
  const knot = [28, 20, 13, 7, 3].map((r, i) =>
    `<ellipse cx="${kx}" cy="${ky}" rx="${r * 1.3}" ry="${r}" fill="none"
      stroke="${W_.grain0}" stroke-width="${i === 0 ? 1.5 : 0.75}"
      stroke-opacity="${0.12 + i * 0.06}" transform="rotate(-12 ${kx} ${ky})"/>`
  ).join('\n    ')

  // Horizontal grain lines across the card body
  const grainLines = Array.from({ length: 14 }, (_, i) => {
    const gy = 90 + i * 32
    const opacity = 0.04 + (i % 3) * 0.02
    return `<line x1="0" y1="${gy}" x2="${W}" y2="${gy + (i % 2 === 0 ? 1 : -1)}"
      stroke="${W_.grain0}" stroke-width="${i % 4 === 0 ? 1.5 : 0.75}" stroke-opacity="${opacity}"/>`
  }).join('\n  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%"   stop-color="${W_.bg0}"/>
      <stop offset="100%" stop-color="${W_.bg1}"/>
    </linearGradient>
    <!-- Wood grain texture -->
    <filter id="grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.6" numOctaves="5"
        seed="3" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="matrix"
        values="0.15 0 0 0 0.1
                0.08 0 0 0 0.04
                0    0 0 0 0.01
                0    0 0 8 -3" in="noise" result="tinted"/>
      <feBlend in="SourceGraphic" in2="tinted" mode="multiply"/>
    </filter>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${W_.accentWarm}" stop-opacity="0.06"/>
      <stop offset="50%"  stop-color="${W_.accentWarm}" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="${W_.accentWarm}" stop-opacity="0.04"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <rect width="${W}" height="${totalH}" rx="24" fill="white" fill-opacity="0.001" filter="url(#grain)"/>
  <!-- Warm sheen -->
  <rect width="${W}" height="${totalH}" rx="24" fill="url(#sheen)"/>

  <!-- Grain lines -->
  <g clip-path="none">
    ${grainLines}
  </g>

  <!-- Border — mahogany frame -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${W_.border}" stroke-opacity="0.6" stroke-width="2"/>
  <!-- Inner frame inset -->
  <rect x="6" y="6" width="${W - 12}" height="${totalH - 12}" rx="20"
    fill="none" stroke="${W_.grain0}" stroke-opacity="0.5" stroke-width="1"/>

  <!-- Wood knot decoration -->
  ${knot}

  <!-- Top accent bar -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="1.5" rx="0.5"
    fill="${W_.accent}" fill-opacity="0.5"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${W_.textDim}" fill-opacity="0.9" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${W_.textPrimary}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="5"
    fill="${statusColor}" fill-opacity="0.12"
    stroke="${statusColor}" stroke-opacity="0.25" stroke-width="0.75"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${statusColor}" fill-opacity="0.85"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${W_.border}" stroke-opacity="0.3" stroke-width="0.75"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${W_.sectionLbl}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${W_.border}" stroke-opacity="0.25" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${W_.sectionLbl}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Bottom accent -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1"
    fill="${W_.accent}" fill-opacity="0.3"/>

  <!-- Style badge -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${W_.textDim}" fill-opacity="0.45" letter-spacing="2" text-anchor="end"
    font-weight="600">WOOD</text>
</svg>`
}
