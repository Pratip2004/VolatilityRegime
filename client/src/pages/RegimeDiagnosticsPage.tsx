import { WarningOutlined } from '@ant-design/icons'
import {
  Alert,
  Card,
  Col,
  Collapse,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useRegimeDiagnostics, useRegimeHindsight } from '../api/regime'
import { PageState } from '../components/PageState'
import { PageHeader, RegimeTag } from '../components/RegimeBits'
import { ReturnBoxPlot } from '../components/ReturnBoxPlot'
import {
  FEATURE_LABELS,
  fmtCheck,
  formatFeature,
  mostSevere,
  num,
  pct,
  regimeColor,
  signedPct,
  verdict,
} from '../lib/regime'
import type {
  ComparisonRow,
  Episode,
  RegimeDiagnostics,
  RiskStats,
  SpikeStats,
} from '../types/regime'

const { Text, Paragraph } = Typography
type Source = 'hmm' | 'baseline'
const AXIS_TICK = { fontSize: 11, fill: '#8c8c8c' }

export default function RegimeDiagnosticsPage() {
  const q = useRegimeDiagnostics()
  return (
    <div>
      <PageHeader title="Regime diagnostics" />
      <PageState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {q.data && <Diagnostics d={q.data} />}
      </PageState>
    </div>
  )
}

function Diagnostics({ d }: { d: RegimeDiagnostics }) {
  const v = d.validation
  return (
    <Space direction="vertical" size="large" className="w-full">
      <Text type="secondary">
        Out-of-sample period {v.oos_start} → {v.oos_end} ({v.oos_days.toLocaleString()} days).
        Statistics below use out-of-sample smoothed labels unless marked otherwise.
      </Text>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <TransitionCard d={d} />
        </Col>
        <Col xs={24} lg={14}>
          <StateMeansCard d={d} />
        </Col>
      </Row>
      <ComparisonCard rows={v.summary} spikes={v.spike_lead_time} stability={v.stability} />
      <EpisodesCard episodes={v.known_episodes} calm={v.calm_share_year} />
      <RiskCard d={d} />
      <DurationCard d={d} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <VixParamsCard d={d} />
        </Col>
        <Col xs={24} lg={12}>
          <RestartsCard d={d} />
        </Col>
      </Row>
      <HindsightPanel />
    </Space>
  )
}

/** Single-hue sequential shading (light → dark blue) for probabilities. */
function probShade(p: number) {
  const a = 0.08 + 0.72 * Math.max(0, Math.min(1, p))
  return { background: `rgba(22, 119, 255, ${a.toFixed(3)})`, color: p > 0.55 ? '#fff' : undefined }
}

function TransitionCard({ d }: { d: RegimeDiagnostics }) {
  type Row = { from: string; probs: number[] }
  const data: Row[] = d.names.map((n, i) => ({ from: n, probs: d.transition_matrix[i] }))
  const columns: TableColumnsType<Row> = [
    { title: 'From \\ To', dataIndex: 'from', render: (n: string) => <RegimeTag name={n} /> },
    ...d.names.map((n, j) => ({
      title: n,
      key: n,
      align: 'center' as const,
      onCell: (r: Row) => ({ style: probShade(r.probs[j]) }),
      render: (_: unknown, r: Row) => pct(r.probs[j], 1),
    })),
    {
      title: 'Exp. duration',
      key: 'dur',
      align: 'right' as const,
      render: (_: unknown, r: Row) => `${num(d.expected_duration[r.from], 0)} d`,
    },
  ]
  return (
    <Card title="Transition matrix (live model, daily)" size="small" className="h-full">
      <Table rowKey="from" size="small" pagination={false} columns={columns} dataSource={data} />
      <Text type="secondary" className="text-xs">
        Row = today's state, column = tomorrow's. Darker cells = higher probability.
      </Text>
    </Card>
  )
}

function StateMeansCard({ d }: { d: RegimeDiagnostics }) {
  type Row = { name: string } & Record<string, number | string>
  const data: Row[] = d.names.map((n) => ({ name: n, ...d.state_means[n] }))
  const columns: TableColumnsType<Row> = [
    { title: 'State', dataIndex: 'name', fixed: 'left', render: (n: string) => <RegimeTag name={n} /> },
    ...d.features.map((f) => ({
      title: FEATURE_LABELS[f] ?? f,
      dataIndex: f,
      align: 'right' as const,
      render: (x: number) => formatFeature(f, x),
    })),
  ]
  return (
    <Card title="State means (original units)" size="small" className="h-full">
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={data}
        scroll={{ x: true }}
      />
      <Text type="secondary" className="text-xs">
        States are named by mean contango: highest = Calm, lowest = Panic.
      </Text>
    </Card>
  )
}

