import { InfoCircleOutlined } from '@ant-design/icons'
import { Space, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { NOT_ADVICE, REGIME_NAMES, regimeColor } from '../lib/regime'

const { Text } = Typography

/** Regime name on its colour. The text label is always present, so identity never depends
 *  on colour alone (green/amber are hard to tell apart for protan/deutan readers). */
export function RegimeTag({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <Tag
      color={regimeColor(name)}
      style={
        large
          ? { fontSize: 22, lineHeight: '36px', padding: '0 16px', fontWeight: 600, margin: 0 }
          : { fontWeight: 600 }
      }
      data-testid={`regime-tag-${name}`}
    >
      {name}
    </Tag>
  )
}

export function NotAdviceNote() {
  return (
    <Text type="secondary" className="block text-xs" data-testid="not-advice">
      <InfoCircleOutlined /> {NOT_ADVICE}
    </Text>
  )
}

export function PageHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <NotAdviceNote />
      </div>
      {extra}
    </div>
  )
}

/** Legend for regime colours (always shown next to colour-coded charts). */
export function RegimeLegend({ names = REGIME_NAMES }: { names?: readonly string[] }) {
  return (
    <Space size="middle" wrap>
      {names.map((n) => (
        <Space key={n} size={6}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: 3,
              background: regimeColor(n),
            }}
          />
          <Text type="secondary">{n}</Text>
        </Space>
      ))}
    </Space>
  )
}

export function Sparkline({ values, color = '#1677ff' }: { values: (number | null)[]; color?: string }) {
  const data = values.map((v, i) => ({ i, v }))
  return (
    <div style={{ width: '100%', height: 36 }} aria-hidden>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
