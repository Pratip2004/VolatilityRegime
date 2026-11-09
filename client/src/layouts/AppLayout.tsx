import { BulbOutlined, CalendarOutlined, HomeOutlined, SettingOutlined } from '@ant-design/icons'
import { Layout, Menu } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { REGIME_NAMES, regimeColor } from '../lib/regime'

const { Sider, Content } = Layout

const items: MenuProps['items'] = [
  {
    type: 'group',
    key: 'regime',
    label: 'Regime',
    children: [
      { key: '/', icon: <HomeOutlined />, label: 'Overview' },
      { key: '/explorer', icon: <CalendarOutlined />, label: 'Explorer' },
      { key: '/insights', icon: <BulbOutlined />, label: 'Insights' },
      { key: '/model', icon: <SettingOutlined />, label: 'Model details' },
    ],
  },
]

/** Three-stripe mark in the regime colours. */
function Mark() {
  return (
    <span className="inline-flex h-5 items-end gap-0.5" aria-hidden>
      {REGIME_NAMES.map((n, i) => (
        <span key={n} style={{ width: 4, height: 8 + i * 5, background: regimeColor(n), borderRadius: 1 }} />
      ))}
    </span>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        width={212}
        style={{ borderRight: '1px solid var(--rule)' }}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Mark />
          {!collapsed && (
            <span className="font-display text-[17px] font-bold leading-tight">
              UVXY Regime
              <br />
              <span className="text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
                volatility monitor
              </span>
            </span>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>
      <Layout>
        <Content className="px-4 py-5 md:px-8 md:py-7" style={{ maxWidth: 1360, width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
