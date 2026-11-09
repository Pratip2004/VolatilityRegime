import { ArrowRightOutlined, SwapRightOutlined } from '@ant-design/icons'
import { Alert, Progress, Segmented, Table, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRegimeHistory, useRegimeInsights, useRegimeLatest } from '../api/regime'
import { PageState } from '../components/PageState'
import { NotAdviceNote, RegimeTag, Sparkline } from '../components/RegimeBits'
import { RangeStrip } from '../components/RangeStrip'
import { RegimeRibbon } from '../components/RegimeRibbon'
import { RetrainControl } from '../components/RetrainControl'
import {
  FEATURE_LABELS,
  REGIME_NAMES,
  SIZE_NOT_DIRECTION,
  days,
  explorerHref,
  featureDisplayValue,
  formatFeature,
  num,
  bigMoveProb,
  oneIn,
  pct,
  probPct,
  regimeColor,
  signedPct,
  zWords,
} from '../lib/regime'
import type { ForecastRow, RegimeInsights, RegimeLatest } from '../types/regime'

const { Text, Paragraph } = Typography

const READINGS = ['contango', 'vix_ratio', 'log_vvix', 'rv20'] as const
const READING_HINTS: Record<string, string> = {
  contango: 'Futures curve slope. Negative (backwardation) is a classic panic sign.',
  vix_ratio: 'Near-term vs 3-month fear. Above 1 means near-term fear dominates.',
  log_vvix: 'How volatile VIX itself is.',
  rv20: 'How much the S&P 500 has actually been moving.',
}
type RibbonSpan = '1Y' | '5Y' | 'All'

export default function RegimeTodayPage() {
  const latest = useRegimeLatest()
  const insights = useRegimeInsights()
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">UVXY regime monitor</div>
          <NotAdviceNote />
        </div>
        <RetrainControl />
      </div>
      <PageState
        isLoading={latest.isLoading || insights.isLoading}
        error={latest.error ?? insights.error}
        onRetry={() => {
          latest.refetch()
          insights.refetch()
        }}
        emptyAction={<Text type="secondary">Use “Retrain model” above to fit it.</Text>}
      >
        {latest.data && insights.data && <Overview l={latest.data} ins={insights.data} />}
      </PageState>
    </div>
  )
}

