import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarItem } from '../ui/Sidebar'
import './Layout.css'

const NAV_ITEMS: SidebarItem[] = [
  { to: '/ops/dashboard', label: 'Dashboard', icon: '⊞' },
  { to: '/ops/orders',    label: 'Orders',    icon: '≡' },
  { to: '/ops/runs',      label: 'Runs',      icon: '↗' },
  { to: '/ops/dispatch',  label: 'Dispatch',  icon: '⊕' },
  { to: '/ops/tanks',     label: 'Tanks',     icon: '⊙' },
  { to: '/ops/inventory', label: 'Inventory', icon: '⊟' },
]

export const OpsLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="Operations" items={NAV_ITEMS} />
    <div className="layout__main">
      <ViewAsBanner />
      <TopBar title="Operations" />
      <main className="layout__content">
        <Outlet />
      </main>
    </div>
  </div>
)
