import { regimeColor, signedPct } from '../lib/regime'
import type { RiskStats } from '../types/regime'

interface Props {
  risk: RiskStats
  regime: string
  /** Shared axis bounds so several strips line up. */
  domain?: [number, number]
  labels?: boolean
}

/**
 * Next-day UVXY move for one regime on a horizontal axis: whisker = 1st–99th percentile,
 * light bar = 5th–95th, solid bar = middle half (25th–75th), tick = median.
 */
export function RangeStrip({ risk, regime, domain = [-0.25, 0.35], labels = true }: Props) {
  const { p1, p5, p25, median, p75, p95, p99 } = risk
  if ([p1, p5, p25, median, p75, p95, p99].some((v) => v === null || v === undefined)) return null
  const [lo, hi] = domain
  const x = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`
  const w = (a: number, b: number) =>
    `${((Math.min(hi, b) - Math.max(lo, a)) / (hi - lo)) * 100}%`
  const c = regimeColor(regime)
  return (
    <div
      role="img"
      aria-label={`${regime}: next-day UVXY usually ${signedPct(p25)} to ${signedPct(p75)}; 1-in-100 days ${signedPct(p1)} or ${signedPct(p99)}`}
    >
      <div className="relative h-8">
        <div className="absolute top-1/2 h-px w-full" style={{ background: 'var(--rule)' }} />
        <div className="absolute top-0 h-full w-px" style={{ left: x(0), background: '#b8bdc7' }} />
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2"
          style={{ left: x(p1!), width: w(p1!, p99!), background: c }}
        />
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm"
          style={{ left: x(p5!), width: w(p5!, p95!), background: c, opacity: 0.3 }}
        />
        <div
          className="absolute top-1/2 h-5 -translate-y-1/2 rounded"
          style={{ left: x(p25!), width: w(p25!, p75!), background: c }}
        />
        <div
          className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2"
          style={{ left: x(median!), background: 'var(--ink)' }}
        />
      </div>
      {labels && (
        <div className="num relative h-4 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          <span className="absolute -translate-x-1/2" style={{ left: x(p1!) }}>
            {signedPct(p1, 0)}
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: x(0) }}>
            0
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: x(p99!) }}>
            {signedPct(p99, 0)}
          </span>
        </div>
      )}
    </div>
  )
}
