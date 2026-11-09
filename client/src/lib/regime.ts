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
  return `${x > 0 ? '+' : ''}${s}%`
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
