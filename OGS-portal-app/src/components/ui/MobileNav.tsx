import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { UserRole } from '../../types/user'
import './MobileNav.css'

export interface MobileNavItem {
  label: string
  to: string
  icon: React.ReactNode
}

interface MobileNavProps {
  items?: MobileNavItem[]
  role?: UserRole | null
  moreItems?: MobileNavItem[]
}

const ROLE_PRIMARY_TABS: Record<Exclude<UserRole, 'customer' | 'owner' | 'manager' | 'billing' | 'delivery' | 'viewer'>, [MobileNavItem, MobileNavItem, MobileNavItem]> = {
  admin: [
    { label: 'Home', to: '/admin/dashboard', icon: '⌂' },
    { label: 'Customers', to: '/admin/crm/customers', icon: '◈' },
    { label: 'Orders', to: '/admin/ops/orders', icon: '≡' },
  ],
  sales: [
    { label: 'Home', to: '/crm/dashboard', icon: '⌂' },
    { label: 'Customers', to: '/crm/customers', icon: '◈' },
    { label: 'Quotes', to: '/crm/quotes', icon: '◫' },
  ],
  driver: [
    { label: 'Home', to: '/driver/schedule', icon: '⌂' },
    { label: 'Map', to: '/ops/dispatch', icon: '⌖' },
    { label: 'History', to: '/driver/truck', icon: '◷' },
  ],
  dispatch: [
    { label: 'Home', to: '/ops/dispatch', icon: '⌂' },
    { label: 'Orders', to: '/ops/orders', icon: '≡' },
    { label: 'Drivers', to: '/ops/runs', icon: '△' },
  ],
}

export const MobileNav: React.FC<MobileNavProps> = ({ items = [], role, moreItems = [] }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useAuth()
  const [moreOpen, setMoreOpen] = React.useState(false)

  const resolvedRole = role ?? auth.role
  const roleTabs =
    resolvedRole && resolvedRole in ROLE_PRIMARY_TABS
      ? ROLE_PRIMARY_TABS[resolvedRole as keyof typeof ROLE_PRIMARY_TABS]
      : null

  if (!roleTabs) {
    return (
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {items.map(({ label, to, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `mobile-nav__item${isActive ? ' mobile-nav__item--active' : ''}`
            }
          >
            <span className="mobile-nav__icon" aria-hidden="true">{icon}</span>
            <span className="mobile-nav__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    )
  }

  const [left, middle, right] = roleTabs
  const moreActive = moreItems.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))

  return (
    <>
      <nav className="mobile-nav mobile-nav--role" aria-label="Mobile navigation">
        <NavLink to={left.to} className={({ isActive }) => `mobile-nav__item${isActive ? ' mobile-nav__item--active' : ''}`}>
          <span className="mobile-nav__icon" aria-hidden="true">{left.icon}</span>
          <span className="mobile-nav__label">{left.label}</span>
        </NavLink>

        <NavLink to={middle.to} className={({ isActive }) => `mobile-nav__item${isActive ? ' mobile-nav__item--active' : ''}`}>
          <span className="mobile-nav__icon" aria-hidden="true">{middle.icon}</span>
          <span className="mobile-nav__label">{middle.label}</span>
        </NavLink>

        <NavLink to="/quick-actions" className={({ isActive }) => `mobile-nav__center${isActive ? ' mobile-nav__center--active' : ''}`} aria-label="Quick actions">
          <span className="mobile-nav__center-circle" aria-hidden="true">+</span>
          <span className="mobile-nav__center-label">Actions</span>
        </NavLink>

        <NavLink to={right.to} className={({ isActive }) => `mobile-nav__item${isActive ? ' mobile-nav__item--active' : ''}`}>
          <span className="mobile-nav__icon" aria-hidden="true">{right.icon}</span>
          <span className="mobile-nav__label">{right.label}</span>
        </NavLink>

        <button
          type="button"
          className={`mobile-nav__item mobile-nav__more${moreActive ? ' mobile-nav__item--active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <span className="mobile-nav__icon" aria-hidden="true">⋯</span>
          <span className="mobile-nav__label">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-nav-sheet" role="dialog" aria-modal="true" aria-label="More navigation" onClick={() => setMoreOpen(false)}>
          <div className="mobile-nav-sheet__panel" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-nav-sheet__handle" aria-hidden="true" />
            <div className="mobile-nav-sheet__header">
              <h2>More</h2>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Close more menu">✕</button>
            </div>
            <div className="mobile-nav-sheet__list">
              {moreItems.map((item) => (
                <button
                  type="button"
                  key={item.to}
                  className="mobile-nav-sheet__link"
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(item.to)
                  }}
                >
                  <span className="mobile-nav-sheet__link-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
