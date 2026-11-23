import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import {
  formatPacific,
  moonIllumination,
  moonPosition,
  pacificToday,
  sunPosition,
  sunTimes,
} from './astro.js'
import { makeColors } from './make-colors.js'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Where the sun and moon are computed for. Los Angeles; change to your spot.
const LAT = 34.05
const LNG = -118.24

// Context-window % at which the sea steps up: swell, choppy, rough, whitecaps.
// Use /ocean sea 0-4 to preview a state without changing these.
const THRESHOLDS = [20, 40, 60, 80]

const SKY_TICK_MS = 2 * 60 * 1000

// ---------------------------------------------------------------------------
// Colors: deep navy by night, sea-mist by day; sea-foam and sunset accents.
// ---------------------------------------------------------------------------

const { theme, problems } = makeColors({
  label: 'Ocean tide',
  roles: {
    accent: '#3fbfa4', // sea-foam
    danger: '#d9463e',
    success: '#6fae4e',
    warning: '#e0952e',
    pro: '#f07a45', // sunset orange
  },
  light: {
    gray: {
      anchors: {
        'surface-0': '#d9e8ee',
        'surface-1': '#e4f0f4',
        'surface-2': '#eff6f8',
        'surface-3': '#eff6f8',
        'text-primary': '#0b1f33',
        'text-secondary': '#2a4257',
        'text-muted': '#475f73',
      },
    },
  },
  dark: {
    roles: {
      accent: '#4fd1b5',
      danger: '#e5534b',
      success: '#8fcf6a',
      warning: '#f2a541',
      pro: '#ff8c5a',
    },
    gray: {
      anchors: {
        'surface-0': '#0a1628',
        'surface-1': '#0e1d33',
        'surface-2': '#11223a',
        'surface-3': '#13253d',
        'text-primary': '#eaf3f6',
        'text-secondary': '#bcd0da',
        'text-muted': '#93acba',
      },
    },
  },
})

const SCENE = 'ocean-tide'
type Mode = 'light' | 'dark'

