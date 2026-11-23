// Low-precision sun and moon positions (the standard formulas popularized by
// SunCalc / Astronomy Answers). Good to well under a degree, which is plenty
// for drawing a sky.

const PI = Math.PI
const rad = PI / 180
const DAY_MS = 86400000
const J1970 = 2440588
const J2000 = 2451545
const OBLIQUITY = rad * 23.4397

const toJulian = (ms: number) => ms / DAY_MS - 0.5 + J1970
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS
const toDays = (ms: number) => toJulian(ms) - J2000

const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l))
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l))
// Azimuth measured from south, positive toward the west.
const azimuth = (H: number, phi: number, dec: number) =>
  Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
const altitude = (H: number, phi: number, dec: number) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw

const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d)
function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return M + C + rad * 102.9372 + PI
}
function sunCoords(d: number) {
  const L = eclipticLongitude(solarMeanAnomaly(d))
  return { dec: declination(L, 0), ra: rightAscension(L, 0) }
}

export type Body = { alt: number; az: number } // radians

export function sunPosition(ms: number, lat: number, lng: number): Body {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(ms)
  const c = sunCoords(d)
  const H = siderealTime(d, lw) - c.ra
  return { alt: altitude(H, phi, c.dec), az: azimuth(H, phi, c.dec) }
}

function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d)
  const M = rad * (134.963 + 13.064993 * d)
  const F = rad * (93.272 + 13.22935 * d)
  const l = L + rad * 6.289 * Math.sin(M)
  const b = rad * 5.128 * Math.sin(F)
  const dist = 385001 - 20905 * Math.cos(M)
  return { ra: rightAscension(l, b), dec: declination(l, b), dist }
}

export function moonPosition(ms: number, lat: number, lng: number): Body {
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(ms)
  const c = moonCoords(d)
  const H = siderealTime(d, lw) - c.ra
  return { alt: altitude(H, phi, c.dec), az: azimuth(H, phi, c.dec) }
}

// fraction lit 0..1; waxing true from new to full.
export function moonIllumination(ms: number): { fraction: number; waxing: boolean } {
  const d = toDays(ms)
  const s = sunCoords(d)
  const m = moonCoords(d)
  const sdist = 149598000
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  )
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi))
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  )
  return { fraction: (1 + Math.cos(inc)) / 2, waxing: angle < 0 }
}

// Sunrise and sunset (epoch ms) for the solar day around `ms`.
export function sunTimes(ms: number, lat: number, lng: number): { rise: number; set: number } {
  const J0 = 0.0009
  const lw = rad * -lng
  const phi = rad * lat
  const d = toDays(ms)
  const n = Math.round(d - J0 - lw / (2 * PI))
  const ds = J0 + lw / (2 * PI) + n
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L, 0)
  const transit = (a: number) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
  const noon = transit(ds)
  const h0 = rad * -0.833
  const w = Math.acos((Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)))
  const set = transit(J0 + (w + lw) / (2 * PI) + n)
  const rise = noon - (set - noon)
  return { rise: fromJulian(rise), set: fromJulian(set) }
}

// ---------------------------------------------------------------------------
// Pacific time without Intl: PST is UTC-8, PDT UTC-7 from the second Sunday of
// March at 2:00 local to the first Sunday of November at 2:00 local.

function nthSunday(year: number, month: number, nth: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((7 - first) % 7) + (nth - 1) * 7
}

export function pacificOffsetHours(ms: number): number {
  const year = new Date(ms).getUTCFullYear()
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 10) // 2:00 PST
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 9) // 2:00 PDT
  return ms >= start && ms < end ? -7 : -8
}

export function formatPacific(ms: number): string {
  const off = pacificOffsetHours(ms)
  const t = new Date(ms + off * 3600000)
  const h = t.getUTCHours()
  const m = t.getUTCMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} ${off === -7 ? 'PDT' : 'PST'}`
}

// Today's date in Pacific time at hh:mm, as epoch ms.
export function pacificToday(now: number, hh: number, mm: number): number {
  const off = pacificOffsetHours(now)
  const t = new Date(now + off * 3600000)
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hh, mm) - off * 3600000
}
