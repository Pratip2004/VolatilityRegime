import { Skeleton } from 'antd'
import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'

const RegimeTodayPage = lazy(() => import('./pages/RegimeTodayPage'))
const RegimeHistoryPage = lazy(() => import('./pages/RegimeHistoryPage'))
const RegimeInsightsPage = lazy(() => import('./pages/RegimeInsightsPage'))
const RegimeDiagnosticsPage = lazy(() => import('./pages/RegimeDiagnosticsPage'))

/** Keep old /regime/* links working (query string preserved). */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default function App() {
  return (
    <Suspense fallback={<Skeleton active className="p-6" />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<RegimeTodayPage />} />
          <Route path="/explorer" element={<RegimeHistoryPage />} />
          <Route path="/insights" element={<RegimeInsightsPage />} />
          <Route path="/model" element={<RegimeDiagnosticsPage />} />
          <Route path="/regime/today" element={<Redirect to="/" />} />
          <Route path="/regime/history" element={<Redirect to="/explorer" />} />
          <Route path="/regime/diagnostics" element={<Redirect to="/model" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
