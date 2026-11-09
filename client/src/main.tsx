import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3b3aa8',
          colorText: '#14161b',
          colorTextSecondary: '#4b5160',
          colorBorder: '#e3e6eb',
          colorBorderSecondary: '#e3e6eb',
          colorBgLayout: '#f4f5f7',
          borderRadius: 8,
          fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
        },
        components: {
          Table: { headerBg: '#f8f9fb', headerColor: '#4b5160', rowHoverBg: '#f6f7fb' },
          Menu: { itemSelectedBg: '#ecebfa', itemSelectedColor: '#3b3aa8' },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
