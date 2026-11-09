import type { ComparisonRow, RegimeName } from '../types/regime'

export const REGIME_NAMES: RegimeName[] = ['Calm', 'Stressed', 'Panic']

/** Regime colours from the spec — use everywhere. */
export const REGIME_COLORS: Record<RegimeName, string> = {
  Calm: '#22C55E',
  Stressed: '#F59E0B',
  Panic: '#EF4444',
}

/** Translucent fills for background bands. */
export const REGIME_BAND_FILL_OPACITY = 0.18

export const NOT_ADVICE =
  'For information only. This is not investment advice and does not recommend any trade.'

export const SIZE_NOT_DIRECTION = 'Describes the size of likely moves, not their direction.'

export const FEATURE_LABELS: Record<string, string> = {
  contango: 'Contango (VX2/VX1 − 1)',
  vix_ratio: 'VIX / VIX3M',
  log_vvix: 'VVIX',
  rv20: '20-day realized vol',
  vix_pct_252: 'VIX 1-year percentile',
  d_contango_5: 'Contango 5-day change',
}

export function regimeColor(name: string): string {
  return REGIME_COLORS[name as RegimeName] ?? '#8c8c8c'
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function signedPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  const s = (x * 100).toFixed(digits)
  if (Number(s) === 0) return `${(0).toFixed(digits)}%` // no "-0.0%"
  return `${x > 0 ? '+' : ''}${s}%`
}

/** Price with thousands separators (split-adjusted UVXY can be in the hundreds of thousands). */
export function price(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return x.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

export function num(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return x.toFixed(digits)
}

export interface Span {
  label: string
  start: string
  end: string
}

/**
 * Contiguous runs of the same label. Each span ends at the first date of the next run so
 * background bands tile without gaps on a category axis.
 */
export function labelSpans<T>(
  rows: T[],
  dateOf: (r: T) => string,
  labelOf: (r: T) => string,
): Span[] {
  const spans: Span[] = []
  for (let i = 0; i < rows.length; i++) {
    const label = labelOf(rows[i])
    const date = dateOf(rows[i])
    const last = spans[spans.length - 1]
    if (last && last.label === label) {
      last.end = date
    } else {
      if (last) last.end = date
      spans.push({ label, start: date, end: date })
    }
  }
  return spans
}

/** Display value for a model feature (VVIX is modelled as ln(VVIX)). */
export function featureDisplayValue(name: string, value: number | null): number | null {
  if (value === null) return null
  return name === 'log_vvix' ? Math.exp(value) : value
}

export function formatFeature(name: string, value: number | null): string {
  const v = featureDisplayValue(name, value)
  if (v === null) return '—'
  switch (name) {
    case 'contango':
    case 'd_contango_5':
      return signedPct(v, 2)
    case 'rv20':
    case 'vix_pct_252':
      return pct(v, 1)
    case 'log_vvix':
      return v.toFixed(1)
    default:
      return v.toFixed(3)
  }
}

/** Axis ticks for a returns axis (step 5/10/20%), always a subset of [lo, hi]. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  const step = span > 0.6 ? 0.2 : span > 0.3 ? 0.1 : 0.05
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
    out.push(Math.round(t * 1000) / 1000)
  }
  return out
}

export function fmtCheck(check: string, x: number | null) {
  if (x === null) return '—'
  if (/flips/i.test(check)) return num(x, 1)
  if (/ratio/i.test(check)) return `${num(x, 2)}×`
  if (/next-day mean/i.test(check)) return signedPct(x, 2)
  return pct(x, 1)
}

/** "Clearly better" needs the HMM to win at least 3/4 of the decided (non-tie) checks. */
export function verdict(rows: ComparisonRow[]) {
  const hmm = rows.filter((r) => r.better === 'hmm').length
  const base = rows.filter((r) => r.better === 'baseline').length
  const decided = hmm + base
  return { hmm, base, clearlyBetter: decided > 0 && hmm / decided >= 0.75 }
}

/** Regime names present in a probability map, in canonical order (Calm → Panic) first. */
export function orderedNames(keys: Iterable<string>): string[] {
  const ks = [...keys]
  const known = REGIME_NAMES.filter((n) => ks.includes(n))
  return [...known, ...ks.filter((k) => !known.includes(k as RegimeName))]
}

/** Most severe regime present (Panic if available, else the last in canonical order). */
export function mostSevere(keys: Iterable<string>): string | undefined {
  const names = orderedNames(keys)
  return names.includes('Panic') ? 'Panic' : names[names.length - 1]
}

// ---------------------------------------------------------------- plain-English helpers

/** "about 1 in 30 days" for a daily probability. */
export function oneIn(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p) || p <= 0) return 'almost never'
  const n = Math.round(1 / p)
  if (n <= 1) return 'most days'
  return `about 1 in ${n} days`
}

export function days(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const r = Math.round(n)
  return `${r} trading day${r === 1 ? '' : 's'}`
}

/** How unusual a z-score is, in words. */
export function zWords(z: number): string {
  const a = Math.abs(z)
  const dir = z >= 0 ? 'above' : 'below'
  if (a < 0.5) return 'about normal'
  if (a < 1.5) return `${dir} normal`
  if (a < 2.5) return `well ${dir} normal`
  return `extremely ${dir} normal`
}

// ---------------------------------------------------------------- CSV

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------- explorer URL state

export type ExplorerView = 'calendar' | 'table' | 'chart'

export interface ExplorerFilters {
  start: string
  end: string
  regimes: RegimeName[]
  view: ExplorerView
  day: string | null
}

const VIEWS: ExplorerView[] = ['calendar', 'table', 'chart']

export function parseExplorerParams(
  params: URLSearchParams,
  defaults: { start: string; end: string },
): ExplorerFilters {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const start = params.get('start') ?? ''
  const end = params.get('end') ?? ''
  const regimes = (params.get('regimes') ?? '')
    .split(',')
    .filter((r): r is RegimeName => (REGIME_NAMES as string[]).includes(r))
  const view = params.get('view') as ExplorerView
  const day = params.get('day') ?? ''
  return {
    start: iso.test(start) ? start : defaults.start,
    end: iso.test(end) ? end : defaults.end,
    regimes: regimes.length ? regimes : [...REGIME_NAMES],
    view: VIEWS.includes(view) ? view : 'calendar',
    day: iso.test(day) ? day : null,
  }
}

export function explorerHref(f: Partial<ExplorerFilters>): string {
  const p = new URLSearchParams()
  if (f.start) p.set('start', f.start)
  if (f.end) p.set('end', f.end)
  if (f.regimes && f.regimes.length && f.regimes.length < REGIME_NAMES.length) {
    p.set('regimes', f.regimes.join(','))
  }
  if (f.view && f.view !== 'calendar') p.set('view', f.view)
  if (f.day) p.set('day', f.day)
  const qs = p.toString()
  return `/explorer${qs ? `?${qs}` : ''}`
}
