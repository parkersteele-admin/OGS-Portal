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
  { to: '/crm/customers',     label: 'Customers',      icon: '◇' },
  { to: '/crm/leads',         label: 'Leads',          icon: '▷' },
  { to: '/crm/quotes',        label: 'Quotes',         icon: '◈' },
  { to: '/crm/billing',       label: 'Billing',        icon: '$' },
  { to: '/crm/aging',         label: 'Aging',          icon: '↓' },
  { to: '/crm/price-list',    label: 'Price List',     icon: '⊟' },
  { to: '/crm/merchandising', label: 'Merchandising',  icon: '☉' },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.slice(0, 4).map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const CrmLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="CRM" items={NAV_ITEMS} />
    <div className="layout__main">
      <ViewAsBanner />
      <TopBar title="CRM" />
      <main className="layout__content">
        <Outlet />
      </main>
      <MobileNav items={MOBILE_ITEMS} />
    </div>
  </div>
)
