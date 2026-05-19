import React, { useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import { useAuth } from '../../hooks/useAuth'
import type { SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import { ADMIN_SIDEBAR_GROUPS, ADMIN_SIDEBAR_OVERVIEW_ITEMS } from './adminSidebarConfig'
import './Layout.css'

const BASE_NAV_ITEMS: SidebarItem[] = [
  { to: '/ops/dashboard', label: 'Dashboard', icon: '⊞' },
  { to: '/ops/orders',    label: 'Orders',    icon: '≡' },
  { to: '/ops/runs',      label: 'Runs',      icon: '↗' },
  { to: '/ops/dispatch',  label: 'Dispatch',  icon: '⊕' },
  { to: '/ops/tanks',     label: 'Tanks',     icon: '⊙' },
  { to: '/ops/inventory', label: 'Inventory', icon: '⊟' },
]

const MOBILE_ITEMS: MobileNavItem[] = BASE_NAV_ITEMS.slice(0, 4).map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const OpsLayout: React.FC = () => {
  const { isAdmin, role } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const navItems = useMemo<SidebarItem[]>(() => {
    if (!isAdmin) return BASE_NAV_ITEMS
    return [
      ...BASE_NAV_ITEMS,
      { to: '/crm/price-list', label: 'Price List', icon: '≋' },
    ]
  }, [isAdmin])

  return (
    <div className="layout">
      <Sidebar
        title={isAdmin ? 'Admin' : 'Operations'}
        items={isAdmin ? ADMIN_SIDEBAR_OVERVIEW_ITEMS : navItems}
        groups={isAdmin ? ADMIN_SIDEBAR_GROUPS : undefined}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Operations" onMenuClick={() => setMobileNavOpen(true)} />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav role={role} items={MOBILE_ITEMS} moreItems={navItems.map(({ to, label, icon }) => ({ to, label, icon }))} />
      </div>
    </div>
  )
}
