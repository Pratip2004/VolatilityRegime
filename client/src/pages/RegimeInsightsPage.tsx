import { ArrowRightOutlined } from '@ant-design/icons'
import { Button, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useRegimeInsights } from '../api/regime'
import { PageState } from '../components/PageState'
import { PageHeader, RegimeTag } from '../components/RegimeBits'
import { RangeStrip } from '../components/RangeStrip'
import {
  REGIME_NAMES,
  SIZE_NOT_DIRECTION,
  days,
  explorerHref,
  num,
  oneIn,
  pct,
  regimeColor,
  signedPct,
} from '../lib/regime'
import type { RegimeEpisode, RegimeInsights, RegimeName, RegimeProfile } from '../types/regime'

const { Text, Paragraph } = Typography

const SPELL_BINS: [number, number, string][] = [
  [1, 1, '1'],
  [2, 5, '2–5'],
  [6, 10, '6–10'],
  [11, 20, '11–20'],
  [21, 40, '21–40'],
  [41, 80, '41–80'],
  [81, 10_000, '81+'],
]

/** One axis for every strip on the page so ranges are comparable. */
function sharedDomain(profiles: Record<string, RegimeProfile>): [number, number] {
  const r = Object.values(profiles).map((p) => p.risk)
  const lo = Math.min(...r.map((x) => x.p1 ?? 0), -0.05)
  const hi = Math.max(...r.map((x) => x.p99 ?? 0), 0.05)
  return [Math.floor(lo * 20) / 20, Math.ceil(hi * 20) / 20]
}

export default function RegimeInsightsPage() {
  const q = useRegimeInsights()
  return (
    <div>
      <PageHeader
        title="Regime insights"
        subtitle="What each regime has meant for UVXY: how big the next-day moves get, how long spells last, and what came before."
      />
      <PageState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
        {q.data && <Insights d={q.data} />}
      </PageState>
    </div>
  )
}

function Insights({ d }: { d: RegimeInsights }) {
  const [params, setParams] = useSearchParams()
  const sel = (REGIME_NAMES as string[]).includes(params.get('regime') ?? '')
    ? (params.get('regime') as RegimeName)
    : d.current.regime
  const domain = sharedDomain(d.profiles)
  const select = (r: RegimeName) => {
    const p = new URLSearchParams(params)
    p.set('regime', r)
    setParams(p, { replace: true })
  }

  return (
    <Space direction="vertical" size={28} className="w-full">
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display m-0 text-xl font-semibold">The three regimes side by side</h2>
          <Text type="secondary" className="text-xs">
            Out-of-sample days {d.oos_start} → {d.as_of}. {SIZE_NOT_DIRECTION}
          </Text>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {REGIME_NAMES.map((n) => (
            <ProfileCard
              key={n}
              name={n}
              p={d.profiles[n]}
              domain={domain}
              current={d.current.regime === n}
              active={sel === n}
              onOpen={() => select(n)}
            />
          ))}
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="deep-dive">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="deep-dive" className="font-display m-0 text-xl font-semibold">
            Deep dive
          </h2>
          <Segmented<RegimeName>
            value={sel}
            onChange={select}
            options={REGIME_NAMES.map((n) => ({
              value: n,
              label: (
                <span>
                  <span style={{ color: regimeColor(n) }}>●</span> {n}
                </span>
              ),
            }))}
          />
        </div>
        <DeepDive name={sel} d={d} domain={domain} />
      </section>

      <YearlySection d={d} />
    </Space>
  )
}

