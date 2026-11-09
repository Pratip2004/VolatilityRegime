import { Button, Space, Typography } from 'antd'
import dayjs from 'dayjs'
import { memo, useMemo } from 'react'
import { REGIME_NAMES, regimeColor } from '../lib/regime'
import type { HistoryRow } from '../types/regime'

const CELL = 12
const GAP = 2
const STEP = CELL + GAP
const LEFT = 30 // weekday labels
const TOP = 16 // month labels
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri']
const MUTED = '#e6e8ec'
const FULL_YEAR = 245 // fewer trading days than this = partial year in the range

interface Props {
  rows: HistoryRow[]
  /** Regimes to colour; other days are shown muted. */
  regimes: string[]
  selectedDay: string | null
  onSelect: (date: string) => void
}

interface Cell {
  date: string
  label: string
  dayInSpell: number
  x: number
  y: number
}

/** Weekday-by-week calendar per year (newest year first), each trading day coloured by regime. */
export function CalendarHeatmap({ rows, regimes, selectedDay, onSelect }: Props) {
  // Positions depend only on the dates, so compute them once per data set.
  const years = useMemo(() => {
    const byYear = new Map<number, HistoryRow[]>()
    for (const r of rows) {
      const y = Number(r.date.slice(0, 4))
      if (!byYear.has(y)) byYear.set(y, [])
      byYear.get(y)!.push(r)
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, yr]) => layoutYear(year, yr))
  }, [rows])

  if (!rows.length) return null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Space size="middle" wrap>
          {REGIME_NAMES.map((n) => (
            <Typography.Text key={n} type="secondary" className="text-xs">
              <span
                aria-hidden
                className="mr-1 inline-block align-middle"
                style={{ width: 10, height: 10, borderRadius: 2, background: regimeColor(n) }}
              />
              {n}
            </Typography.Text>
          ))}
          <Typography.Text type="secondary" className="text-xs">
            <span
              aria-hidden
              className="mr-1 inline-block align-middle"
              style={{ width: 10, height: 10, borderRadius: 2, background: MUTED }}
            />
            filtered out
          </Typography.Text>
        </Space>
        {years.length > 3 && (
          <Space size={2} wrap aria-label="Jump to year">
            {years.map((y) => (
              <Button
                key={y.year}
                size="small"
                type="text"
                className="num"
                onClick={() =>
                  document.getElementById(`cal-${y.year}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {y.year}
              </Button>
            ))}
          </Space>
        )}
      </div>
      {years.map((y) => (
        <YearGrid
          key={y.year}
          {...y}
          regimes={regimes}
          // Only the year that holds the selection re-renders when it changes.
          selectedDay={selectedDay?.startsWith(String(y.year)) ? selectedDay : null}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function layoutYear(year: number, rows: HistoryRow[]) {
  const jan1 = dayjs(`${year}-01-01`)
  const origin = jan1.subtract((jan1.day() + 6) % 7, 'day') // Monday on/before Jan 1 = week 0
  const weekOf = (d: dayjs.Dayjs) => Math.floor(d.diff(origin, 'day') / 7)
  const cells: Cell[] = []
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const d = dayjs(r.date)
    const dow = (d.day() + 6) % 7 // Mon=0
    counts[r.smoothed_label] = (counts[r.smoothed_label] ?? 0) + 1
    if (dow > 4) continue
    cells.push({
      date: r.date,
      label: r.smoothed_label,
      dayInSpell: r.days_in_regime,
      x: LEFT + weekOf(d) * STEP,
      y: TOP + dow * STEP,
    })
  }
  const months = Array.from({ length: 12 }, (_, m) => {
    const first = dayjs(`${year}-${String(m + 1).padStart(2, '0')}-01`)
    return { label: first.format('MMM'), x: LEFT + weekOf(first) * STEP }
  })
  const width = LEFT + (weekOf(dayjs(`${year}-12-31`)) + 1) * STEP
  return { year, cells, counts, months, width, total: rows.length }
}

const YearGrid = memo(function YearGrid({
  year,
  cells,
  counts,
  months,
  width,
  total,
  regimes,
  selectedDay,
  onSelect,
}: ReturnType<typeof layoutYear> & {
  regimes: string[]
  selectedDay: string | null
  onSelect: (d: string) => void
}) {
  const height = TOP + 5 * STEP
  const sel = selectedDay ? cells.find((c) => c.date === selectedDay) : undefined
  return (
    <div id={`cal-${year}`} style={{ scrollMarginTop: 96 }}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-4">
        <span className="font-display text-lg font-semibold">{year}</span>
        <Typography.Text type="secondary" className="num text-xs">
          {REGIME_NAMES.filter((n) => counts[n])
            .map((n) => `${n} ${counts[n]}d`)
            .join(' · ')}
          {total < FULL_YEAR && ` · ${total} days in range`}
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
          {cells.map((c) => (
            <rect
              key={c.date}
              data-date={c.date}
              x={c.x}
              y={c.y}
              width={CELL}
              height={CELL}
              rx={2}
              fill={regimes.includes(c.label) ? regimeColor(c.label) : MUTED}
            >
              <title>{`${dayjs(c.date).format('ddd D MMM YYYY')} — ${c.label}, day ${c.dayInSpell}`}</title>
            </rect>
          ))}
          {sel && (
            <rect
              x={sel.x - 1}
              y={sel.y - 1}
              width={CELL + 2}
              height={CELL + 2}
              rx={3}
              fill="none"
              stroke="#14161b"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  )
})
