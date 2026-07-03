import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { MobileNavItem } from '../ui/MobileNav'
import { ADMIN_SIDEBAR_GROUPS, ADMIN_SIDEBAR_OVERVIEW_ITEMS } from './adminSidebarConfig'
import './Layout.css'

const MOBILE_ITEMS: MobileNavItem[] = [
  { to: '/admin/dashboard',         label: 'Dashboard',   icon: '⊞' },
  { to: '/admin/crm/customers',     label: 'Customers',   icon: '◇' },
  { to: '/admin/ops/dashboard',     label: 'Operations',  icon: '⊞' },
  { to: '/admin/ops/dispatch',      label: 'Dispatch',    icon: '⊕' },
  { to: '/admin/users',             label: 'Users',       icon: '◎' },
]

const MORE_ITEMS: MobileNavItem[] = [
  { to: '/admin/crm/leads', label: 'Leads', icon: '▷' },
  { to: '/admin/crm/quotes', label: 'Quotes', icon: '◈' },
  { to: '/admin/ops/dispatch', label: 'Dispatch', icon: '⊕' },
  { to: '/admin/ops/runs', label: 'Runs', icon: '↗' },
  { to: '/admin/ops/tanks', label: 'Tanks', icon: '⊙' },
  { to: '/admin/users', label: 'User Management', icon: '◎' },
  { to: '/admin/company-settings', label: 'Company Settings', icon: '⊟' },
]

export const AdminLayout: React.FC = () => {
  return (
    <div className="layout">
      <Sidebar
        title="Admin"
        items={ADMIN_SIDEBAR_OVERVIEW_ITEMS}
        groups={ADMIN_SIDEBAR_GROUPS}
      />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Admin" />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav role="admin" items={MOBILE_ITEMS} moreItems={MORE_ITEMS} />
      </div>
    </div>
  )
}

export default AdminLayout