function lookFor(mode: Mode): ThemeSetArgs {
  return {
    colors: theme,
    overrideColorScheme: mode,
    backdrop: {
      scene: SCENE,
      glass:
        mode === 'dark'
          ? { blur: 10, tint: '#0a1628', opacity: 0.55 }
          : { blur: 12, tint: '#e4f0f4', opacity: 0.6 },
    },
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const level = atom({ plugin: 'ocean-tide', key: 'level' } as const, 0)
const warned = atom({ plugin: 'ocean-tide', key: 'warned' } as const, false)
const skyTime = atom({ plugin: 'ocean-tide', key: 'skyTime' } as const, 0)
const forceLevel = atom({ plugin: 'ocean-tide', key: 'forceLevel' } as const, -1)
const pinnedTime = atom({ plugin: 'ocean-tide', key: 'pinnedTime' } as const, 0)

const NAMES = ['calm', 'gentle swell', 'choppy', 'rough', 'whitecaps']

// Module-level: what the status line shows, and which mode the theme is in.
let seaText = ''
let skyText = ''
let appliedMode: Mode | undefined
let ticker: { cancel: () => void } | undefined

function levelFor(percent: number): number {
  let lvl = 0
  THRESHOLDS.forEach((t, i) => {
    if (percent >= t) lvl = i + 1
  })
  return lvl
}

function showStatus($: EngineInterface): void {
  $.ui.status(`🌊 ${seaText}${skyText ? ` · ${skyText}` : ''}`)
}

async function refreshSea($: EngineInterface): Promise<void> {
  const { context } = await $.session.usage()
  const percent = context.percent ?? 0
  const forced = await read($, forceLevel)
  const next = forced >= 0 ? forced : levelFor(percent)

  await update($, level, () => next)
  seaText = `${NAMES[next] ?? 'sea'} · ${Math.round(percent)}% context${forced >= 0 ? ' (preview)' : ''}`
  showStatus($)

  if (next >= 4 && forced < 0) {
    if (!(await read($, warned))) {
      await update($, warned, () => true)
      $.ui.toast('Whitecaps ahead: context is nearly full. A good time to start a new chat.')
    }
  } else if (next < 3) {
    await update($, warned, () => false)
  }
}

function modeAt(t: number): Mode {
  return sunPosition(t, LAT, LNG).alt > (-0.833 * Math.PI) / 180 ? 'light' : 'dark'
}

async function refreshSky($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const pinned = await read($, pinnedTime)
  const t = pinned > 0 ? pinned : now
  await update($, skyTime, () => t)

  const mode = modeAt(t)
  if (mode !== appliedMode) {
    appliedMode = mode
    const set = await $.theme.set(lookFor(mode))
    if (!set.isDrawn) {
      $.ui.log(`ocean-tide: theme not drawn here (${set.reason})`)
    }
  }

  const { rise, set } = sunTimes(t, LAT, LNG)
  const label = pinned > 0 ? ` (preview ${formatPacific(t)})` : ''
  skyText =
    mode === 'light' ? `☀ sets ${formatPacific(set)}${label}` : `☾ sunrise ${formatPacific(rise + (t > rise ? 86400000 : 0))}${label}`
  showStatus($)
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

const W = 1600 // one loop of the drift; every wave's period divides this
const H = 900
const HORIZON = 770

type Sea = { amp: number; rough: number; speed: number; rise: number; foam: number }

const SEAS: Sea[] = [
  { amp: 1.0, rough: 0.1, speed: 1.0, rise: 0, foam: 0 },
  { amp: 1.7, rough: 0.22, speed: 0.9, rise: 14, foam: 0 },
  { amp: 2.5, rough: 0.35, speed: 0.8, rise: 30, foam: 0 },
  { amp: 3.4, rough: 0.46, speed: 0.7, rise: 48, foam: 0.35 },
  { amp: 4.3, rough: 0.52, speed: 0.6, rise: 66, foam: 1 },
]

type Layer = { base: number; amp: number; k: number; phase: number; drift: number; bob: number }

const LAYERS: Layer[] = [
  { base: 790, amp: 8, k: 3, phase: 0.6, drift: 110, bob: 13 },
  { base: 825, amp: 10, k: 2, phase: 2.1, drift: 85, bob: 11 },
  { base: 860, amp: 12, k: 4, phase: 4.0, drift: 64, bob: 9 },
]

const WATER = {
  dark: { fills: ['#12304f', '#143b5c'], front: ['#1b5568', '#123d55', '#0a2238'], edges: ['#f28c4a', '#ffb27a', '#7fd8c4'], edgeOp: [0.28, 0.18, 0.4] },
  light: { fills: ['#4f8fb4', '#3c7ca5'], front: ['#3fa6ad', '#2a7f96', '#1c5a78'], edges: ['#ffd2a8', '#ffe2c4', '#c8f5ea'], edgeOp: [0.45, 0.35, 0.7] },
}

function waveY(layer: Layer, sea: Sea, x: number): number {
  const theta = (2 * Math.PI * layer.k * x) / W + layer.phase
  const a = layer.amp * sea.amp
  // Peaked crests and flat troughs (a Stokes-like second harmonic), plus chop.
  const swell = Math.cos(theta) + sea.rough * 0.55 * Math.cos(2 * theta)
  const chop = sea.rough * 0.22 * Math.sin(5 * theta + 1.3) + sea.rough * 0.12 * Math.sin(9 * theta + 0.4)
  return layer.base - sea.rise - a * (swell + chop)
}

function crestPoints(layer: Layer, sea: Sea): string {
  const parts: string[] = []
  for (let x = 0; x <= 2 * W; x += 8) {
    parts.push(`${x} ${waveY(layer, sea, x).toFixed(1)}`)
  }
  return parts.join('L')
}

// Foam curls riding each crest of a layer.
function foam(layer: Layer, sea: Sea, layerIndex: number): string {
  if (sea.foam === 0) return ''
  const period = W / layer.k
  const first = ((-layer.phase / (2 * Math.PI)) * period + period * 4) % period
  const out: string[] = []
  let n = 0
  for (let cx = first; cx < 2 * W; cx += period) {
    // At the lighter sea state only every other crest breaks.
    if (sea.foam < 1 && n % 2 === 1) {
      n++
      continue
    }
    const pts: string[] = []
    for (let dx = -34; dx <= 40; dx += 6) {
      pts.push(`${(cx + dx).toFixed(1)} ${(waveY(layer, sea, cx + dx) - 1.5).toFixed(1)}`)
    }
    const top = waveY(layer, sea, cx)
    const delay = ((n * 2.3 + layerIndex * 1.7) % 9).toFixed(1)
    out.push(
      `<g class="cap" style="animation-delay:-${delay}s">` +
        `<path d="M${pts.join('L')}" fill="none" stroke="#f4fbfa" stroke-width="${(2.2 + sea.foam).toFixed(1)}" stroke-linecap="round"/>` +
        `<circle cx="${(cx + 18).toFixed(1)}" cy="${(top - 6).toFixed(1)}" r="2.2" fill="#f4fbfa"/>` +
        `<circle cx="${(cx + 30).toFixed(1)}" cy="${(top - 3).toFixed(1)}" r="1.6" fill="#f4fbfa"/>` +
        `<circle cx="${(cx - 6).toFixed(1)}" cy="${(top - 4).toFixed(1)}" r="1.3" fill="#f4fbfa"/>` +
        `</g>`,
    )
    n++
  }
  return out.join('')
}

function waves(lvl: number, mode: Mode): string {
  const sea = SEAS[lvl] ?? SEAS[0]!
  const water = WATER[mode]
  const defs =
    `<defs><linearGradient id="front" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${water.front[0]}"/><stop offset="0.25" stop-color="${water.front[1]}"/><stop offset="1" stop-color="${water.front[2]}"/>` +
    `</linearGradient></defs>`
  const layers = LAYERS.map((layer, i) => {
    const drift = (layer.drift * sea.speed).toFixed(0)
    const bob = (layer.bob * (0.8 + sea.speed * 0.4)).toFixed(0)
    const lift = (2 + lvl * 2.5).toFixed(1)
    const fill = i < 2 ? water.fills[i] : 'url(#front)'
    const pts = crestPoints(layer, sea)
    const edge = `<path d="M${pts}" fill="none" stroke="${water.edges[i]}" stroke-opacity="${water.edgeOp[i]}" stroke-width="1.5"/>`
    const caps = i === 0 ? '' : foam(layer, sea, i)
    return (
      `<g class="bob" style="--lift:-${lift}px;animation-duration:${bob}s;animation-delay:-${i * 3}s">` +
      `<g class="drift" style="animation-duration:${drift}s">` +
      `<path d="M${pts}L${2 * W} ${H + 40}L0 ${H + 40}Z" fill="${fill}"/>` +
      edge +
      caps +
      `</g></g>`
    )
  }).join('')
  return defs + layers
}

// Pre-built so redraws are cheap: [mode][level].
const WAVES = {
  dark: [0, 1, 2, 3, 4].map(l => waves(l, 'dark')),
  light: [0, 1, 2, 3, 4].map(l => waves(l, 'light')),
}

// ---- sky ----

type Rgb = [number, number, number]
const hex = (h: string): Rgb => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb
const toHex = (c: Rgb) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => {
  const x = hex(a)
  const y = hex(b)
  return toHex([0, 1, 2].map(i => x[i]! + (y[i]! - x[i]!) * t) as Rgb)
}

// Sun altitude in degrees → sky top, middle, horizon.
const SKY_KEYS: [number, string, string, string][] = [
  [-18, '#050b18', '#08142a', '#0c1d38'],
  [-10, '#08142c', '#16204a', '#33295a'],
  [-4, '#182850', '#4c4274', '#c9684a'],
  [0, '#2c4a7e', '#a46a86', '#f39a5a'],
  [6, '#4a78b4', '#a3a6bc', '#f6c48a'],
  [14, '#3d82c8', '#79b4de', '#c4e4f0'],
  [90, '#2f78c4', '#6fb0e0', '#c4e4f0'],
]

function skyColors(altDeg: number): [string, string, string] {
  const first = SKY_KEYS[0]!
  if (altDeg <= first[0]) return [first[1], first[2], first[3]]
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const a = SKY_KEYS[i - 1]!
    const b = SKY_KEYS[i]!
    if (altDeg <= b[0]) {
      const t = (altDeg - a[0]) / (b[0] - a[0])
      return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)]
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1]!
  return [last[1], last[2], last[3]]
}

// Where a body at (alt, az) sits. The viewer faces south: east on the left.
function place(alt: number, az: number): { x: number; y: number } {
  const x = Math.max(70, Math.min(W - 70, W / 2 + (az / (Math.PI / 2)) * 620))
  const y = HORIZON - (alt / (Math.PI / 2)) * 640
  return { x, y }
}

// Deterministic star field.
const STARS = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) => {
    const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  return { x: r(1) * W, y: 30 + r(2) * 520, r: 0.6 + r(3) * 1.1, d: (r(4) * 10).toFixed(1) }
})

