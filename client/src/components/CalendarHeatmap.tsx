import { Typography } from 'antd'
import dayjs from 'dayjs'
import { useMemo } from 'react'
import { regimeColor } from '../lib/regime'
import type { HistoryRow } from '../types/regime'

const CELL = 12
const GAP = 2
const STEP = CELL + GAP
const LEFT = 30 // weekday labels
const TOP = 16 // month labels
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri']
const MUTED = '#e6e8ec'

interface Props {
  rows: HistoryRow[]
  /** Regimes to colour; other days are shown muted. */
  regimes: string[]
  selectedDay: string | null
  onSelect: (date: string) => void
}

/** Weekday-by-week calendar per year (newest year first), each trading day coloured by regime. */
export function CalendarHeatmap({ rows, regimes, selectedDay, onSelect }: Props) {
  const years = useMemo(() => {
    const byYear = new Map<number, HistoryRow[]>()
    for (const r of rows) {
      const y = Number(r.date.slice(0, 4))
      if (!byYear.has(y)) byYear.set(y, [])
      byYear.get(y)!.push(r)
    }
    return [...byYear.entries()].sort((a, b) => b[0] - a[0])
  }, [rows])

  if (!rows.length) return null

  return (
    <div className="flex flex-col gap-5">
      {years.map(([year, yr]) => (
        <YearGrid
          key={year}
          year={year}
          rows={yr}
          regimes={regimes}
          selectedDay={selectedDay}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function YearGrid({
  year,
  rows,
  regimes,
  selectedDay,
  onSelect,
}: {
  year: number
  rows: HistoryRow[]
  regimes: string[]
  selectedDay: string | null
  onSelect: (d: string) => void
}) {
  const jan1 = dayjs(`${year}-01-01`)
  // Monday on or before Jan 1 is week 0.
  const origin = jan1.subtract((jan1.day() + 6) % 7, 'day')
  const weekOf = (d: string) => Math.floor(dayjs(d).diff(origin, 'day') / 7)
  const weeks = weekOf(`${year}-12-31`) + 1
  const width = LEFT + weeks * STEP
  const height = TOP + 5 * STEP

  const counts: Record<string, number> = {}
  rows.forEach((r) => (counts[r.smoothed_label] = (counts[r.smoothed_label] ?? 0) + 1))

  const months = Array.from({ length: 12 }, (_, m) => {
    const first = dayjs(`${year}-${String(m + 1).padStart(2, '0')}-01`)
    return { label: first.format('MMM'), x: LEFT + weekOf(first.format('YYYY-MM-DD')) * STEP }
  })

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-4">
        <span className="font-display text-lg font-semibold">{year}</span>
        <Typography.Text type="secondary" className="num text-xs">
          {['Calm', 'Stressed', 'Panic']
            .filter((n) => counts[n])
            .map((n) => `${n} ${counts[n]}d`)
            .join(' · ')}
        </Typography.Text>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${year}: regime by trading day`}
          onClick={(e) => {
            const d = (e.target as SVGElement).getAttribute('data-date')
            if (d) onSelect(d)
          }}
          style={{ cursor: 'pointer', display: 'block' }}
        >
          {months.map((m) => (
            <text key={m.label} x={m.x} y={10} fontSize={10} fill="#7a8191">
              {m.label}
            </text>
          ))}
          {WEEKDAYS.map((w, i) =>
            w ? (
              <text key={w} x={0} y={TOP + i * STEP + CELL - 2} fontSize={10} fill="#7a8191">
                {w}
              </text>
            ) : null,
          )}
          {rows.map((r) => {
            const dow = (dayjs(r.date).day() + 6) % 7 // Mon=0
            if (dow > 4) return null
            const on = regimes.includes(r.smoothed_label)
            const sel = r.date === selectedDay
            return (
              <rect
                key={r.date}
                data-date={r.date}
                x={LEFT + weekOf(r.date) * STEP}
                y={TOP + dow * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                fill={on ? regimeColor(r.smoothed_label) : MUTED}
                stroke={sel ? '#14161b' : 'none'}
                strokeWidth={sel ? 2 : 0}
              >
                <title>
                  {`${dayjs(r.date).format('ddd D MMM YYYY')} — ${r.smoothed_label}, day ${r.days_in_regime}`}
                </title>
              </rect>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
