import { DownloadOutlined } from '@ant-design/icons'
import { Button, DatePicker, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType, TimeRangePickerProps } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useRegimeHistory, useRegimeInsights } from '../api/regime'
import { CalendarHeatmap } from '../components/CalendarHeatmap'
import { DayDrawer } from '../components/DayDrawer'
import { PageState } from '../components/PageState'
import { PageHeader, RegimeTag } from '../components/RegimeBits'
import { RegimeRibbon } from '../components/RegimeRibbon'
import {
  REGIME_BAND_FILL_OPACITY,
  REGIME_NAMES,
  downloadCsv,
  labelSpans,
  num,
  parseExplorerParams,
  pct,
  price,
  regimeColor,
  signedPct,
  toCsv,
  type ExplorerFilters,
  type ExplorerView,
  type Span,
} from '../lib/regime'
import type { HistoryRow, RegimeEpisode, RegimeName } from '../types/regime'

const { RangePicker } = DatePicker
const { Text } = Typography

const AXIS_TICK = { fontSize: 11, fill: '#7a8191' }
const GRID = '#eef0f3'

export default function RegimeExplorerPage() {
  const q = useRegimeHistory()
  const insights = useRegimeInsights()
  const [params, setParams] = useSearchParams()

  const all = useMemo(() => q.data?.rows ?? [], [q.data])
  const first = all[0]?.date ?? '2008-01-01'
  const last = all[all.length - 1]?.date ?? dayjs().format('YYYY-MM-DD')
  const f = parseExplorerParams(params, {
    start: dayjs(last).subtract(3, 'year').format('YYYY-MM-DD'),
    end: last,
  })

  // Stable references so memoised children (calendar years) don't re-render needlessly.
  const regimesKey = f.regimes.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectedRegimes = useMemo(() => f.regimes, [regimesKey])

  const update = (patch: Partial<ExplorerFilters>) => {
    const next = { ...f, ...patch }
    const p = new URLSearchParams()
    p.set('start', next.start)
    p.set('end', next.end)
    if (next.regimes.length < REGIME_NAMES.length) p.set('regimes', next.regimes.join(','))
    if (next.view !== 'calendar') p.set('view', next.view)
    if (next.day) p.set('day', next.day)
    setParams(p, { replace: true })
  }

  const inRange = useMemo(() => all.filter((r) => r.date >= f.start && r.date <= f.end), [all, f.start, f.end])
  const shown = useMemo(
    () => inRange.filter((r) => f.regimes.includes(r.smoothed_label)),
    [inRange, f.regimes],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    inRange.forEach((r) => (c[r.smoothed_label] = (c[r.smoothed_label] ?? 0) + 1))
    return c
  }, [inRange])

  const dayIndex = f.day ? all.findIndex((r) => r.date === f.day) : -1
  const dayRow = dayIndex >= 0 ? all[dayIndex] : null
  const prevDate = dayIndex > 0 ? all[dayIndex - 1].date : null
  const nextDate = dayIndex >= 0 && dayIndex < all.length - 1 ? all[dayIndex + 1].date : null
  const openDay = useCallback(
    (day: string) => {
      const p = new URLSearchParams(params)
      p.set('day', day)
      setParams(p, { replace: true })
    },
    [params, setParams],
  )
  const ribbonDays = useMemo(
    () => inRange.map((r) => ({ date: r.date, label: r.smoothed_label })),
    [inRange],
  )
  const ribbonColor = useCallback(
    (label: string) => ((selectedRegimes as string[]).includes(label) ? regimeColor(label) : '#e6e8ec'),
    [selectedRegimes],
  )
  const dayEpisode =
    f.day && insights.data
      ? insights.data.episodes.find((e) => e.start <= f.day! && e.end >= f.day!) ?? null
      : null

  const presets: TimeRangePickerProps['presets'] = [
    { label: 'Last month', value: [dayjs(last).subtract(1, 'month'), dayjs(last)] },
    { label: 'Last 3 months', value: [dayjs(last).subtract(3, 'month'), dayjs(last)] },
    { label: '1Y', value: [dayjs(last).subtract(1, 'year'), dayjs(last)] },
    { label: '3Y', value: [dayjs(last).subtract(3, 'year'), dayjs(last)] },
    { label: '5Y', value: [dayjs(last).subtract(5, 'year'), dayjs(last)] },
    { label: 'All', value: [dayjs(first), dayjs(last)] },
  ]

  const toggleRegime = (n: RegimeName, on: boolean) => {
    const next = on ? [...f.regimes, n] : f.regimes.filter((r) => r !== n)
    if (next.length) update({ regimes: REGIME_NAMES.filter((r) => next.includes(r)) })
  }

  const exportCsv = () => {
    const rows = shown.map((r) => ({
      date: r.date,
      regime: r.smoothed_label,
      day_of_spell: r.days_in_regime,
      p_calm: r.probabilities.Calm?.toFixed(4),
      p_stressed: r.probabilities.Stressed?.toFixed(4),
      p_panic: r.probabilities.Panic?.toFixed(4),
      vix: r.vix,
      contango: r.contango.toFixed(4),
      uvxy_close: r.uvxy_close,
      uvxy_next_day_return: r.uvxy_next_ret?.toFixed(4) ?? '',
      in_sample: r.in_sample,
    }))
    downloadCsv(
      `regimes_${f.start}_${f.end}.csv`,
      toCsv(rows, Object.keys(rows[0] ?? { date: '' })),
    )
  }

  return (
    <div>
      <PageHeader
        title="Regime explorer"
        subtitle="Every trading day's regime. Filter by regime and date, then click a day for details."
      />

      <div className="panel sticky top-0 z-20 mb-4 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Space size={6} wrap aria-label="Filter by regime">
            {REGIME_NAMES.map((n) => {
              const on = f.regimes.includes(n)
              return (
                <Tag.CheckableTag
                  key={n}
                  checked={on}
                  onChange={(c) => toggleRegime(n, c)}
                  style={{
                    border: `1px solid ${on ? regimeColor(n) : 'var(--rule)'}`,
                    background: on ? `${regimeColor(n)}1f` : 'transparent',
                    color: 'var(--ink)',
                    padding: '3px 10px',
                    fontSize: 13,
                  }}
                  data-testid={`filter-${n}`}
                >
                  <span style={{ color: on ? regimeColor(n) : 'var(--ink-3)' }}>●</span> {n}{' '}
                  <span className="num" style={{ color: 'var(--ink-3)' }}>
                    {counts[n] ?? 0}
                  </span>
                </Tag.CheckableTag>
              )
            })}
          </Space>
          <RangePicker
            value={[dayjs(f.start), dayjs(f.end)]}
            presets={presets}
            allowClear={false}
            onChange={(v) =>
              v?.[0] && v[1] && update({ start: v[0].format('YYYY-MM-DD'), end: v[1].format('YYYY-MM-DD') })
            }
            disabledDate={(d) => d.isAfter(dayjs(last)) || d.isBefore(dayjs(first))}
            aria-label="Date range"
          />
          <Segmented<ExplorerView>
            value={f.view}
            onChange={(view) => update({ view })}
            options={[
              { label: 'Calendar', value: 'calendar' },
              { label: 'Table', value: 'table' },
              { label: 'Chart', value: 'chart' },
            ]}
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!shown.length}>
            Export CSV
          </Button>
        </div>
      </div>

      <PageState
        isLoading={q.isLoading}
        error={q.error}
        isEmpty={!q.isLoading && all.length === 0}
        onRetry={() => q.refetch()}
      >
        <div className="panel mb-4 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <Text data-testid="range-summary">
              <span className="num">{inRange.length.toLocaleString()}</span> trading days from{' '}
              <span className="num">{dayjs(f.start).format('D MMM YYYY')}</span> to{' '}
              <span className="num">{dayjs(f.end).format('D MMM YYYY')}</span>
              {shown.length !== inRange.length && (
                <>
                  {' '}· showing <span className="num">{shown.length.toLocaleString()}</span>
                </>
              )}
            </Text>
            <Space size="middle" wrap>
              {REGIME_NAMES.map((n) => (
                <Text key={n} type="secondary">
                  <span style={{ color: regimeColor(n) }}>●</span> {n}{' '}
                  <span className="num">{pct((counts[n] ?? 0) / Math.max(inRange.length, 1), 0)}</span>
                </Text>
              ))}
            </Space>
          </div>
          <RegimeRibbon
            days={ribbonDays}
            height={28}
            onSelect={openDay}
            colorOf={ribbonColor}
            markLatest={f.end >= last}
          />
        </div>

        {inRange.length === 0 ? (
          <div className="panel p-8 text-center">
            <Text type="secondary">No trading days in this range. Pick a wider range above.</Text>
          </div>
        ) : f.view === 'calendar' ? (
          <div className="panel p-4">
            <CalendarHeatmap
              rows={inRange}
              regimes={selectedRegimes}
              selectedDay={f.day}
              onSelect={openDay}
            />
          </div>
        ) : f.view === 'table' ? (
          <DayTable rows={shown} onSelect={openDay} />
        ) : (
          <ChartView rows={inRange} regimes={selectedRegimes} />
        )}

        {shown.length === 0 && inRange.length > 0 && (
          <Text type="secondary" className="mt-2 block">
            No {f.regimes.join(' / ')} days in this range.
          </Text>
        )}
      </PageState>

      <DayDrawer
        row={dayRow}
        episode={dayEpisode as RegimeEpisode | null}
        onClose={() => update({ day: null })}
        onNavigate={openDay}
        prevDate={prevDate}
        nextDate={nextDate}
        oosStart={insights.data?.oos_start}
      />
    </div>
  )
}

