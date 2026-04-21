import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarGroup, SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import './Layout.css'

const OVERVIEW_ITEMS: SidebarItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: '⊞' },
]

const NAV_GROUPS: SidebarGroup[] = [
  { label: 'Overview', items: OVERVIEW_ITEMS },
  {
    label: 'CRM',
    items: [
      { to: '/admin/crm/dashboard', label: 'CRM Dashboard', icon: '◎' },
      { to: '/admin/crm/customers', label: 'Customers', icon: '◇' },
      { to: '/admin/crm/leads', label: 'Leads', icon: '▷' },
      { to: '/admin/crm/quotes', label: 'Quotes', icon: '◈' },
      { to: '/admin/crm/billing', label: 'Billing', icon: '$' },
      { to: '/admin/crm/aging', label: 'Aging', icon: '↓' },
      { to: '/admin/crm/price-list', label: 'Price List', icon: '⊟' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admin/ops/dashboard', label: 'Ops Dashboard', icon: '⊞' },
      { to: '/admin/ops/orders', label: 'Orders', icon: '≡' },
      { to: '/admin/ops/runs', label: 'Runs', icon: '↗' },
      { to: '/admin/ops/dispatch', label: 'Dispatch', icon: '⊕' },
      { to: '/admin/ops/tanks', label: 'Tanks', icon: '⊙' },
      { to: '/admin/ops/inventory', label: 'Inventory', icon: '⊟' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin/users', label: 'User Management', icon: '◎' },
      { to: '/admin/delivery-settings', label: 'Delivery Settings', icon: '⊞' },
      { to: '/admin/company-settings', label: 'Company Info', icon: '⊟' },
      { to: '/admin/email-templates', label: 'Email Templates', icon: '✉' },
    ],
  },
]

const MOBILE_ITEMS: MobileNavItem[] = [
  { to: '/admin/dashboard',         label: 'Dashboard',   icon: '⊞' },
  { to: '/admin/crm/customers',     label: 'Customers',   icon: '◇' },
  { to: '/admin/ops/dashboard',     label: 'Operations',  icon: '⊞' },
  { to: '/admin/ops/dispatch',      label: 'Dispatch',    icon: '⊕' },
  { to: '/admin/users',             label: 'Users',       icon: '◎' },
]

export const AdminLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="Admin" items={OVERVIEW_ITEMS} groups={NAV_GROUPS} />
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
