import { Skeleton } from 'antd'
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'

const RegimeTodayPage = lazy(() => import('./pages/RegimeTodayPage'))
const RegimeHistoryPage = lazy(() => import('./pages/RegimeHistoryPage'))
const RegimeDiagnosticsPage = lazy(() => import('./pages/RegimeDiagnosticsPage'))

export default function App() {
  return (
    <Suspense fallback={<Skeleton active />}>
      <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/regime/today" replace />} />
        <Route path="/regime/today" element={<RegimeTodayPage />} />
        <Route path="/regime/history" element={<RegimeHistoryPage />} />
        <Route path="/regime/diagnostics" element={<RegimeDiagnosticsPage />} />
        <Route path="*" element={<Navigate to="/regime/today" replace />} />
      </Route>
      </Routes>
    </Suspense>
  )
}