function ProbBar({ p }: { p: Record<string, number> }) {
  return (
    <div className="flex h-2 w-24 overflow-hidden rounded-sm" aria-hidden>
      {REGIME_NAMES.map((n) => (
        <div key={n} style={{ width: `${(p[n] ?? 0) * 100}%`, background: regimeColor(n) }} />
      ))}
    </div>
  )
}

function DayTable({ rows, onSelect }: { rows: HistoryRow[]; onSelect: (d: string) => void }) {
  const data = useMemo(() => [...rows].reverse(), [rows])
  const columns: TableColumnsType<HistoryRow> = [
    {
      title: 'Date',
      dataIndex: 'date',
      sorter: (a, b) => a.date.localeCompare(b.date),
      render: (d: string) => <span className="num">{dayjs(d).format('ddd D MMM YYYY')}</span>,
    },
    {
      title: 'Regime',
      dataIndex: 'smoothed_label',
      render: (n: string) => <RegimeTag name={n} />,
    },
    {
      title: 'Day of spell',
      dataIndex: 'days_in_regime',
      align: 'right',
      sorter: (a, b) => a.days_in_regime - b.days_in_regime,
      render: (x: number) => <span className="num">{x}</span>,
    },
    {
      title: 'Probabilities',
      key: 'p',
      render: (_, r) => (
        <Space size={8}>
          <ProbBar p={r.probabilities} />
          <span className="num text-xs" style={{ color: 'var(--ink-3)' }}>
            {pct(r.probabilities[r.smoothed_label], 0)}
          </span>
        </Space>
      ),
    },
    {
      title: 'VIX',
      dataIndex: 'vix',
      align: 'right',
      sorter: (a, b) => a.vix - b.vix,
      render: (x: number) => <span className="num">{num(x)}</span>,
    },
    {
      title: 'Contango',
      dataIndex: 'contango',
      align: 'right',
      sorter: (a, b) => a.contango - b.contango,
      render: (x: number) => <span className="num">{signedPct(x, 1)}</span>,
    },
    {
      title: 'UVXY (adj.)',
      dataIndex: 'uvxy_close',
      align: 'right',
      render: (x: number | null) => <span className="num">{price(x)}</span>,
    },
    {
      title: 'UVXY next day',
      dataIndex: 'uvxy_next_ret',
      align: 'right',
      sorter: (a, b) => (a.uvxy_next_ret ?? -Infinity) - (b.uvxy_next_ret ?? -Infinity),
      render: (x: number | null) => <span className="num">{signedPct(x)}</span>,
    },
  ]
  return (
    <div className="panel">
      <Table<HistoryRow>
        rowKey="date"
        size="small"
        columns={columns}
        dataSource={data}
        pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (t) => `${t.toLocaleString()} days` }}
        onRow={(r) => ({
          onClick: () => onSelect(r.date),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(r.date)
            }
          },
          tabIndex: 0,
          className: 'cell-focus',
          style: { cursor: 'pointer' },
        })}
        scroll={{ x: true }}
      />
    </div>
  )
}

