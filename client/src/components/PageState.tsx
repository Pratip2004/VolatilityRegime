import { Alert, Button, Empty, Skeleton } from 'antd'
import type { ReactNode } from 'react'
import { isNotTrained } from '../api/client'

interface Props {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  onRetry?: () => void
  emptyText?: ReactNode
  emptyAction?: ReactNode
  children: ReactNode
}

/** Shared loading / not-trained / error / empty handling for every regime page. */
export function PageState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  emptyText,
  emptyAction,
  children,
}: Props) {
  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} data-testid="page-loading" />
  if (error && isNotTrained(error)) {
    return (
      <Empty
        description="The regime model has not been trained yet."
        data-testid="page-not-trained"
      >
        {emptyAction}
      </Empty>
    )
  }
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Could not load regime data"
        description={error instanceof Error ? error.message : String(error)}
        action={onRetry ? <Button onClick={onRetry}>Retry</Button> : undefined}
        data-testid="page-error"
      />
    )
  }
  if (isEmpty) {
    return <Empty description={emptyText ?? 'No data for this selection.'} />
  }
  return <>{children}</>
}
