import dayjs from 'dayjs'
import { useMemo, useRef, useState } from 'react'
import { labelSpans, regimeColor } from '../lib/regime'

export interface RibbonDay {
  date: string
  label: string
}

interface Props {
  days: RibbonDay[]
  height?: number
  /** Called with the date under the pointer when the ribbon is clicked. */
  onSelect?: (date: string) => void
  /** Show year ticks under the ribbon. */
  showYears?: boolean
  ariaLabel?: string
}

/**
 * Every trading day as one thin vertical strip coloured by regime — the app's signature view.
 * One unit of width per day; spells are drawn as single rects so thousands of days stay cheap.
 */
export function RegimeRibbon({ days, height = 44, onSelect, showYears = true, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = days.length

  const spans = useMemo(() => {
    const index = new Map(days.map((d, i) => [d.date, i]))
    const raw = labelSpans(days, (d) => d.date, (d) => d.label)
    const xs = raw.map((s) => index.get(s.start) ?? 0)
    // Each spell runs until the next spell starts; the last one runs to the end.
    return raw.map((s, i) => ({ ...s, x: xs[i], w: (i + 1 < xs.length ? xs[i + 1] : n) - xs[i] }))
  }, [days, n])

  const years = useMemo(() => {
    const out: { year: number; x: number }[] = []
    let prev = ''
    days.forEach((d, i) => {
      const y = d.date.slice(0, 4)
      if (y !== prev) {
        out.push({ year: Number(y), x: i })
        prev = y
      }
    })
    // Thin out labels when many years are shown.
    const step = out.length > 12 ? 2 : 1
    return out.filter((_, i) => i % step === 0 || i === 0)
  }, [days])

  if (!n) return null

  const indexAt = (clientX: number) => {
    const el = ref.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const i = Math.floor(((clientX - r.left) / r.width) * n)
    return Math.max(0, Math.min(n - 1, i))
  }

  const hovered = hover !== null ? days[hover] : null
  const last = days[n - 1]

  return (
    <div className="relative select-none">
      <div
        ref={ref}
        role={onSelect ? 'button' : 'img'}
        tabIndex={onSelect ? 0 : undefined}
        aria-label={
          ariaLabel ??
          `Regime by day from ${days[0].date} to ${last.date}; latest ${last.label}.`
        }
        className="cell-focus relative overflow-hidden rounded-md"
        style={{ height, cursor: onSelect ? 'pointer' : 'default' }}
        onMouseMove={(e) => setHover(indexAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const i = indexAt(e.clientX)
          if (i !== null && onSelect) onSelect(days[i].date)
        }}
        onKeyDown={(e) => {
          if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onSelect(last.date)
          }
        }}
      >
        <svg
          viewBox={`0 0 ${n} 1`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          aria-hidden
        >
          {spans.map((s) => (
            <rect key={`${s.start}-${s.label}`} x={s.x} y={0} width={s.w} height={1} fill={regimeColor(s.label)} />
          ))}
          {hover !== null && <rect x={hover} y={0} width={Math.max(1, n / 400)} height={1} fill="#14161b" />}
        </svg>
        {/* Today marker */}
        <div
          aria-hidden
          className="absolute top-0 h-full"
          style={{ right: 0, width: 3, background: 'var(--ink)' }}
        />
      </div>

      {hovered && (
        <div
          className="pointer-events-none absolute -top-9 z-10 whitespace-nowrap rounded-md px-2 py-1 text-xs text-white shadow"
          style={{
            left: `${((hover ?? 0) / n) * 100}%`,
            transform: `translateX(${(hover ?? 0) / n > 0.85 ? '-100%' : (hover ?? 0) / n < 0.15 ? '0' : '-50%'})`,
            background: 'var(--ink)',
          }}
        >
          <span className="num">{dayjs(hovered.date).format('D MMM YYYY')}</span> ·{' '}
          <span style={{ color: regimeColor(hovered.label) }}>●</span> {hovered.label}
        </div>
      )}

      {showYears && (
        <div className="relative mt-1 h-4 text-[11px]" style={{ color: 'var(--ink-3)' }} aria-hidden>
          {years.map((y, i) => (
            <span
              key={y.year}
              // On narrow screens only every other label fits.
              className={`num absolute ${i % 2 && years.length > 5 ? 'hidden sm:inline' : ''}`}
              style={{ left: `${(y.x / n) * 100}%` }}
            >
              {y.year}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