function betterTag(b: ComparisonRow['better']) {
  if (b === 'hmm') return <Tag color="blue">HMM</Tag>
  if (b === 'baseline') return <Tag color="purple">Baseline</Tag>
  if (b === 'tie') return <Tag>Tie</Tag>
  if (b === 'neither') return <Tag color="error">Neither (both fail)</Tag>
  return <Text type="secondary">—</Text>
}

function isSpikeStats(x: unknown): x is SpikeStats {
  return typeof x === 'object' && x !== null && 'spike_days' in x
}

function ComparisonCard({
  rows,
  spikes,
  stability,
}: {
  rows: ComparisonRow[]
  spikes: Record<string, SpikeStats | number>
  stability: Record<string, number>
}) {
  const { hmm: hmmWins, base: baseWins, clearlyBetter } = verdict(rows)
  const hmm = isSpikeStats(spikes.hmm) ? spikes.hmm : null
  const base = isSpikeStats(spikes.baseline) ? spikes.baseline : null
  const threshold = typeof spikes.threshold === 'number' ? spikes.threshold : null
  const window = typeof spikes.window === 'number' ? spikes.window : null
  const columns: TableColumnsType<ComparisonRow> = [
    { title: 'Check', dataIndex: 'check' },
    { title: 'HMM', dataIndex: 'hmm', align: 'right', render: (x, r) => fmtCheck(r.check, x) },
    {
      title: 'Baseline',
      dataIndex: 'baseline',
      align: 'right',
      render: (x, r) => fmtCheck(r.check, x),
    },
    { title: 'Better', dataIndex: 'better', align: 'center', render: betterTag },
  ]
  return (
    <Card title="HMM vs baseline" size="small">
      <Alert
        type={clearlyBetter ? 'success' : 'warning'}
        showIcon
        className="mb-3"
        message={
          clearlyBetter
            ? `HMM better on ${hmmWins} of ${rows.length} checks`
            : `HMM is not clearly better than the baseline (HMM wins ${hmmWins}, baseline wins ${baseWins} of ${rows.length} checks)`
        }
      />
      <Table
        rowKey="check"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={rows}
      />
      <Paragraph type="secondary" className="mt-3 text-xs" style={{ marginBottom: 0 }}>
        Differences within 10% count as ties. “Neither” = both models miss the spec's expected
        sign. A higher spike hit rate partly reflects how often a model flags Stressed/Panic —
        read it together with the false-alarm rate.{' '}
        {hmm && base && (
          <>
            Spike = VIX rises ≥{pct(threshold, 0)} within the next {window ?? '—'} trading days (
            {hmm.spike_events} events, {hmm.spike_days} days). Median days flagged before an
            event: HMM {num(hmm.median_days_flagged_before_event, 1)}, baseline{' '}
            {num(base.median_days_flagged_before_event, 1)}.{' '}
          </>
        )}
        Raw HMM flips/year{' '}
        {num(stability.hmm_raw_flips_per_year, 1)} vs smoothed{' '}
        {num(stability.hmm_smoothed_flips_per_year, 1)}.
      </Paragraph>
    </Card>
  )
}

function EpisodesCard({
  episodes,
  calm,
}: {
  episodes: Episode[]
  calm: Record<string, number | null>
}) {
  const share = (src: Source) => (_: unknown, e: Episode) => {
    const s = e[src]
    return (
      <Space size={4}>
        <Text>{pct(s.share_flagged, 0)}</Text>
        {s.passed ? (
          <Tag color="success">pass</Tag>
        ) : (
          <Tag color="warning" icon={<WarningOutlined />}>
            attention
          </Tag>
        )}
      </Space>
    )
  }
  const columns: TableColumnsType<Episode> = [
    { title: 'Episode', dataIndex: 'name' },
    {
      title: 'Window',
      key: 'w',
      render: (_, e) => `${e.start} → ${e.end}`,
    },
    {
      title: 'Sample',
      dataIndex: 'in_sample',
      render: (ins: boolean) => (ins ? <Tag>in-sample</Tag> : <Tag color="blue">out-of-sample</Tag>),
    },
    { title: 'HMM: share Stressed/Panic', key: 'hmm', render: share('hmm') },
    { title: 'HMM: share Panic', key: 'hp', render: (_, e) => pct(e.hmm.share_panic, 0) },
    { title: 'Baseline: share Stressed/Panic', key: 'base', render: share('baseline') },
  ]
  return (
    <Card title="Known stress episodes" size="small">
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={episodes}
        scroll={{ x: true }}
      />
      <Text type="secondary" className="text-xs">
        Episodes before 2014 fall inside the first training window and are in-sample. Share of{' '}
        {calm.year} labelled Calm: HMM {pct(calm.hmm, 0)}, baseline {pct(calm.baseline, 0)}.
      </Text>
    </Card>
  )
}

