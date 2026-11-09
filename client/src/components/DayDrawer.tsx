import { Descriptions, Drawer, Progress, Space, Typography } from 'antd'
import dayjs from 'dayjs'
import { REGIME_NAMES, num, pct, price, regimeColor, signedPct } from '../lib/regime'
import type { HistoryRow, RegimeEpisode } from '../types/regime'
import { RegimeTag } from './RegimeBits'

const { Text, Paragraph } = Typography

interface Props {
  row: HistoryRow | null
  episode: RegimeEpisode | null
  onClose: () => void
}

/** Details for one trading day and the regime spell it belongs to. */
export function DayDrawer({ row, episode, onClose }: Props) {
  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      width={420}
      title={row ? dayjs(row.date).format('dddd D MMMM YYYY') : ''}
      destroyOnClose
    >
      {row && (
        <Space direction="vertical" size="large" className="w-full">
          <div>
            <div className="eyebrow mb-1">Regime at the close</div>
            <Space align="center">
              <RegimeTag name={row.smoothed_label} large />
              <Text type="secondary">
                day <span className="num">{row.days_in_regime}</span> of this spell
              </Text>
            </Space>
            {row.in_sample && (
              <Paragraph type="secondary" className="mt-2 text-xs" style={{ marginBottom: 0 }}>
                In-sample date (2008–2013): the model was trained on this period.
              </Paragraph>
            )}
          </div>

          <div>
            <div className="eyebrow mb-1">Model probabilities that day</div>
            {REGIME_NAMES.map((n) => (
              <div key={n} className="flex items-center gap-3">
                <span className="w-20">{n}</span>
                <Progress
                  percent={Number(((row.probabilities[n] ?? 0) * 100).toFixed(1))}
                  strokeColor={regimeColor(n)}
                  status="normal"
                  size="small"
                  className="flex-1"
                  style={{ margin: 0 }}
                  format={(p) => <span className="num">{p?.toFixed(0)}%</span>}
                />
              </div>
            ))}
          </div>

          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="VIX close">
              <span className="num">{num(row.vix)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Futures contango">
              <span className="num">{signedPct(row.contango, 2)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="UVXY close (split-adjusted)">
              <span className="num">{price(row.uvxy_close)}</span>
            </Descriptions.Item>
            <Descriptions.Item label="UVXY next trading day">
              <span className="num">{signedPct(row.uvxy_next_ret)}</span>
              <Text type="secondary" className="ml-2 text-xs">
                what actually happened
              </Text>
            </Descriptions.Item>
          </Descriptions>

          {episode && (
            <div>
              <div className="eyebrow mb-1">The spell this day belongs to</div>
              <Paragraph style={{ marginBottom: 8 }}>
                <RegimeTag name={episode.regime} /> from{' '}
                <span className="num">{episode.start}</span> to{' '}
                <span className="num">{episode.end}</span>
                {episode.ongoing ? ' (still running)' : ''} —{' '}
                <span className="num">{episode.days}</span> trading days.
              </Paragraph>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="VIX start → peak → end">
                  <span className="num">
                    {num(episode.vix_start, 1)} → {num(episode.vix_peak, 1)} →{' '}
                    {num(episode.vix_end, 1)}
                  </span>
                </Descriptions.Item>
                <Descriptions.Item label="UVXY over the spell">
                  <span className="num">{signedPct(episode.uvxy_change)}</span>
                </Descriptions.Item>
                <Descriptions.Item label="S&P 500 over the spell">
                  <span className="num">{signedPct(episode.spx_change)}</span>
                </Descriptions.Item>
                <Descriptions.Item label="Came from / went to">
                  {episode.previous_regime ?? '—'} → {episode.next_regime ?? 'still running'}
                </Descriptions.Item>
              </Descriptions>
            </div>
          )}

          <Text type="secondary" className="text-xs">
            Probabilities use only data up to that day's close (the model gave{' '}
            {row.smoothed_label} {pct(row.probabilities[row.smoothed_label], 0)}). The next-day
            move and the spell's outcome are shown for context; they weren't known at the time.
          </Text>
        </Space>
      )}
    </Drawer>
  )
}
