import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarItem } from '../ui/Sidebar'
import './layout.css'

const NAV_ITEMS: SidebarItem[] = [
  { to: '/admin/users', label: 'Users', icon: '◎' },
]

export const AdminLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="Admin" items={NAV_ITEMS} />
    <div className="layout__main">
      <ViewAsBanner />
      <TopBar title="Admin" />
      <main className="layout__content">
        <Outlet />
      </main>
    </div>
  </div>
)

export default AdminLayout
