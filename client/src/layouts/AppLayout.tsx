import {
  BarChartOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  LineChartOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Sider, Content } = Layout

const items: MenuProps['items'] = [
  {
    type: 'group',
    key: 'regime',
    label: 'Regime',
    children: [
      { key: '/regime/today', icon: <DashboardOutlined />, label: 'Today' },
      { key: '/regime/history', icon: <LineChartOutlined />, label: 'History' },
      { key: '/regime/diagnostics', icon: <ExperimentOutlined />, label: 'Diagnostics' },
    ],
  },
]

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
        width={220}
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <BarChartOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          {!collapsed && (
            <Typography.Text strong style={{ fontSize: 16 }}>
              UVXY Risk
            </Typography.Text>
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
        <Content className="p-4 md:p-6" style={{ maxWidth: 1400, width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