function bands(spans: Span[]) {
  // Recharts 2 only picks up ReferenceArea elements that are direct chart children.
  return spans.map((s) => (
    <ReferenceArea
      key={`${s.start}-${s.label}`}
      x1={s.start}
      x2={s.end}
      fill={regimeColor(s.label)}
      fillOpacity={REGIME_BAND_FILL_OPACITY}
      strokeOpacity={0}
      ifOverflow="hidden"
    />
  ))
}

const fmtDate = (d: string) => dayjs(d).format('MMM YY')

function ChartTip({
  active,
  payload,
  kind,
}: {
  active?: boolean
  payload?: { payload: HistoryRow }[]
  kind: 'vix' | 'probs' | 'uvxy'
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="rounded-md px-3 py-2 text-xs text-white shadow" style={{ background: 'var(--ink)' }}>
      <div className="num mb-1">{dayjs(r.date).format('D MMM YYYY')}</div>
      <div>
        <span style={{ color: regimeColor(r.smoothed_label) }}>●</span> {r.smoothed_label}
      </div>
      {kind === 'vix' && <div className="num">VIX {num(r.vix)}</div>}
      {kind === 'uvxy' && <div className="num">UVXY {price(r.uvxy_close)}</div>}
      {kind === 'probs' &&
        REGIME_NAMES.map((n) => (
          <div key={n} className="num">
            {n} {pct(r.probabilities[n])}
          </div>
        ))}
    </div>
  )
}