function ProfileCard({
  name,
  p,
  domain,
  current,
  active,
  onOpen,
}: {
  name: RegimeName
  p: RegimeProfile
  domain: [number, number]
  current: boolean
  active: boolean
  onOpen: () => void
}) {
  const next = Object.entries(p.exit_to).sort((a, b) => b[1] - a[1])[0]
  const r = p.risk
  return (
    <article
      className="panel flex flex-col overflow-hidden"
      style={{ outline: active ? `2px solid ${regimeColor(name)}` : undefined }}
      data-testid={`profile-${name}`}
    >
      <div style={{ height: 6, background: regimeColor(name) }} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-2xl font-bold">{name}</span>
          {current && <Tag color="default">today</Tag>}
        </div>
        <Text type="secondary">
          <span className="num" style={{ color: 'var(--ink)' }}>
            {pct(p.share_of_days, 0)}
          </span>{' '}
          of trading days · VIX usually{' '}
          <span className="num" style={{ color: 'var(--ink)' }}>
            {num(p.vix_p10, 0)}–{num(p.vix_p90, 0)}
          </span>
        </Text>

        <div>
          <div className="eyebrow mb-1">Next-day UVXY move</div>
          <RangeStrip risk={r} regime={name} domain={domain} />
          <Text className="text-[13px]">
            Usually{' '}
            <span className="num">
              {signedPct(r.p25)} to {signedPct(r.p75)}
            </span>
            . A rise above +20% happened {oneIn(r.prob_up_20)}.
          </Text>
        </div>

        <div>
          <div className="eyebrow mb-1">Spells</div>
          <Text className="text-[13px]">
            Usually last <span className="num">{days(p.spell_median)}</span>; 1 in 4 run past{' '}
            <span className="num">{days(p.spell_p75)}</span>.
            {next && (
              <>
                {' '}
                Most often followed by <strong>{next[0]}</strong> (
                <span className="num">{pct(next[1], 0)}</span>).
              </>
            )}
          </Text>
        </div>

        <Button type="link" className="mt-auto self-start px-0" onClick={onOpen}>
          Deep dive into {name} <ArrowRightOutlined />
        </Button>
      </div>
    </article>
  )
}

