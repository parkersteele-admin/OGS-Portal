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
  { to: '/driver/schedule', label: 'My Schedule', icon: '∷' },
  { to: '/driver/truck',    label: 'My Truck',    icon: '🚛' },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

const MORE_ITEMS: MobileNavItem[] = [
  { to: '/driver/truck', label: 'Truck', icon: '◫' },
  { to: '/ops/dispatch', label: 'Dispatch map', icon: '⌖' },
]

export const DriverLayout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { role } = useAuth()

  return (
    <div className="layout">
      <Sidebar title="Driver" items={NAV_ITEMS} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Driver Portal" onMenuClick={() => setMobileNavOpen(true)} />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav role={role} items={MOBILE_ITEMS} moreItems={MORE_ITEMS} />
      </div>
    </div>
  )
}
