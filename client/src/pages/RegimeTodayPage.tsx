import { ReloadOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useRegimeLatest, useRegimeStatus, useTrainRegime } from '../api/regime'
import { PageState } from '../components/PageState'
import { PageHeader, RegimeTag, Sparkline } from '../components/RegimeBits'
import {
  FEATURE_LABELS,
  REGIME_NAMES,
  SIZE_NOT_DIRECTION,
  featureDisplayValue,
  formatFeature,
  num,
  pct,
  regimeColor,
  signedPct,
} from '../lib/regime'
import type { FeatureValue, ForecastRow, RegimeLatest } from '../types/regime'

const { Text, Paragraph } = Typography

const STAT_FEATURES = ['contango', 'vix_ratio', 'log_vvix', 'rv20'] as const

export default function RegimeTodayPage() {
  const latest = useRegimeLatest()
  return (
    <div>
      <PageHeader title="Regime today" extra={<RetrainControl />} />
      <PageState
        isLoading={latest.isLoading}
        error={latest.error}
        onRetry={() => latest.refetch()}
        emptyAction={<Text type="secondary">Use “Retrain model” above to fit it.</Text>}
      >
        {latest.data && <TodayContent data={latest.data} />}
      </PageState>
    </div>
  )
}

function TodayContent({ data }: { data: RegimeLatest }) {
  const byName = Object.fromEntries(data.features.map((f) => [f.name, f]))
  return (
    <Space direction="vertical" size="large" className="w-full">
      {data.changed_today && (
        <Alert
          type="warning"
          showIcon
          message={`Regime changed today: ${data.previous_label ?? '—'} → ${data.smoothed_label}`}
          description="The smoothed label switched at today's close. Hysteresis means switches are deliberate, not day-to-day noise."
          data-testid="changed-today"
        />
      )}

      <Card>
        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={10}>
            <Space direction="vertical" size={4}>
              <Text type="secondary">Current regime (smoothed)</Text>
              <RegimeTag name={data.smoothed_label} large />
              <Text type="secondary">
                As of <Text strong>{dayjs(data.date).format('D MMM YYYY')}</Text> close ·{' '}
                <Text strong>{data.days_in_regime}</Text>{' '}
                {data.days_in_regime === 1 ? 'day' : 'days'} in regime · raw label{' '}
                <RegimeTag name={data.raw_label} />
              </Text>
            </Space>
          </Col>
          <Col xs={24} md={14}>
            <Text type="secondary">Filtered probabilities (uses data up to today only)</Text>
            {REGIME_NAMES.map((n) => (
              <div key={n} className="mt-1 flex items-center gap-3">
                <span className="w-20 text-right">
                  <Text>{n}</Text>
                </span>
                <Progress
                  percent={Number(((data.probabilities[n] ?? 0) * 100).toFixed(1))}
                  strokeColor={regimeColor(n)}
                  status="normal"
                  format={(p) => <Text>{`${p?.toFixed(1)}%`}</Text>}
                  className="flex-1"
                  style={{ margin: 0 }}
                  aria-label={`${n} probability`}
                />
              </div>
            ))}
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {STAT_FEATURES.map((name) => (
          <Col key={name} xs={24} sm={12} xl={6}>
            <FeatureStat feature={byName[name]} name={name} />
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <NextDayRiskCard data={data} />
        </Col>
        <Col xs={24} lg={12}>
          <ForecastCard data={data} />
        </Col>
      </Row>
    </Space>
  )
}

function FeatureStat({ feature, name }: { feature: FeatureValue | undefined; name: string }) {
  if (!feature) {
    return (
      <Card size="small">
        <Statistic title={FEATURE_LABELS[name]} value="—" />
        <Text type="secondary">Not in the model's feature set</Text>
      </Card>
    )
  }
  const z = feature.z_score
  return (
    <Card size="small">
      <Statistic title={FEATURE_LABELS[name]} value={formatFeature(name, feature.value)} />
      <Text type={Math.abs(z) >= 2 ? 'danger' : 'secondary'}>
        z-score {z >= 0 ? '+' : ''}
        {z.toFixed(2)}
      </Text>
      <Sparkline values={feature.history.map((p) => featureDisplayValue(name, p.value))} />
      <Text type="secondary" className="text-xs">
        Last {feature.history.length} trading days
      </Text>
    </Card>
  )
}

function NextDayRiskCard({ data }: { data: RegimeLatest }) {
  const r = data.risk
  return (
    <Card
      title={
        <Space>
          Next-day risk <RegimeTag name={data.smoothed_label} />
        </Space>
      }
      className="h-full"
    >
      <Paragraph strong data-testid="size-not-direction">
        {SIZE_NOT_DIRECTION}
      </Paragraph>
      <Row gutter={16}>
        <Col span={8}>
          <Statistic
            title="Typical range (25–75th pct)"
            value={`${signedPct(r.p25)} to ${signedPct(r.p75)}`}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="Bad case (99th pct)"
            value={signedPct(r.p99)}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col span={8}>
          <Statistic
            title="P(move > +20%)"
            value={pct(r.prob_up_20)}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
      </Row>
      <Descriptions size="small" column={2} className="mt-4">
        <Descriptions.Item label="Daily std">{pct(r.std)}</Descriptions.Item>
        <Descriptions.Item label="1st–99th pct">
          {signedPct(r.p1)} to {signedPct(r.p99)}
        </Descriptions.Item>
        <Descriptions.Item label="P(move > +10%)">{pct(r.prob_up_10)}</Descriptions.Item>
        <Descriptions.Item label="P(move > +30%)">{pct(r.prob_up_30)}</Descriptions.Item>
      </Descriptions>
      <Text type="secondary" className="text-xs">
        Next-day UVXY close-to-close returns on {r.count.toLocaleString()} out-of-sample days
        labelled {data.smoothed_label} ({data.risk_period.start} to {data.risk_period.end}).
      </Text>
    </Card>
  )
}

function ForecastCard({ data }: { data: RegimeLatest }) {
  const columns: TableColumnsType<ForecastRow> = [
    {
      title: 'Horizon',
      dataIndex: 'horizon',
      render: (h: number) => `${h} trading day${h === 1 ? '' : 's'}`,
    },
    ...REGIME_NAMES.map((n) => ({
      title: <RegimeTag name={n} />,
      key: n,
      align: 'right' as const,
      render: (_: unknown, row: ForecastRow) => pct(row.probabilities[n]),
    })),
  ]
  return (
    <Card title="Regime forecast" className="h-full">
      <Table
        rowKey="horizon"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={data.forecast}
      />
      <div className="mt-4">
        <Statistic
          title={`Expected remaining duration of ${data.smoothed_label}`}
          value={num(data.expected_remaining_duration, 0)}
          suffix="trading days"
        />
        <Text type="secondary" className="text-xs">
          1 / (1 − p_stay) from the live model's transition matrix. Regimes can end sooner on
          news the model cannot foresee.
        </Text>
      </div>
    </Card>
  )
}

function RetrainControl() {
  const status = useRegimeStatus()
  const train = useTrainRegime()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!train.isPending) return
    setElapsed(0)
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(id)
  }, [train.isPending])

  const expected = status.data?.runtime_s ?? 120
  const running = train.isPending || Boolean(status.data?.training)

  const onClick = () =>
    train.mutate(undefined, {
      onSuccess: (s) => message.success(`Model retrained in ${s.runtime_s.toFixed(0)}s`),
      onError: (e) => message.error(`Retrain failed: ${e instanceof Error ? e.message : e}`),
    })

  return (
    <Space direction="vertical" align="end" size={2}>
      <Button
        type="primary"
        icon={<ReloadOutlined />}
        loading={running}
        onClick={onClick}
        data-testid="retrain"
      >
        Retrain model
      </Button>
      {train.isPending ? (
        <div style={{ width: 220 }}>
          <Progress
            percent={Math.min(99, Math.round((elapsed / expected) * 100))}
            size="small"
            status="active"
          />
          <Text type="secondary" className="text-xs">
            Walk-forward + live fit · {elapsed}s (usually ~{Math.round(expected)}s)
          </Text>
        </div>
      ) : (
        <Text type="secondary" className="text-xs">
          {status.data?.trained_at ? (
            <>
              Last trained {dayjs(status.data.trained_at).format('D MMM YYYY HH:mm')}
              {status.data.data_end && <> · data to {status.data.data_end}</>}
            </>
          ) : status.isLoading ? (
            '…'
          ) : (
            <Tag>Not trained</Tag>
          )}
        </Text>
      )}
    </Space>
  )
}
