import React, { useMemo } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import { useAuth } from '../../hooks/useAuth'
import type { SidebarItem } from '../ui/Sidebar'
import './Layout.css'

const BASE_NAV_ITEMS: SidebarItem[] = [
  { to: '/ops/dashboard', label: 'Dashboard', icon: '⊞' },
  { to: '/ops/orders',    label: 'Orders',    icon: '≡' },
  { to: '/ops/runs',      label: 'Runs',      icon: '↗' },
  { to: '/ops/dispatch',  label: 'Dispatch',  icon: '⊕' },
  { to: '/ops/tanks',     label: 'Tanks',     icon: '⊙' },
  { to: '/ops/inventory', label: 'Inventory', icon: '⊟' },
]

export const OpsLayout: React.FC = () => {
  const { isAdmin } = useAuth()

  const navItems = useMemo<SidebarItem[]>(() => {
    if (!isAdmin) return BASE_NAV_ITEMS
    return [
      ...BASE_NAV_ITEMS,
      { to: '/crm/price-list', label: 'Price List', icon: '≋' },
    ]
  }, [isAdmin])

  return (
    <div className="layout">
      <Sidebar title="Operations" items={navItems} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Operations" />
        <main className="layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
