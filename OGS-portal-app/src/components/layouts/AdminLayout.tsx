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
  { to: '/crm/dashboard',     label: 'CRM Dashboard',  icon: '◎', sectionLabel: 'CRM' },
  { to: '/crm/customers',     label: 'Customers',      icon: '◇' },
  { to: '/crm/leads',         label: 'Leads',          icon: '▷' },
  { to: '/crm/quotes',        label: 'Quotes',         icon: '◈' },
  { to: '/crm/billing',       label: 'Billing',        icon: '$' },
  { to: '/crm/aging',         label: 'Aging',          icon: '↓' },
  { to: '/crm/price-list',    label: 'Price List',     icon: '⊟' },
  // ── Operations ────────────────────────────────────────────────────────
  { to: '/ops/dashboard',     label: 'Ops Dashboard',  icon: '⊞', sectionLabel: 'Operations' },
  { to: '/ops/orders',        label: 'Orders',         icon: '≡' },
  { to: '/ops/runs',          label: 'Runs',           icon: '↗' },
  { to: '/ops/dispatch',      label: 'Dispatch',       icon: '⊕' },
  { to: '/ops/tanks',         label: 'Tanks',          icon: '⊙' },
  { to: '/ops/inventory',     label: 'Inventory',      icon: '⊟' },
  // ── Admin ─────────────────────────────────────────────────────────────
  { to: '/admin/users',             label: 'User Management',    icon: '◎', sectionLabel: 'Admin' },
  { to: '/admin/delivery-settings', label: 'Delivery Settings',  icon: '⊞' },
]

const MOBILE_ITEMS: MobileNavItem[] = [
  { to: '/crm/customers',     label: 'Customers',   icon: '◇' },
  { to: '/ops/dashboard',     label: 'Operations',  icon: '⊞' },
  { to: '/ops/dispatch',      label: 'Dispatch',    icon: '⊕' },
  { to: '/admin/users',       label: 'Users',       icon: '◎' },
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
