import { ReloadOutlined } from '@ant-design/icons'
import { App, Button, Progress, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useRegimeStatus, useTrainRegime } from '../api/regime'

const { Text } = Typography

/** "Retrain model" button with progress and the last trained time. */
export function RetrainControl() {
  const status = useRegimeStatus()
  const train = useTrainRegime()
  const { message } = App.useApp()
  const [elapsed, setElapsed] = useState(0)
  const running = train.isPending || Boolean(status.data?.training)

  useEffect(() => {
    if (!running) return
    setElapsed(0)
    const id = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const expected = status.data?.runtime_s ?? 120

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
      {running ? (
        <div style={{ width: 220 }}>
          <Progress
            percent={Math.min(99, Math.round((elapsed / expected) * 100))}
            size="small"
            status="active"
          />
          <Text type="secondary" className="text-xs">
            {train.isPending ? 'Walk-forward + live fit' : 'Training in progress elsewhere'} ·{' '}
            {elapsed}s (usually ~{Math.round(expected)}s)
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
