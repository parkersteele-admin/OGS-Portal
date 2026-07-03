import React from 'react'
import { Calendar, Crosshair, Truck } from 'lucide-react'
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
  { to: '/driver/schedule', label: 'My Schedule', icon: <Calendar size={16} /> },
  { to: '/driver/truck',    label: 'My Truck',    icon: <Truck size={16} /> },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

const MORE_ITEMS: MobileNavItem[] = [
  { to: '/driver/truck', label: 'Truck', icon: <Truck size={16} /> },
  { to: '/ops/dispatch', label: 'Dispatch map', icon: <Crosshair size={16} /> },
]

export const DriverLayout: React.FC = () => {
  const { role } = useAuth()

  return (
    <div className="layout">
      <Sidebar title="Driver" items={NAV_ITEMS} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Driver Portal" />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav role={role} items={MOBILE_ITEMS} moreItems={MORE_ITEMS} />
      </div>
    </div>
  )
}
