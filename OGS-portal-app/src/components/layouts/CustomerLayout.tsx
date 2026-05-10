import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../ui/Sidebar'
import { TopBar } from '../ui/TopBar'
import { MobileNav } from '../ui/MobileNav'
import { ViewAsBanner } from '../ui/ViewAsBanner'
import type { SidebarItem } from '../ui/Sidebar'
import type { MobileNavItem } from '../ui/MobileNav'
import './Layout.css'

const IC_DASHBOARD = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="5" height="5" rx="0.75" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9.5" y="1.5" width="5" height="5" rx="0.75" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="1.5" y="9.5" width="5" height="5" rx="0.75" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.75" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const IC_ORDER = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IC_ORDERS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IC_INVOICES = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 1.5h5.5l3 3V14H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M9.5 1.5v3H12.5" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
    <path d="M6.5 7.5h3M6.5 10h2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
  </svg>
)
const IC_AUTOPAY = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1" y="3.5" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="3" y="9.5" width="3.5" height="1.5" rx="0.5" fill="currentColor"/>
  </svg>
)
const IC_TANKS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <ellipse cx="8" cy="5" rx="4" ry="1.75" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M4 5v6a4 1.75 0 0 0 8 0V5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
)
const IC_PRODUCTS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5L14 5v6L8 14.5 2 11V5L8 1.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M8 1.5v13M2 5l6 3 6-3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
)
const IC_PROFILE = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="5.5" r="2.75" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2.5 13.5c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IC_COMPANY = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="5" width="9" height="9.5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M5 14.5V11h3v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M10.5 7.5V2.5a1 1 0 0 1 1-1H14a.5.5 0 0 1 .5.5v12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M3.5 8h1M3.5 10.5h1M11.5 5h1M11.5 7.5h1M11.5 10h1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
  </svg>
)

const NAV_ITEMS: SidebarItem[] = [
  { to: '/portal/dashboard', label: 'Dashboard',       icon: IC_DASHBOARD },
  { to: '/portal/order',     label: 'New Order',       icon: IC_ORDER },
  { to: '/portal/orders',    label: 'My Orders',       icon: IC_ORDERS },
  { to: '/portal/invoices',  label: 'Invoices',        icon: IC_INVOICES },
  { to: '/portal/autopay',   label: 'Autopay',         icon: IC_AUTOPAY },
  { to: '/portal/tanks',     label: 'My Tanks',        icon: IC_TANKS },
  { to: '/portal/catalog',   label: 'My Products',     icon: IC_PRODUCTS },
  { to: '/portal/profile',   label: 'My Profile',      icon: IC_PROFILE },
  { to: '/portal/company',   label: 'Company Profile', icon: IC_COMPANY },
]

const MOBILE_ITEMS: MobileNavItem[] = NAV_ITEMS.slice(0, 4).map(
  ({ to, label, icon }) => ({ to, label, icon }),
)

export const CustomerLayout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="layout">
      <Sidebar title="Customer Portal" items={NAV_ITEMS} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="layout__main">
        <ViewAsBanner />
        <TopBar title="Customer Portal" onMenuClick={() => setMobileNavOpen(true)} />
        <main className="layout__content">
          <Outlet />
        </main>
        <MobileNav items={MOBILE_ITEMS} />
      </div>
    </div>
  )
}
