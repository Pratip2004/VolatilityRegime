import { Alert, Card, DatePicker, Empty, Segmented, Space, Typography } from 'antd'
import type { TimeRangePickerProps } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useRegimeHistory } from '../api/regime'
import { PageState } from '../components/PageState'
import { PageHeader, RegimeLegend } from '../components/RegimeBits'
import {
  REGIME_BAND_FILL_OPACITY,
  orderedNames,
  labelSpans,
  num,
  pct,
  regimeColor,
  signedPct,
  type Span,
} from '../lib/regime'
import type { HistoryRow } from '../types/regime'

const { RangePicker } = DatePicker
const { Text } = Typography

type LabelSource = 'hmm' | 'baseline'

function makePresets(): TimeRangePickerProps['presets'] {
  const now = dayjs()
  return [
    { label: '1Y', value: [now.subtract(1, 'year'), now] },
    { label: '3Y', value: [now.subtract(3, 'year'), now] },
    { label: '5Y', value: [now.subtract(5, 'year'), now] },
    { label: 'All', value: [dayjs('2008-01-01'), now] },
  ]
}

const fmtDate = (d: string) => dayjs(d).format('MMM YY')
const GRID = '#f0f0f0'
const AXIS_TICK = { fontSize: 11, fill: '#8c8c8c' }

export default function RegimeHistoryPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(3, 'year'), dayjs()])
  const [source, setSource] = useState<LabelSource>('hmm')
  const start = range[0].format('YYYY-MM-DD')
  const end = range[1].format('YYYY-MM-DD')
  const q = useRegimeHistory(start, end)

  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const labelOf = (r: HistoryRow) => (source === 'hmm' ? r.smoothed_label : r.baseline_label)
  const spans = useMemo(
    () => labelSpans(rows, (r) => r.date, source === 'hmm' ? (r) => r.smoothed_label : (r) => r.baseline_label),
    [rows, source],
  )
  const names = useMemo(() => orderedNames(q.data?.names ?? []), [q.data])
  const chartRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        ...Object.fromEntries(names.map((n) => [probKey(n), r.probabilities[n] ?? 0])),
      })),
    [rows, names],
  )
  const uvxyDomain = useMemo(() => {
    const v = rows.map((r) => r.uvxy_close).filter((x): x is number => x !== null && x > 0)
    return v.length ? [Math.min(...v) * 0.9, Math.max(...v) * 1.1] : null
  }, [rows])
  const oosStart = rows.find((r) => !r.in_sample)?.date
  const hasInSample = rows.some((r) => r.in_sample)

  return (
    <div>
      <PageHeader title="Regime history" />
      <Card className="mb-4" size="small">
        <Space wrap size="large">
          <RangePicker
            value={range}
            presets={makePresets()}
            allowClear={false}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            disabledDate={(d) => d.isAfter(dayjs()) || d.isBefore(dayjs('2008-01-01'))}
          />
          <Segmented<LabelSource>
            value={source}
            onChange={setSource}
            options={[
              { label: 'HMM (smoothed)', value: 'hmm' },
              { label: 'Baseline rules', value: 'baseline' },
            ]}
          />
          <RegimeLegend />
        </Space>
      </Card>

      <PageState
        isLoading={q.isLoading}
        error={q.error}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
      >
        <Space direction="vertical" size="large" className="w-full">
          {hasInSample && (
            <Alert
              type="info"
              showIcon
              message={`Dates before ${oosStart ?? '2014'} are in-sample`}
              description="They fall inside the first training window (2008–2013). Later dates are out-of-sample walk-forward labels."
            />
          )}
          <Card title={`VIX with ${source === 'hmm' ? 'HMM' : 'baseline'} regime bands`} size="small">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartRows} syncId="regime" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} width={64} domain={[0, 'auto']} />
                {bands(spans)}
                {oosStart && hasInSample && oosLine(oosStart)}
                <Tooltip content={<RowTooltip labelOf={labelOf} kind="vix" />} />
                <Line
                  dataKey="vix"
                  stroke="#1f2937"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="VIX"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Filtered regime probabilities (HMM, no look-ahead)" size="small">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartRows} syncId="regime" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tick={AXIS_TICK} />
                <YAxis
                  tick={AXIS_TICK}
                  width={64}
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1]}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <Tooltip content={<RowTooltip labelOf={labelOf} kind="probs" />} />
                {names.map((n) => (
                  <Area
                    key={n}
                    dataKey={probKey(n)}
                    name={n}
                    stackId="p"
                    stroke={regimeColor(n)}
                    fill={regimeColor(n)}
                    fillOpacity={0.75}
                    strokeWidth={0}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card title="UVXY (split-adjusted, log scale) with regime bands" size="small">
            {uvxyDomain === null ? (
              <Empty description="No UVXY prices in this range (UVXY launched on 2011-10-04)." />
            ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartRows} syncId="regime" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={40} tick={AXIS_TICK} />
                <YAxis
                  scale="log"
                  domain={uvxyDomain}
                  tick={AXIS_TICK}
                  width={64}
                  tickFormatter={(v: number) => compact(v)}
                />
                {bands(spans)}
                <Tooltip content={<RowTooltip labelOf={labelOf} kind="uvxy" />} />
                <Line
                  dataKey="uvxy_close"
                  stroke="#1f2937"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="UVXY"
                />
              </LineChart>
            </ResponsiveContainer>
            )}
            {uvxyDomain !== null && rows.some((r) => r.uvxy_close === null) && (
              <Text type="secondary" className="text-xs">
                UVXY launched on 2011-10-04; earlier dates have no UVXY price.
              </Text>
            )}
          </Card>
        </Space>
      </PageState>
    </div>
  )
}

function probKey(name: string) {
  return `p_${name.toLowerCase()}`
}

function compact(v: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
}

/** Background bands per regime spell. Returned as an array (not a component) because
 *  Recharts 2 only picks up ReferenceArea elements that are direct children of the chart. */
function bands(spans: Span[]) {
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

function oosLine(x: string) {
  return (
    <ReferenceLine
      x={x}
      stroke="#595959"
      strokeDasharray="4 4"
      label={{ value: 'out-of-sample →', position: 'insideTopLeft', fontSize: 11, fill: '#595959' }}
    />
  )
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: HistoryRow & Record<string, unknown> }[]
  labelOf: (r: HistoryRow) => string
  kind: 'vix' | 'probs' | 'uvxy'
}

function RowTooltip({ active, payload, labelOf, kind }: TooltipProps) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const label = labelOf(r)
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow">
      <div className="mb-1 font-semibold">{dayjs(r.date).format('D MMM YYYY')}</div>
      <div className="flex items-center gap-2">
        <span
          style={{ width: 10, height: 10, borderRadius: 2, background: regimeColor(label) }}
          aria-hidden
        />
        {label}
        {r.in_sample && <span className="text-gray-400">(in-sample)</span>}
      </div>
      {kind === 'vix' && (
        <>
          <div>VIX {num(r.vix)}</div>
          <div>Contango {signedPct(r.contango, 2)}</div>
        </>
      )}
      {kind === 'uvxy' && <div>UVXY {r.uvxy_close === null ? '—' : num(r.uvxy_close)}</div>}
      {kind === 'probs' &&
        orderedNames(Object.keys(r.probabilities)).map((n) => (
          <div key={n}>
            {n} {pct(r.probabilities[n])}
          </div>
        ))}
    </div>
  )
}