function sky(t: number): string {
  const sun = sunPosition(t, LAT, LNG)
  const moon = moonPosition(t, LAT, LNG)
  const altDeg = (sun.alt * 180) / Math.PI
  const [top, mid, low] = skyColors(altDeg)
  const parts: string[] = []

  parts.push(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${top}"/><stop offset="0.6" stop-color="${mid}"/><stop offset="0.86" stop-color="${low}"/>` +
      `</linearGradient>` +
      `<radialGradient id="sunglow"><stop offset="0" stop-color="#ffb070" stop-opacity="0.55"/><stop offset="0.35" stop-color="#ff9a55" stop-opacity="0.18"/><stop offset="1" stop-color="#ff9a55" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="moonglow"><stop offset="0" stop-color="#dfe9f2" stop-opacity="0.25"/><stop offset="1" stop-color="#dfe9f2" stop-opacity="0"/></radialGradient>` +
      `</defs>`,
  )
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`)

  // Stars fade in once the sun is 6° down.
  const starOpacity = Math.max(0, Math.min(1, (-altDeg - 6) / 8))
  if (starOpacity > 0) {
    parts.push(`<g opacity="${(starOpacity * 0.8).toFixed(2)}">`)
    for (const s of STARS) {
      parts.push(`<circle class="star" style="animation-delay:-${s.d}s" cx="${s.x.toFixed(0)}" cy="${s.y.toFixed(0)}" r="${s.r.toFixed(1)}" fill="#e8f0ff"/>`)
    }
    parts.push(`</g>`)
  }

  // Moon, with its real phase. Northern-hemisphere view: waxing lit on the right.
  if (moon.alt > -0.04) {
    const { x, y } = place(moon.alt, moon.az)
    const { fraction, waxing } = moonIllumination(t)
    const r = 20
    const day = altDeg > -2
    const k = Math.abs(1 - 2 * fraction) * r
    const first = waxing ? 1 : 0
    const back = waxing ? (fraction < 0.5 ? 0 : 1) : fraction < 0.5 ? 1 : 0
    parts.push(`<g opacity="${day ? 0.55 : 1}">`)
    if (!day) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="90" fill="url(#moonglow)"/>`)
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${day ? '#ffffff' : '#1f2c44'}" opacity="${day ? 0.12 : 0.85}"/>`)
    if (fraction > 0.02) {
      parts.push(
        `<path d="M${x.toFixed(1)} ${(y - r).toFixed(1)}A${r} ${r} 0 0 ${first} ${x.toFixed(1)} ${(y + r).toFixed(1)}` +
          `A${k.toFixed(1)} ${r} 0 0 ${back} ${x.toFixed(1)} ${(y - r).toFixed(1)}Z" fill="#eef2f4"/>`,
      )
    }
    parts.push(`</g>`)
  }

  // Sun: warm and large near the horizon, pale high up.
  if (sun.alt > -0.04) {
    const { x, y } = place(sun.alt, sun.az)
    const low = Math.max(0, Math.min(1, altDeg / 20))
    const color = mix('#ff8a3d', '#fff3d2', low)
    const glow = (260 - low * 110).toFixed(0)
    parts.push(`<g class="sun">`)
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${glow}" fill="url(#sunglow)" opacity="${(1 - low * 0.5).toFixed(2)}"/>`)
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(30 - low * 6).toFixed(0)}" fill="${color}"/>`)
    parts.push(`</g>`)
  }

  return parts.join('')
}