function ChartView({ rows, regimes }: { rows: HistoryRow[]; regimes: string[] }) {
  // Bands only for the regimes selected in the filter.
  const spans = useMemo(
    () =>
      labelSpans(rows, (r) => r.date, (r) => r.smoothed_label).filter((sp) => regimes.includes(sp.label)),
    [rows, regimes],
  )
  const data = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        p_calm: r.probabilities.Calm ?? 0,
        p_stressed: r.probabilities.Stressed ?? 0,
        p_panic: r.probabilities.Panic ?? 0,
      })),
    [rows],
  )
  const margin = { top: 8, right: 16, left: 0, bottom: 0 }
  return (
    <Space direction="vertical" size="middle" className="w-full">
      <div className="panel p-4">
        <div className="eyebrow mb-2">VIX, shaded by regime</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} syncId="explorer" margin={margin}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={48} tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} width={56} domain={[0, 'auto']} />
            {bands(spans)}
            <Tooltip content={<ChartTip kind="vix" />} />
            <Line dataKey="vix" stroke="#14161b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="panel p-4">
        <div className="eyebrow mb-2">Model probabilities (no hindsight)</div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} syncId="explorer" margin={margin}>
            <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={48} tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} width={56} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Tooltip content={<ChartTip kind="probs" />} />
            {REGIME_NAMES.map((n) => (
              <Area
                key={n}
                dataKey={`p_${n.toLowerCase()}`}
                stackId="p"
                stroke="none"
                fill={regimeColor(n)}
                fillOpacity={0.85}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="panel p-4">
        <div className="eyebrow mb-2">UVXY price (split-adjusted, log scale), shaded by regime</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} syncId="explorer" margin={margin}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={48} tick={AXIS_TICK} />
            <YAxis
              scale="log"
              domain={['auto', 'auto']}
              allowDataOverflow
              tick={AXIS_TICK}
              width={56}
              tickFormatter={(v: number) =>
                new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
              }
            />
            {bands(spans)}
            <Tooltip content={<ChartTip kind="uvxy" />} />
            <Line dataKey="uvxy_close" stroke="#14161b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        {rows.some((r) => r.uvxy_close === null) && (
          <Text type="secondary" className="text-xs">
            UVXY launched on 4 Oct 2011; earlier days have no price.
          </Text>
        )}
      </div>
    </Space>
  )
}
