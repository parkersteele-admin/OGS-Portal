import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import './Layout.css'

const NAV_ITEMS: SidebarItem[] = [
  // ── CRM ───────────────────────────────────────────────────────────────
  { to: '/admin/crm/dashboard',     label: 'CRM Dashboard',  icon: '◎', sectionLabel: 'CRM' },
  { to: '/admin/crm/customers',     label: 'Customers',      icon: '◇' },
  { to: '/admin/crm/leads',         label: 'Leads',          icon: '▷' },
  { to: '/admin/crm/quotes',        label: 'Quotes',         icon: '◈' },
  { to: '/admin/crm/billing',       label: 'Billing',        icon: '$' },
  { to: '/admin/crm/aging',         label: 'Aging',          icon: '↓' },
  { to: '/admin/crm/price-list',    label: 'Price List',     icon: '⊟' },
  // ── Operations ────────────────────────────────────────────────────────
  { to: '/admin/ops/dashboard',     label: 'Ops Dashboard',  icon: '⊞', sectionLabel: 'Operations' },
  { to: '/admin/ops/orders',        label: 'Orders',         icon: '≡' },
  { to: '/admin/ops/runs',          label: 'Runs',           icon: '↗' },
  { to: '/admin/ops/dispatch',      label: 'Dispatch',       icon: '⊕' },
  { to: '/admin/ops/tanks',         label: 'Tanks',          icon: '⊙' },
  { to: '/admin/ops/inventory',     label: 'Inventory',      icon: '⊟' },
  // ── Admin ─────────────────────────────────────────────────────────────
  { to: '/admin/users',             label: 'User Management',    icon: '◎', sectionLabel: 'Admin' },
  { to: '/admin/delivery-settings', label: 'Delivery Settings',  icon: '⊞' },
]

const MOBILE_ITEMS: MobileNavItem[] = [
  { to: '/admin/crm/customers',     label: 'Customers',   icon: '◇' },
  { to: '/admin/ops/dashboard',     label: 'Operations',  icon: '⊞' },
  { to: '/admin/ops/dispatch',      label: 'Dispatch',    icon: '⊕' },
  { to: '/admin/users',             label: 'Users',       icon: '◎' },
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
      <MobileNav items={MOBILE_ITEMS} />
    </div>
  </div>
)

export default AdminLayout