const STYLE = `<style>
.drift { animation: drift linear infinite; }
.bob { animation: bob ease-in-out infinite alternate; }
.cap { opacity: 0.55; animation: cap 9s ease-in-out infinite alternate; }
.star { animation: twinkle 11s ease-in-out infinite alternate; }
.sun { animation: breathe 30s ease-in-out infinite alternate; }
@keyframes drift { from { transform: translateX(0px); } to { transform: translateX(-${W}px); } }
@keyframes bob { from { transform: translateY(0px); } to { transform: translateY(var(--lift)); } }
@keyframes cap { from { opacity: 0.35; } to { opacity: 0.85; } }
@keyframes twinkle { from { opacity: 0.45; } to { opacity: 1; } }
@keyframes breathe { from { opacity: 0.9; } to { opacity: 1; } }
</style>`

export function scene(lvl: number, t: number): string {
  const mode = modeAt(t)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">` +
    STYLE +
    sky(t) +
    (WAVES[mode][lvl] ?? WAVES[mode][0]!) +
    `</svg>`
  )
}

const ALT = [
  'A calm sea with low, slow waves along the bottom',
  'A gentle swell rolling along the bottom of the screen',
  'Choppy waves rolling along the bottom of the screen',
  'Rough, tall waves rolling along the bottom of the screen',
  'Rough seas with whitecaps breaking along the bottom of the screen',
]

