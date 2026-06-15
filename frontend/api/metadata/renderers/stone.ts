import type { NFTRenderer, RenderContext, AssetBar, Holding } from './types.js'

export class StoneRenderer implements NFTRenderer {
  readonly styleName = 'stone'

  render(ctx: RenderContext): string {
    return buildSvg(ctx)
  }
}

// ---------------------------------------------------------------------------
// SVG builder — stone style
//
// Palette: cold charcoal background, slate-grey accents, no gold.
// All allocation bars desaturated to grey — portfolio is dormant/undeployed.
// feTurbulence overlay creates grainy stone texture.
// Hairline crack decorations in corners.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Stone palette
const S = {
  bg0:        '#0c0c0d',   // near-black charcoal
  bg1:        '#1a1918',   // slightly warm dark
  border:     '#57534e',   // stone grey
  accent:     '#78716c',   // warm slate
  accentDim:  '#44403c',   // darker slate
  textPrimary:'#a8a29e',   // light stone
  textDim:    '#57534e',   // muted stone
  textValue:  '#d6d3d1',   // near-white stone
  barTrack:   '#292524',   // very dark bar track
  barFill:    '#57534e',   // slate fill for all bars
  statusDot:  '#6b7280',   // grey dot
} as const

function buildSvg(ctx: RenderContext): string {
  const { tokenId, bars, holdings } = ctx

  const LEFT    = 40
  const RIGHT   = 460
  const W       = 500
  const BAR_X   = 135
  const BAR_W   = 240
  const BAR_H   = 16
  const BAR_ROW = 38
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

  // Allocation bars — all grey regardless of asset type
  const barsSvg = bars.map((bar: AssetBar, i: number) => {
    const by    = yBarsStart + i * BAR_ROW
    const fillW = Math.round((bar.weightBps / 10000) * BAR_W)
    const pct   = (bar.weightBps / 100).toFixed(0) + '%'
    return `
  <text x="${LEFT}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${S.textDim}" font-weight="600" letter-spacing="0.5">${esc(bar.label)}</text>
  <rect x="${BAR_X}" y="${by}" width="${BAR_W}" height="${BAR_H}" rx="3"
    fill="${S.barTrack}"/>
  <rect x="${BAR_X}" y="${by}" width="${fillW}" height="${BAR_H}" rx="3"
    fill="${S.barFill}" fill-opacity="0.7"/>
  <text x="${PCT_X}" y="${by + 13}" font-family="sans-serif" font-size="11"
    fill="${S.textDim}" font-weight="600" text-anchor="end">${pct}</text>`
  }).join('')

  // Holdings grid — grey tones
  const holdSvg = holdings.map((h: Holding, i: number) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const hx  = LEFT + col * 210
    const hy  = yHoldStart + row * 40
    return `
  <text x="${hx}" y="${hy}" font-family="sans-serif" font-size="9.5"
    fill="${S.textDim}" fill-opacity="0.7" letter-spacing="1.5">${esc(h.label)}</text>
  <text x="${hx}" y="${hy + 20}" font-family="Georgia, serif" font-size="15"
    fill="${S.textValue}" font-weight="bold">${esc(h.value)}</text>`
  }).join('')

  // Corner crack decorations — thin irregular lines
  const cracks = `
  <g opacity="0.18" stroke="${S.accent}" stroke-width="0.8" fill="none">
    <polyline points="${W - 40},${totalH - 40} ${W - 58},${totalH - 62} ${W - 44},${totalH - 74}"/>
    <polyline points="${W - 52},${totalH - 42} ${W - 68},${totalH - 55}"/>
    <polyline points="40,${totalH - 40} 54,${totalH - 58} 48,${totalH - 72} 60,${totalH - 80}"/>
  </g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%"   stop-color="${S.bg0}"/>
      <stop offset="100%" stop-color="${S.bg1}"/>
    </linearGradient>
    <!-- Stone grain overlay -->
    <filter id="grain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="4"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
      <feBlend in="SourceGraphic" in2="grey" mode="multiply" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <!-- Crack texture for overlay rect -->
    <filter id="roughen">
      <feTurbulence type="turbulence" baseFrequency="0.02 0.06" numOctaves="2"
        result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)" rx="24"/>
  <!-- Stone grain texture overlay -->
  <rect width="${W}" height="${totalH}" rx="24" fill="${S.accent}" fill-opacity="0.04" filter="url(#grain)"/>

  <!-- Border — rough slate -->
  <rect x="1" y="1" width="${W - 2}" height="${totalH - 2}" rx="23"
    fill="none" stroke="${S.border}" stroke-opacity="0.5" stroke-width="1.5"
    stroke-dasharray="4 2"/>

  <!-- Inner border inset — double frame feel -->
  <rect x="8" y="8" width="${W - 16}" height="${totalH - 16}" rx="18"
    fill="none" stroke="${S.accentDim}" stroke-opacity="0.3" stroke-width="0.75"/>

  <!-- Top accent -->
  <rect x="${LEFT}" y="${yTopLine}" width="420" height="1" rx="0.5"
    fill="${S.accent}" fill-opacity="0.35"/>

  <!-- SMARTFOLIO label -->
  <text x="${LEFT}" y="${yTitle}" font-family="sans-serif" font-size="11"
    fill="${S.textDim}" fill-opacity="0.8" letter-spacing="4" font-weight="600">SMARTFOLIO</text>

  <!-- Token ID -->
  <text x="${LEFT}" y="${yId}" font-family="Georgia, serif" font-size="46"
    fill="${S.textPrimary}" font-weight="bold">#${tokenId}</text>

  <!-- Status badge — always "Reserve Mode" for stone -->
  <rect x="${LEFT}" y="${yBadge}" width="118" height="22" rx="4"
    fill="${S.barTrack}" stroke="${S.border}" stroke-width="0.75" stroke-opacity="0.6"/>
  <circle cx="${LEFT + 14}" cy="${yBadge + 11}" r="3.5"
    fill="${S.statusDot}" fill-opacity="0.7"/>
  <text x="${LEFT + 25}" y="${yBadge + 15}" font-family="sans-serif" font-size="11"
    fill="${S.textDim}" font-weight="500">Reserve Mode</text>

  <!-- Divider 1 -->
  <line x1="${LEFT}" y1="${yDiv1}" x2="${RIGHT}" y2="${yDiv1}"
    stroke="${S.accentDim}" stroke-opacity="0.5" stroke-width="0.75"/>

  <!-- ALLOCATION label -->
  <text x="${LEFT}" y="${yAllocLbl}" font-family="sans-serif" font-size="9.5"
    fill="${S.textDim}" fill-opacity="0.6" letter-spacing="2.5" font-weight="600">ALLOCATION</text>

  ${barsSvg}

  ${holdings.length > 0 ? `
  <!-- Divider 2 -->
  <line x1="${LEFT}" y1="${yDiv2}" x2="${RIGHT}" y2="${yDiv2}"
    stroke="${S.accentDim}" stroke-opacity="0.4" stroke-width="0.75"/>
  <!-- HOLDINGS label -->
  <text x="${LEFT}" y="${yHoldLbl}" font-family="sans-serif" font-size="9.5"
    fill="${S.textDim}" fill-opacity="0.6" letter-spacing="2.5" font-weight="600">HOLDINGS</text>
  ${holdSvg}` : ''}

  <!-- Corner crack decorations -->
  ${cracks}

  <!-- Bottom accent -->
  <rect x="${LEFT}" y="${yBottomLine}" width="420" height="0.75"
    fill="${S.accent}" fill-opacity="0.2"/>

  <!-- Style badge -->
  <text x="${RIGHT}" y="${yBottomLine + 22}" font-family="sans-serif" font-size="9"
    fill="${S.textDim}" fill-opacity="0.4" letter-spacing="2" text-anchor="end"
    font-weight="600">STONE</text>
</svg>`
}