function RiskCard({ d }: { d: RegimeDiagnostics }) {
  const [src, setSrc] = useState<Source>('hmm')
  const stats = d.risk_stats[src]
  type Row = RiskStats & { name: string }
  const data: Row[] = d.names.map((n) => ({ name: n, ...stats[n] }))
  const p = (k: keyof RiskStats) => ({
    title: k.toString().toUpperCase(),
    dataIndex: k,
    align: 'right' as const,
    render: (x: number | null) => signedPct(x),
  })
  const columns: TableColumnsType<Row> = [
    { title: 'Regime', dataIndex: 'name', fixed: 'left', render: (n: string) => <RegimeTag name={n} /> },
    { title: 'Days', dataIndex: 'count', align: 'right' },
    { title: 'Mean', dataIndex: 'mean', align: 'right', render: (x) => signedPct(x, 2) },
    { title: 'Median', dataIndex: 'median', align: 'right', render: (x) => signedPct(x, 2) },
    { title: 'Std', dataIndex: 'std', align: 'right', render: (x) => pct(x) },
    p('p1'),
    p('p5'),
    p('p25'),
    p('p75'),
    p('p95'),
    p('p99'),
    { title: 'P(>+10%)', dataIndex: 'prob_up_10', align: 'right', render: (x) => pct(x) },
    { title: 'P(>+20%)', dataIndex: 'prob_up_20', align: 'right', render: (x) => pct(x) },
    { title: 'P(>+30%)', dataIndex: 'prob_up_30', align: 'right', render: (x) => pct(x) },
  ]
  return (
    <Card
      title="Next-day UVXY return by regime"
      size="small"
      extra={
        <Segmented<Source>
          size="small"
          value={src}
          onChange={setSrc}
          options={[
            { label: 'HMM', value: 'hmm' },
            { label: 'Baseline', value: 'baseline' },
          ]}
        />
      }
    >
      <Text type="secondary" className="mb-2 block text-xs">
        Label at close t, UVXY return close t → close t+1, out-of-sample {d.risk_period.start} →{' '}
        {d.risk_period.end}. Describes the size of likely moves, not their direction.
      </Text>
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={data}
        scroll={{ x: true }}
      />
      <div className="mt-4">
        <ReturnBoxPlot stats={stats} names={d.names} />
        <Text type="secondary" className="text-xs">
          Whiskers 1st–99th pct · light box 5th–95th · solid box 25th–75th · black tick median.
        </Text>
      </div>
    </Card>
  )
}

