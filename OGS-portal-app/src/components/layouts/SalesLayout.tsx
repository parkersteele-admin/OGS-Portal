/**
 * src/components/layouts/SalesLayout.tsx
 *
 * Layout for the /ops/sales/* route section.
 * Role gate: admin + sales (enforced by ProtectedRoute in AppRouter).
 */

import React from 'react'
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
  { to: '/ops/sales/dashboard',    label: 'Pipeline',     icon: '◈' },
  { to: '/ops/sales/pipeline',     label: 'List View',    icon: '≡' },
  { to: '/ops/sales/won',          label: 'Won',          icon: '✓' },
  { to: '/ops/sales/lost',         label: 'Lost',         icon: '✗' },
]

const ADMIN_ITEMS: SidebarItem[] = [
  ...NAV_ITEMS,
  { to: '/ops/sales/performance',  label: 'Performance',  icon: '▲' },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.slice(0, 4).map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const SalesLayout: React.FC = () => {
  const { isAdmin } = useAuth()
  const items = isAdmin ? ADMIN_ITEMS : NAV_ITEMS

  return (
    <div className="layout">
      <Sidebar title="Sales" items={items} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Sales Pipeline" />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav items={MOBILE_ITEMS} />
      </div>
    </div>
  )
}