function DeepDive({ name, d, domain }: { name: RegimeName; d: RegimeInsights; domain: [number, number] }) {
  const p = d.profiles[name]
  const r = p.risk
  const navigate = useNavigate()
  const eps = useMemo(() => d.episodes.filter((e) => e.regime === name), [d.episodes, name])

  const hist = SPELL_BINS.map(([lo, hi, label]) => ({
    label,
    spells: p.spell_lengths.filter((x) => x >= lo && x <= hi).length,
  }))
  const exits = Object.entries(p.exit_to).sort((a, b) => b[1] - a[1])

  const columns: TableColumnsType<RegimeEpisode> = [
    {
      title: 'Started',
      dataIndex: 'start',
      sorter: (a, b) => a.start.localeCompare(b.start),
      defaultSortOrder: 'descend',
      render: (s: string, e) => (
        <Space size={6}>
          <span className="num">{dayjs(s).format('D MMM YYYY')}</span>
          {e.ongoing && <Tag color={regimeColor(name)}>now</Tag>}
          {e.in_sample && <Tag>in-sample</Tag>}
        </Space>
      ),
    },
    {
      title: 'Length',
      dataIndex: 'days',
      align: 'right',
      sorter: (a, b) => a.days - b.days,
      render: (x: number) => <span className="num">{x}d</span>,
    },
    {
      title: 'VIX peak',
      dataIndex: 'vix_peak',
      align: 'right',
      sorter: (a, b) => (a.vix_peak ?? 0) - (b.vix_peak ?? 0),
      render: (x: number | null) => <span className="num">{num(x, 1)}</span>,
    },
    {
      title: 'UVXY over spell',
      dataIndex: 'uvxy_change',
      align: 'right',
      sorter: (a, b) => (a.uvxy_change ?? -Infinity) - (b.uvxy_change ?? -Infinity),
      render: (x: number | null) => <span className="num">{signedPct(x, 0)}</span>,
    },
    {
      title: 'S&P 500 over spell',
      dataIndex: 'spx_change',
      align: 'right',
      sorter: (a, b) => (a.spx_change ?? -Infinity) - (b.spx_change ?? -Infinity),
      render: (x: number | null) => <span className="num">{signedPct(x, 1)}</span>,
    },
    {
      title: 'Then',
      dataIndex: 'next_regime',
      render: (x: string | null) => (x ? <RegimeTag name={x} /> : <Text type="secondary">—</Text>),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-display mb-1 mt-0 text-lg font-semibold">What it means for tomorrow</h3>
          <Paragraph type="secondary" className="text-[13px]">
            On <span className="num">{r.count.toLocaleString()}</span> past {name} days, the next
            day's UVXY move was:
          </Paragraph>
          <RangeStrip risk={r} regime={name} domain={domain} />
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <Stat label="Typical (middle half)" value={`${signedPct(r.p25)} to ${signedPct(r.p75)}`} />
            <Stat label="Average daily swing (std)" value={pct(r.std)} />
            <Stat label="1-in-100 day, down" value={signedPct(r.p1)} />
            <Stat label="1-in-100 day, up" value={signedPct(r.p99)} />
            <Stat label="Up more than +10%" value={oneIn(r.prob_up_10)} />
            <Stat label="Up more than +20%" value={oneIn(r.prob_up_20)} />
          </div>
          <Text type="secondary" className="mt-2 block text-xs">
            {SIZE_NOT_DIRECTION}
          </Text>
        </div>

        <div>
          <h3 className="font-display mb-1 mt-0 text-lg font-semibold">How long it lasts</h3>
          <Paragraph type="secondary" className="text-[13px]">
            {p.spells} completed spells. Half ended within{' '}
            <span className="num">{days(p.spell_median)}</span>, 9 in 10 within{' '}
            <span className="num">{days(p.spell_p90)}</span>; the longest ran{' '}
            <span className="num">{days(p.spell_max)}</span>.
            {d.current.regime === name && (
              <>
                {' '}
                Today's spell is on day <span className="num">{d.current.days}</span>.
              </>
            )}
          </Paragraph>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={hist} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7a8191' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#7a8191' }} />
              <Tooltip formatter={(v: number) => [`${v} spells`, 'Spells']} labelFormatter={(l) => `${l} days`} />
              <Bar dataKey="spells" fill={regimeColor(name)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="eyebrow mb-1 mt-3">When it ends, the market moves to</div>
          {exits.map(([to, share]) => (
            <div key={to} className="mb-1 flex items-center gap-3 text-[13px]">
              <span className="w-20">{to}</span>
              <div className="h-2.5 flex-1 rounded-sm" style={{ background: '#eef0f3' }}>
                <div className="h-full rounded-sm" style={{ width: `${share * 100}%`, background: regimeColor(to) }} />
              </div>
              <span className="num w-10 text-right">{pct(share, 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display m-0 text-lg font-semibold">Past {name} episodes</h3>
          <Text type="secondary" className="text-xs">
            Click an episode to see it day by day. Changes run from the close before the spell to its last day.
          </Text>
        </div>
        <Table<RegimeEpisode>
          rowKey="start"
          size="small"
          columns={columns}
          dataSource={eps}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} episodes` }}
          onRow={(e) => ({
            onClick: () =>
              navigate(
                explorerHref({
                  start: dayjs(e.start).subtract(1, 'month').format('YYYY-MM-DD'),
                  end: dayjs(e.end).add(1, 'month').format('YYYY-MM-DD'),
                  day: e.start,
                }),
              ),
            style: { cursor: 'pointer' },
          })}
          scroll={{ x: true }}
        />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b pb-1" style={{ borderColor: 'var(--rule)' }}>
      <Text type="secondary">{label}</Text>
      <span className="num">{value}</span>
    </div>
  )
}

function YearlySection({ d }: { d: RegimeInsights }) {
  const navigate = useNavigate()
  const years = [...d.yearly].reverse()
  return (
    <section className="panel p-5" aria-labelledby="years">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="years" className="font-display m-0 text-xl font-semibold">
          Time spent in each regime, by year
        </h2>
        <Space size="middle">
          {REGIME_NAMES.map((n) => (
            <Text key={n} type="secondary" className="text-xs">
              <span style={{ color: regimeColor(n) }}>●</span> {n}
            </Text>
          ))}
        </Space>
      </div>
      <div className="flex flex-col gap-1.5">
        {years.map((y) => (
          <button
            key={y.year}
            type="button"
            className="cell-focus group flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
            onClick={() => navigate(explorerHref({ start: `${y.year}-01-01`, end: `${y.year}-12-31` }))}
            aria-label={`${y.year}: ${REGIME_NAMES.map((n) => `${n} ${pct(y.shares[n], 0)}`).join(', ')}. Open in explorer.`}
          >
            <span className="num w-12 text-[13px]" style={{ color: 'var(--ink-2)' }}>
              {y.year}
            </span>
            <div className="flex h-5 flex-1 gap-0.5 overflow-hidden rounded-sm group-hover:opacity-80">
              {REGIME_NAMES.map((n) =>
                (y.shares[n] ?? 0) > 0 ? (
                  <div
                    key={n}
                    className="num flex items-center justify-center text-[10px] font-medium"
                    style={{
                      width: `${(y.shares[n] ?? 0) * 100}%`,
                      background: regimeColor(n),
                      color: 'var(--ink)',
                    }}
                  >
                    {(y.shares[n] ?? 0) >= 0.12 ? pct(y.shares[n], 0) : ''}
                  </div>
                ) : null,
              )}
            </div>
            <span className="w-20 text-[11px]" style={{ color: 'var(--ink-3)' }}>
              {y.in_sample ? 'in-sample' : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
