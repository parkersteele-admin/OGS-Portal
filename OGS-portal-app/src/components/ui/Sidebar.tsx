import React from 'react'
import { NavLink } from 'react-router-dom'
import './Sidebar.css'

export interface SidebarItem {
  label: string
  to: string
  icon: React.ReactNode
}

interface SidebarProps {
  title: string
  items: SidebarItem[]
}

export const Sidebar: React.FC<SidebarProps> = ({ title, items }) => (
  <nav className="sidebar" aria-label="Main navigation">
    <div className="sidebar__logo-bar">
      <span className="sidebar__logo-mark" aria-hidden="true">⛽</span>
      <span className="sidebar__logo-text">OGS Portal</span>
    </div>

    <p className="sidebar__portal-label">{title}</p>

    <ul className="sidebar__nav" role="list">
      {items.map(({ label, to, icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            className={({ isActive }) =>
              `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
            }
          >
            <span className="sidebar__icon" aria-hidden="true">{icon}</span>
            <span className="sidebar__label">{label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
)