function DurationCard({ d }: { d: RegimeDiagnostics }) {
  const [src, setSrc] = useState<Source>('hmm')
  const dur = d.durations[src]
  const bins = Object.values(dur).find((x) => x.histogram)?.histogram?.bins ?? []
  const data = bins.map((b, i) => ({
    bin: b,
    ...Object.fromEntries(d.names.map((n) => [n, dur[n]?.histogram?.counts[i] ?? 0])),
  }))
  return (
    <Card
      title="Regime spell durations (trading days)"
      size="small"
      extra={
        <Segmented<Source>
          size="small"
          value={src}
          onChange={setSrc}
          options={[
            { label: 'HMM', value: 'hmm' },
            { label: 'Baseline', value: 'baseline' },
          ]}
        />
      }
    >
      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="bin" tick={AXIS_TICK} />
              <YAxis allowDecimals={false} tick={AXIS_TICK} width={32} />
              <Tooltip />
              <Legend />
              {d.names.map((n) => (
                <Bar key={n} dataKey={n} fill={regimeColor(n)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Col>
        <Col xs={24} lg={8}>
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={d.names.map((n) => ({ name: n, ...dur[n] }))}
            columns={[
              { title: 'Regime', dataIndex: 'name', render: (n: string) => <RegimeTag name={n} /> },
              { title: 'Spells', dataIndex: 'spells', align: 'right' },
              { title: 'Median', dataIndex: 'median', align: 'right', render: (x) => num(x, 0) },
              { title: '≤10d', dataIndex: 'share_le_10d', align: 'right', render: (x) => pct(x, 0) },
            ]}
          />
        </Col>
      </Row>
    </Card>
  )
}

function VixParamsCard({ d }: { d: RegimeDiagnostics }) {
  const vp = d.vix_params
  const data = [
    ...d.names.map((n) => ({ name: n, ...vp.by_regime[n] })),
    { name: 'All days', ...vp.all_days },
  ]
  return (
    <Card title="Spot-VIX process by regime (for the Monte Carlo simulator)" size="small" className="h-full">
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        dataSource={data}
        columns={[
          {
            title: 'Regime',
            dataIndex: 'name',
            render: (n: string) => (n === 'All days' ? <Text>{n}</Text> : <RegimeTag name={n} />),
          },
          { title: 'Days', dataIndex: 'n', align: 'right' },
          { title: 'κ (per yr)', dataIndex: 'kappa', align: 'right', render: (x) => num(x, 1) },
          { title: 'θ (VIX)', dataIndex: 'theta', align: 'right', render: (x) => num(x, 1) },
          { title: 'σ (ann.)', dataIndex: 'sigma', align: 'right', render: (x) => num(x, 2) },
          { title: 'λ jumps/yr', dataIndex: 'lam', align: 'right', render: (x) => num(x, 1) },
          { title: 'μ_J', dataIndex: 'mu_j', align: 'right', render: (x) => num(x, 3) },
        ]}
      />
      <Text type="secondary" className="text-xs">
        {vp.model}. Fitted on {vp.source} with the simulator's own method (AR(1) + 3σ up-jump
        detection). Available as drop-in simulator parameters from{' '}
        <Text code>GET /api/regime/vix-params</Text>.
      </Text>
    </Card>
  )
}

function RestartsCard({ d }: { d: RegimeDiagnostics }) {
  const best = Math.max(...d.restarts.map((r) => r.log_likelihood ?? -Infinity))
  return (
    <Card title="Live fit: restart log-likelihoods" size="small" className="h-full">
      <Table
        rowKey="seed"
        size="small"
        pagination={false}
        dataSource={d.restarts}
        columns={[
          { title: 'Seed', dataIndex: 'seed' },
          {
            title: 'Log-likelihood',
            dataIndex: 'log_likelihood',
            align: 'right',
            render: (x: number | null) =>
              x === null ? (
                <Tag color="error">failed</Tag>
              ) : (
                <Text strong={x === best}>{x.toFixed(1)}</Text>
              ),
          },
          {
            title: 'Converged',
            dataIndex: 'converged',
            align: 'center',
            render: (c: boolean) => (c ? <Tag color="success">yes</Tag> : <Tag>no</Tag>),
          },
        ]}
      />
    </Card>
  )
}

function HindsightPanel() {
  const [open, setOpen] = useState(false)
  const start = useMemo(() => dayjs().subtract(3, 'year').format('YYYY-MM-DD'), [])
  const q = useRegimeHindsight(start, open)
  const severe = mostSevere(Object.keys(q.data?.rows[0]?.filtered ?? { Panic: 0 })) ?? 'Panic'
  const data = useMemo(
    () =>
      (q.data?.rows ?? []).map((r) => ({
        date: r.date,
        filtered: r.filtered[severe] ?? 0,
        smoothed: r.smoothed[severe] ?? 0,
      })),
    [q.data, severe],
  )
  return (
    <Collapse
      onChange={(keys) => setOpen((Array.isArray(keys) ? keys : [keys]).length > 0)}
      items={[
        {
          key: 'hindsight',
          label: (
            <Space>
              <WarningOutlined style={{ color: regimeColor('Stressed') }} />
              Hindsight (smoothed) view — not usable for trading
            </Space>
          ),
          children: (
            <Space direction="vertical" className="w-full">
              <Alert
                type="warning"
                showIcon
                message="Hindsight view"
                description={
                  q.data?.note ??
                  'Smoothed probabilities use data after each date. Not usable for trading or as a daily signal.'
                }
              />
              <PageState
                isLoading={q.isLoading}
                error={q.error}
                onRetry={() => q.refetch()}
                isEmpty={open && !q.isLoading && data.length === 0}
              >
                <Text type="secondary">P({severe}), last 3 years: filtered (real-time) vs smoothed (hindsight).</Text>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#f0f0f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(x: string) => dayjs(x).format('MMM YY')}
                      minTickGap={40}
                      tick={AXIS_TICK}
                    />
                    <YAxis
                      domain={[0, 1]}
                      tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                      tick={AXIS_TICK}
                      width={40}
                    />
                    <Tooltip formatter={(v: number) => pct(v)} labelFormatter={(l: string) => dayjs(l).format('D MMM YYYY')} />
                    <Legend />
                    <Line
                      dataKey="filtered"
                      name={`Filtered P(${severe}) — real-time`}
                      stroke={regimeColor(severe)}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="smoothed"
                      name={`Smoothed P(${severe}) — hindsight`}
                      stroke="#6b7280"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </PageState>
            </Space>
          ),
        },
      ]}
    />
  )
}