// ---------------------------------------------------------------------------

const HELP = [
  '/ocean               show the sea state and today’s sunrise and sunset',
  '/ocean sea 0-4       preview a sea state (4 = whitecaps)',
  '/ocean time 18:45    preview the sky at a Pacific time today',
  '/ocean live          back to the real context fill and the real time',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.log(unpainted)
    }
    await $.command.register({
      name: 'ocean',
      description: 'Ocean theme: preview sea states or sky times, or go back to live',
      argumentHint: '[sea 0-4 | time HH:MM | live]',
    })
    appliedMode = undefined
    const result = await next(e)
    await refreshSky($)
    await refreshSea($)
    ticker?.cancel()
    ticker = $.clock.every(SKY_TICK_MS, () => {
      void refreshSky($)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshSea($)
    return result
  })

  on('command.run', { command: 'ocean' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'sea') {
      const n = Number(arg)
      if (!Number.isInteger(n) || n < 0 || n > 4) return { text: 'Usage: /ocean sea 0-4' }
      await update($, forceLevel, () => n)
      await refreshSea($)
      return { text: `Previewing sea state: ${NAMES[n]}. /ocean live to go back.` }
    }
    if (verb === 'time') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(arg)
      if (!m) return { text: 'Usage: /ocean time HH:MM (24-hour, Pacific time)' }
      const t = pacificToday(await $.clock.now(), Number(m[1]), Number(m[2]))
      await update($, pinnedTime, () => t)
      await refreshSky($)
      return { text: `Previewing the sky at ${formatPacific(t)}. /ocean live to go back.` }
    }
    if (verb === 'live') {
      await update($, forceLevel, () => -1)
      await update($, pinnedTime, () => 0)
      await refreshSky($)
      await refreshSea($)
      return { text: 'Back to live: real context fill and real time.' }
    }
    const now = await $.clock.now()
    const { rise, set } = sunTimes(now, LAT, LNG)
    return {
      text: `${seaText}\nSunrise ${formatPacific(rise)} · sunset ${formatPacific(set)} (Los Angeles)\n\n${HELP}`,
    }
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    if (e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const lvl = Math.max(0, Math.min(4, await read($, level)))
    const t = (await read($, skyTime)) || (await $.clock.now())
    return <Svg source={scene(lvl, t)} alt={ALT[lvl] ?? 'Waves along the bottom of the screen'} isInteractive />
  })
}
