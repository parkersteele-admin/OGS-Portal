import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import './layout.css'

const NAV_ITEMS: SidebarItem[] = [
  { to: '/portal/dashboard', label: 'Dashboard', icon: '⊞' },
  { to: '/portal/order',     label: 'New Order',  icon: '+' },
  { to: '/portal/orders',    label: 'My Orders',  icon: '≡' },
  { to: '/portal/invoices',  label: 'Invoices',   icon: '$' },
  { to: '/portal/autopay',   label: 'Autopay',    icon: '↺' },
  { to: '/portal/tanks',     label: 'My Tanks',   icon: '⊙' },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.slice(0, 4).map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const CustomerLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="Customer Portal" items={NAV_ITEMS} />
    <div className="layout__main">
      <ViewAsBanner />
      <TopBar title="Customer Portal" />
      <main className="layout__content">
        <Outlet />
      </main>
      <MobileNav items={MOBILE_ITEMS} />
    </div>
  </div>
)
