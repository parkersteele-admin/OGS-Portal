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
  { to: '/driver/schedule', label: 'My Schedule', icon: '∷' },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const DriverLayout: React.FC = () => (
  <div className="layout">
    <Sidebar title="Driver" items={NAV_ITEMS} />
    <div className="layout__main">
      <ViewAsBanner />
      <TopBar title="Driver Portal" />
      <main className="layout__content">
        <Outlet />
      </main>
      <MobileNav items={MOBILE_ITEMS} />
    </div>
  </div>
)
