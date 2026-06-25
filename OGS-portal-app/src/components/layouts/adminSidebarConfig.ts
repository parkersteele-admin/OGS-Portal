import { createElement } from 'react'
import { LayoutDashboard } from 'lucide-react'
import type { SidebarGroup, SidebarItem } from '../ui/Sidebar'

export const ADMIN_SIDEBAR_OVERVIEW_ITEMS: SidebarItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: createElement(LayoutDashboard, { size: 16 }) },
]

const ADMIN_SETTINGS_ITEMS: SidebarItem[] = [
  { to: '/admin/users', label: 'User Management', icon: '◎' },
  { to: '/admin/delivery-settings', label: 'Delivery Settings', icon: '⊞' },
  { to: '/admin/company-settings', label: 'Company Info', icon: '⊟' },
  { to: '/admin/email-templates', label: 'Email Templates', icon: '✉' },
]

export const ADMIN_SIDEBAR_GROUPS: SidebarGroup[] = [
  { label: 'ADMIN', items: ADMIN_SETTINGS_ITEMS },
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
    label: 'OPERATIONS',
    items: [
      { to: '/admin/ops/dashboard', label: 'Ops Dashboard', icon: '⊞' },
      { to: '/admin/ops/orders', label: 'Orders', icon: '≡' },
      { to: '/admin/ops/runs', label: 'Runs', icon: '↗' },
      { to: '/admin/ops/dispatch', label: 'Dispatch', icon: '⊕' },
      { to: '/admin/ops/tanks', label: 'Tanks', icon: '⊙' },
      { to: '/admin/ops/inventory', label: 'Inventory', icon: '⊟' },
    ],
  },
]