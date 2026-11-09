import { Tooltip } from 'antd'
import { niceTicks, regimeColor, signedPct } from '../lib/regime'
import type { RiskStats } from '../types/regime'

interface Props {
  stats: Record<string, RiskStats>
  names: readonly string[]
}

const ROW_H = 44
const LABEL_W = 90
const WIDTH = 1000
const PAD_R = 16

/**
 * Box-plot-style view of next-day UVXY returns per regime:
 * whiskers 1st–99th percentile, thin box 5th–95th, thick box 25th–75th, median tick.
 */
export function ReturnBoxPlot({ stats, names }: Props) {
  const rows = names.filter((n) => stats[n]?.count)
  if (!rows.length) return null
  const lo = Math.min(...rows.map((n) => stats[n].p1 ?? 0), 0)
  const hi = Math.max(...rows.map((n) => stats[n].p99 ?? 0), 0)
  const plotW = WIDTH - LABEL_W - PAD_R
  const x = (v: number) => LABEL_W + ((v - lo) / (hi - lo || 1)) * plotW
  const height = rows.length * ROW_H + 28
  const ticks = niceTicks(lo, hi)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      width="100%"
      role="img"
      aria-label="Next-day UVXY return distribution per regime"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={0} y2={height - 20} stroke={t === 0 ? '#8c8c8c' : '#f0f0f0'} />
          <text x={x(t)} y={height - 6} fontSize={11} fill="#8c8c8c" textAnchor="middle">
            {signedPct(t, 0)}
          </text>
        </g>
      ))}
      {rows.map((n, i) => {
        const s = stats[n]
        const cy = i * ROW_H + ROW_H / 2
        const color = regimeColor(n)
        const tip = `${n}: median ${signedPct(s.median)}, 25–75th ${signedPct(s.p25)} to ${signedPct(
          s.p75,
        )}, 5–95th ${signedPct(s.p5)} to ${signedPct(s.p95)}, 1–99th ${signedPct(s.p1)} to ${signedPct(
          s.p99,
        )}`
        return (
          <Tooltip key={n} title={tip}>
            <g>
              <rect x={0} y={cy - ROW_H / 2} width={WIDTH} height={ROW_H} fill="transparent" />
              <text x={LABEL_W - 10} y={cy + 4} fontSize={12} textAnchor="end" fill="#1f2937">
                {n}
              </text>
              <line x1={x(s.p1!)} x2={x(s.p99!)} y1={cy} y2={cy} stroke={color} strokeWidth={2} />
              {[s.p1!, s.p99!].map((v) => (
                <line key={v} x1={x(v)} x2={x(v)} y1={cy - 6} y2={cy + 6} stroke={color} strokeWidth={2} />
              ))}
              <rect
                x={x(s.p5!)}
                y={cy - 6}
                width={x(s.p95!) - x(s.p5!)}
                height={12}
                rx={4}
                fill={color}
                fillOpacity={0.3}
              />
              <rect
                x={x(s.p25!)}
                y={cy - 11}
                width={x(s.p75!) - x(s.p25!)}
                height={22}
                rx={4}
                fill={color}
                fillOpacity={0.85}
              />
              <line
                x1={x(s.median!)}
                x2={x(s.median!)}
                y1={cy - 13}
                y2={cy + 13}
                stroke="#111827"
                strokeWidth={2}
              />
            </g>
          </Tooltip>
        )
      })}
    </svg>
  )
}
