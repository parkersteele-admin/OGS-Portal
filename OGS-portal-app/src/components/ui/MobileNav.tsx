import React from 'react'
import { NavLink } from 'react-router-dom'
import './MobileNav.css'

export interface MobileNavItem {
  label: string
  to: string
  icon: React.ReactNode
}

interface MobileNavProps {
  items: MobileNavItem[]
}

export const MobileNav: React.FC<MobileNavProps> = ({ items }) => (
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
