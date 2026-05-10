import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import { useAuth } from '../../hooks/useAuth'
import type { SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import './Layout.css'

const NAV_ITEMS: SidebarItem[] = [
  { to: '/crm/dashboard',     label: 'Dashboard',      icon: '◎' },
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

const MORE_ITEMS: MobileNavItem[] = [
  { to: '/crm/leads', label: 'Leads', icon: '▷' },
  { to: '/crm/billing', label: 'Billing', icon: '$' },
  { to: '/crm/aging', label: 'Aging', icon: '↓' },
  { to: '/crm/price-list', label: 'Price List', icon: '⊟' },
  { to: '/crm/merchandising', label: 'Merchandising', icon: '☉' },
]

export const CrmLayout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { role } = useAuth()

  return (
    <div className="layout">
      <Sidebar title="CRM" items={NAV_ITEMS} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="CRM" onMenuClick={() => setMobileNavOpen(true)} />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav role={role} items={MOBILE_ITEMS} moreItems={MORE_ITEMS} />
      </div>
    </div>
  )
}
