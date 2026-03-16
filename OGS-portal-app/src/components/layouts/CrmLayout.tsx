import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import type { SidebarItem } from '../ui/Sidebar'
import './Layout.css'

const NAV_ITEMS: SidebarItem[] = [
  { to: '/crm/customers', label: 'Customers', icon: '◷' },
  { to: '/crm/leads',     label: 'Leads',     icon: '▷' },
  { to: '/crm/quotes',    label: 'Quotes',    icon: '◈' },
  { to: '/crm/billing',   label: 'Billing',   icon: '$' },
  { to: '/crm/aging',     label: 'Aging',     icon: '↓' },
]

export const CrmLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="CRM" items={NAV_ITEMS} />
    <div className="layout__main">
      <TopBar title="CRM" />
      <main className="layout__content">
        <Outlet />
      </main>
    </div>
  </div>
)