function Overview({ l, ins }: { l: RegimeLatest; ins: RegimeInsights }) {
  const label = l.smoothed_label
  const profile = ins.profiles[label]
  const cur = ins.current
  const r = l.risk
  const conf = l.probabilities[label] ?? 0
  const domain: [number, number] = [
    Math.min(-0.05, ...Object.values(ins.profiles).map((p) => p.risk.p1 ?? 0)),
    Math.max(0.05, ...Object.values(ins.profiles).map((p) => p.risk.p99 ?? 0)),
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: the regime, in words */}
      <section
        className="panel overflow-hidden"
        aria-labelledby="hero-regime"
        style={{ borderLeft: `8px solid ${regimeColor(label)}` }}
      >
        <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="eyebrow">
              As of the {dayjs(l.date).format('ddd D MMM YYYY')} close
            </div>
            <h1
              id="hero-regime"
              className="font-display m-0 mt-1 leading-none"
              style={{ fontSize: 'clamp(44px, 7vw, 76px)', fontWeight: 700 }}
            >
              {label}
              <span
                className="font-display ml-3 align-middle"
                style={{ fontSize: 'clamp(18px, 2.4vw, 26px)', color: 'var(--ink-3)', fontWeight: 500 }}
              >
                day {l.days_in_regime}
              </span>
            </h1>
            {l.changed_today && (
              <Alert
                className="mt-3"
                type="warning"
                showIcon
                message={
                  <span>
                    Changed at today's close: {l.previous_label} <SwapRightOutlined /> {label}
                  </span>
                }
                data-testid="changed-today"
              />
            )}
            <div className="mt-4 flex flex-col gap-2 text-[15px] leading-relaxed" data-testid="summary">
              <Paragraph style={{ marginBottom: 0, fontSize: 15 }}>
                The model puts <strong className="num">{probPct(conf)}</strong> on {label}
                {cur.previous_regime ? (
                  <>
                    , after a {cur.previous_regime} spell.
                  </>
                ) : (
                  '.'
                )}
              </Paragraph>
              <Paragraph style={{ marginBottom: 0, fontSize: 15 }}>
                Historically, the day after a {label} day, UVXY usually moved between{' '}
                <strong className="num">{signedPct(r.p25)}</strong> and{' '}
                <strong className="num">{signedPct(r.p75)}</strong>. A move bigger than 20% in
                either direction came <strong>{oneIn(bigMoveProb(r, 20))}</strong>.
              </Paragraph>
              <Paragraph style={{ marginBottom: 0, fontSize: 15 }}>
                {label} spells usually last <strong className="num">{days(profile.spell_median)}</strong>
                {cur.continued_share !== null ? (
                  <>
                    ; of past spells that reached day {cur.days},{' '}
                    <strong className="num">{pct(cur.continued_share, 0)}</strong> kept going
                  </>
                ) : cur.longer_than_share === 1 ? (
                  <>; at day {cur.days}, this one is already longer than every past {label} spell</>
                ) : null}
                .
              </Paragraph>
            </div>
            <Text type="secondary" className="mt-3 block text-xs" data-testid="size-not-direction">
              {SIZE_NOT_DIRECTION}
            </Text>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <div className="eyebrow mb-1">Model probabilities today</div>
              {REGIME_NAMES.map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="w-20 text-[13px]">{n}</span>
                  <Progress
                    percent={Number(((l.probabilities[n] ?? 0) * 100).toFixed(1))}
                    strokeColor={regimeColor(n)}
                    status="normal"
                    className="flex-1"
                    style={{ margin: 0 }}
                    format={() => <span className="num text-[13px]">{probPct(l.probabilities[n])}</span>}
                    aria-label={`${n} probability`}
                  />
                </div>
              ))}
            </div>
            <div>
              <div className="eyebrow mb-1">Next-day UVXY moves after past {label} days</div>
              <RangeStrip risk={r} regime={label} domain={domain} />
              <Text type="secondary" className="text-xs">
                Solid bar: middle half of past next-day moves. Whiskers: 1-in-100 days.
              </Text>
            </div>
          </div>
        </div>
      </section>

      <RibbonSection />

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <SpellCard l={l} ins={ins} />
        <ForecastCard l={l} />
      </div>

      <section aria-labelledby="readings">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="readings" className="font-display m-0 text-xl font-semibold">
            What the model is reading
          </h2>
          <Text type="secondary" className="text-xs">
            Compared with 2008–today. Sparklines: last 60 trading days.
          </Text>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {READINGS.map((name) => {
            const f = l.features.find((x) => x.name === name)
            if (!f) return null
            return (
              <div key={name} className="panel p-4" title={READING_HINTS[name]}>
                <div className="eyebrow">{FEATURE_LABELS[name]}</div>
                <div className="num mt-1 text-2xl">{formatFeature(name, f.value)}</div>
                <Text
                  type="secondary"
                  strong={Math.abs(f.z_score) >= 1.5}
                  className="text-[13px]"
                  style={Math.abs(f.z_score) >= 1.5 ? { color: 'var(--ink)' } : undefined}
                >
                  {zWords(f.z_score)} <span className="num">(z {f.z_score >= 0 ? '+' : ''}{f.z_score.toFixed(1)})</span>
                </Text>
                <Sparkline
                  values={f.history.map((p) => featureDisplayValue(name, p.value))}
                  color={regimeColor(label)}
                />
                <Text type="secondary" className="text-xs">
                  {READING_HINTS[name]}
                </Text>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="glance">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="glance" className="font-display m-0 text-xl font-semibold">
            The three regimes at a glance
          </h2>
          <Link to="/insights">
            Full insights <ArrowRightOutlined />
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {REGIME_NAMES.map((n) => {
            const p = ins.profiles[n]
            return (
              <Link
                key={n}
                to={`/insights?regime=${n}`}
                className="cell-focus grid items-center gap-3 rounded-md p-2 sm:grid-cols-[120px_1fr_300px]"
                style={{ color: 'inherit', background: n === label ? '#f6f7fb' : undefined }}
              >
                <span className="flex items-center gap-2">
                  <RegimeTag name={n} />
                  {n === label && <Text type="secondary" className="text-xs">now</Text>}
                </span>
                <RangeStrip risk={p.risk} regime={n} domain={domain} labels={false} />
                <Text type="secondary" className="text-[13px]">
                  <span className="num" style={{ color: 'var(--ink)' }}>{pct(p.share_of_days, 0)}</span> of days ·
                  spells ~<span className="num" style={{ color: 'var(--ink)' }}>{num(p.spell_median, 0)}d</span> ·
                  ±20% move {oneIn(bigMoveProb(p.risk, 20)).replace('about ', '')}
                </Text>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function RibbonSection() {
  const q = useRegimeHistory()
  const navigate = useNavigate()
  const [span, setSpan] = useState<RibbonSpan>('All')
  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const shown = useMemo(() => {
    if (!rows.length || span === 'All') return rows
    const last = dayjs(rows[rows.length - 1].date)
    const from = last.subtract(span === '1Y' ? 1 : 5, 'year').format('YYYY-MM-DD')
    return rows.filter((r) => r.date >= from)
  }, [rows, span])
  const ribbonDays = useMemo(() => shown.map((r) => ({ date: r.date, label: r.smoothed_label })), [shown])
  if (!rows.length) return null
  return (
    <section className="panel p-5" aria-labelledby="ribbon">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ribbon" className="font-display m-0 text-xl font-semibold">
            Every trading day since {shown[0].date.slice(0, 4)}
          </h2>
          <Text type="secondary" className="text-[13px]">
            Hover to read a day, click to open it in the explorer. Today is at the right edge.
          </Text>
        </div>
        <Segmented<RibbonSpan> value={span} onChange={setSpan} options={['1Y', '5Y', 'All']} />
      </div>
      <RegimeRibbon
        days={ribbonDays}
        markLatest
        height={56}
        onSelect={(day) =>
          navigate(
            explorerHref({
              start: dayjs(day).subtract(2, 'month').format('YYYY-MM-DD'),
              end: dayjs(day).add(2, 'month').format('YYYY-MM-DD'),
              day,
            }),
          )
        }
      />
    </section>
  )
}

function SpellCard({ l, ins }: { l: RegimeLatest; ins: RegimeInsights }) {
  const label = l.smoothed_label
  const p = ins.profiles[label]
  const cur = ins.current
  const max = Math.max(p.spell_p90 ?? 1, cur.days, 1) * 1.1
  const at = (v: number | null) => `${(Math.min(v ?? 0, max) / max) * 100}%`
  const exits = Object.entries(p.exit_to).sort((a, b) => b[1] - a[1])
  return (
    <section className="panel p-5" aria-labelledby="spell">
      <h2 id="spell" className="font-display m-0 text-xl font-semibold">
        How long {label} lasts
      </h2>
      <Text type="secondary" className="text-[13px]">
        Today is day <span className="num">{cur.days}</span>, which began{' '}
        <span className="num">{dayjs(cur.start).format('D MMM')}</span>. Past {label} spells:
      </Text>
      <div className="relative mt-6 h-10" role="img" aria-label={`Day ${cur.days}; past spells: half ended by day ${num(p.spell_median, 0)}, 9 in 10 by day ${num(p.spell_p90, 0)}`}>
        <div className="absolute top-3 h-3 w-full rounded-sm" style={{ background: '#eef0f3' }} />
        <div className="absolute top-3 h-3 rounded-sm" style={{ width: at(p.spell_median), background: regimeColor(label), opacity: 0.35 }} />
        <div className="absolute top-3 h-3 rounded-sm" style={{ width: at(cur.days), background: regimeColor(label) }} />
        {[
          ['half end by', p.spell_median],
          ['9 in 10 by', p.spell_p90],
        ].map(([t, v]) => (
          <div key={t as string} className="absolute top-0 h-9" style={{ left: at(v as number) }}>
            <div className="h-full w-px" style={{ background: 'var(--ink-3)' }} />
            <span
              className={`num absolute -top-5 whitespace-nowrap text-[11px] ${
                (Math.min((v as number) ?? 0, max) / max) > 0.75 ? '-translate-x-full' : '-translate-x-1/2'
              }`}
              style={{ color: 'var(--ink-3)' }}
            >
              {t} {num(v as number, 0)}d
            </span>
          </div>
        ))}
      </div>
      <Paragraph className="mt-2 text-[13px]" style={{ marginBottom: 8 }}>
        {cur.continued_share !== null ? (
          <>
            Of past {label} spells that reached day {cur.days},{' '}
            <strong className="num">{pct(cur.continued_share, 0)}</strong> lasted at least another day.
          </>
        ) : cur.longer_than_share === 1 ? (
          <>This spell is already longer than every past {label} spell.</>
        ) : (
          <>Not enough completed spells to compare.</>
        )}
      </Paragraph>
      <div className="eyebrow mb-1">When {label} ends, the market usually moves to</div>
      {exits.map(([to, share]) => (
        <div key={to} className="mb-1 flex items-center gap-3 text-[13px]">
          <span className="w-20">{to}</span>
          <div className="h-2.5 flex-1 rounded-sm" style={{ background: '#eef0f3' }}>
            <div className="h-full rounded-sm" style={{ width: `${share * 100}%`, background: regimeColor(to) }} />
          </div>
          <span className="num w-10 text-right">{pct(share, 0)}</span>
        </div>
      ))}
    </section>
  )
}

function ForecastCard({ l }: { l: RegimeLatest }) {
  const columns: TableColumnsType<ForecastRow> = [
    {
      title: 'Looking ahead',
      dataIndex: 'horizon',
      render: (h: number) => (h === 1 ? 'Tomorrow' : h === 5 ? 'In a week (5d)' : 'In a month (20d)'),
    },
    {
      title: 'Odds of each regime',
      key: 'bar',
      render: (_, row) => (
        <div className="flex h-3 w-full min-w-32 overflow-hidden rounded-sm" aria-hidden>
          {REGIME_NAMES.map((n) => (
            <div key={n} style={{ width: `${(row.probabilities[n] ?? 0) * 100}%`, background: regimeColor(n) }} />
          ))}
        </div>
      ),
    },
    ...REGIME_NAMES.map((n) => ({
      title: n,
      key: n,
      align: 'right' as const,
      render: (_: unknown, row: ForecastRow) => <span className="num">{pct(row.probabilities[n], 0)}</span>,
    })),
  ]
  return (
    <section className="panel p-5" aria-labelledby="ahead">
      <h2 id="ahead" className="font-display m-0 text-xl font-semibold">
        Odds of each regime ahead
      </h2>
      <Text type="secondary" className="text-[13px]">
        From the model's switching rates. These describe how risky the coming days may be, not which
        way UVXY moves.
      </Text>
      <Table scroll={{ x: true }}
        className="mt-3"
        rowKey="horizon"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={l.forecast}
      />
    </section>
  )
}
