import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class GoldRenderer implements NFTRenderer {
  readonly styleName = 'gold'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — gold style
//
// Palette: near-black with warm undertones, deep gold (#b8960a), bright gold
// (#d4af37), cream (#f3e5ab). Triple ornate frame. Sunburst radiating spokes
// decoration top-right. Gold shimmer line on each filled bar. Original asset
// colors preserved with gold accents.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Gold palette
const G = {
  bg0:         '#09070a',   // near-black warm
  bg1:         '#12100a',   // very dark gold-brown
  bg2:         '#0e0c06',   // mid dark
  border:      '#b8960a',   // deep gold
  borderBright:'#d4af37',   // bright gold
  accent:      '#d4af37',   // gold
  accentDim:   '#8a6a08',   // dark gold
  textPrimary: '#d4af37',   // gold
  textDim:     '#7a6010',   // muted gold
  textValue:   '#f3e5ab',   // cream
  barTrack:    '#100e06',   // very dark track
} as const

function buildSvg(ctx: RenderContext): string {
  const { tokenId, active, bars, holdings } = ctx

  const statusColor  = active ? '#6abf80' : G.accent
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

  // Allocation bars — original asset colors with gold shimmer line
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${bar.color}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${G.barTrack}" stroke="${G.accentDim}" stroke-width="0.5" stroke-opacity="0.3"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="${bar.color}" fill-opacity="0.7"/>
  <line x1="${BAR_X + 2}" y1="${by + 3}" x2="${BAR_X + Math.max(fillW - 4, 0)}" y2="${by + 3}"
    stroke="${G.accent}" stroke-opacity="0.25" stroke-width="1.5"/>
  <text x="${PCT_X}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${bar.color}" font-weight="600" text-anchor="end">${pct}</text>`
  }).join('')

  // Holdings grid
  const holdSvg = holdings.map((h: Holding, i: number) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${G.textDim}" fill-opacity="0.9" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${G.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Sunburst — radiating spokes top-right
  const sx = W - 52
  const sy = 52
  const spokeAngles = Array.from({ length: 16 }, (_, i) => i * 22.5)
  const sunburst = spokeAngles.map((angle, i) => {
    const rad = (angle * Math.PI) / 180
    const r1 = 8
    const r2 = 24 + (i % 2 === 0 ? 4 : 0)
    const x1 = sx + Math.cos(rad) * r1
    const y1 = sy + Math.sin(rad) * r1
    const x2 = sx + Math.cos(rad) * r2
    const y2 = sy + Math.sin(rad) * r2
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
      stroke="${G.accent}" stroke-width="${i % 2 === 0 ? 1 : 0.5}" stroke-opacity="${i % 2 === 0 ? 0.3 : 0.15}"/>`
  }).join('\n    ')
  const sunburstEl = `
  <circle cx="${sx}" cy="${sy}" r="5" fill="${G.accent}" fill-opacity="0.3"/>
  <circle cx="${sx}" cy="${sy}" r="2.5" fill="${G.accent}" fill-opacity="0.5"/>
  ${sunburst}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <!-- Three-stop warm background: black → dark gold-brown → black -->
    <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0%"   stop-color="${G.bg0}"/>
      <stop offset="55%"  stop-color="${G.bg2}"/>
      <stop offset="100%" stop-color="${G.bg1}"/>
    </linearGradient>
    <!-- Gold shimmer top wash -->
    <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${G.accent}" stop-opacity="0.08"/>
      <stop offset="40%"  stop-color="${G.accent}" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="${G.accent}" stop-opacity="0.05"/>
    </linearGradient>
    <!-- Gold texture filter -->
    <filter id="grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.35 0.2" numOctaves="4"
        seed="5" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="matrix"
        values="0.25 0 0 0 0.12
                0.15 0 0 0 0.07
                0    0 0 0 0
                0    0 0 7 -3" in="noise" result="tinted"/>
      <feBlend in="SourceGraphic" in2="tinted" mode="multiply"/>
    </filter>
    <clipPath id="card-clip">
      <rect width="${W}" height="${totalH}" rx="24"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <rect width="${W}" height="${totalH}" rx="24" fill="white" fill-opacity="0.001" filter="url(#grain)"/>
  <!-- Gold wash -->
  <rect width="${W}" height="${totalH}" rx="24" fill="url(#wash)"/>

  <!-- Triple ornate frame -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${G.borderBright}" stroke-opacity="0.6" stroke-width="2"/>
  <rect x="5" y="5" width="${W - 10}" height="${totalH - 10}" rx="21"
    fill="none" stroke="${G.accent}" stroke-opacity="0.2" stroke-width="0.5"/>
  <rect x="9" y="9" width="${W - 18}" height="${totalH - 18}" rx="18"
    fill="none" stroke="${G.border}" stroke-opacity="0.15" stroke-width="0.75"/>

  <!-- Sunburst decoration -->
  ${sunburstEl}

  <!-- Top accent bar -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="2" rx="0.75"
    fill="${G.accent}" fill-opacity="0.55"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${G.textDim}" fill-opacity="0.9" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${G.accent}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge -->
  <rect x="${LEFT}" y="${yBadge}" width="${statusBadgeW}" height="22" rx="5"
    fill="${statusColor}" fill-opacity="0.1"
    stroke="${statusColor}" stroke-opacity="0.3" stroke-width="0.75"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${statusColor}" fill-opacity="0.9"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${statusColor}" font-weight="600">${statusLabel}</text>

  <!-- Divider 1 -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${G.border}" stroke-opacity="0.35" stroke-width="1"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${G.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${G.border}" stroke-opacity="0.25" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${G.textDim}" fill-opacity="0.8" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Bottom accent — double line -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="1.5"
    fill="${G.accent}" fill-opacity="0.4"/>
  <rect x="${LEFT}" y="${yBottomLine + 4}" width="420" height="0.5"
    fill="${G.border}" fill-opacity="0.2"/>

  <!-- Style badge -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${G.textDim}" fill-opacity="0.45" letter-spacing="2" text-anchor="end"
    font-weight="600">GOLD</text>
</svg>`
}
