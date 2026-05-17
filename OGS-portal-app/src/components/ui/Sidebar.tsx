import React, { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BrandLogo } from '../branding/BrandLogo'
import './Sidebar.css'

export interface SidebarItem {
  label: string
  to: string
  icon: React.ReactNode
  /** If set, renders a section heading above this item. */
  sectionLabel?: string
}

interface SidebarProps {
  title: string
  items?: SidebarItem[]
  groups?: SidebarGroup[]
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export interface SidebarGroup {
  label: string
  items: SidebarItem[]
}

function isRouteMatch(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export const Sidebar: React.FC<SidebarProps> = ({
  title,
  items = [],
  groups = [],
  mobileOpen = false,
  onMobileClose,
}) => {
  const location = useLocation()
  const hasAccordionGroups = groups.length > 0

  const activeGroupLabel = useMemo(() => {
    const activeGroup = groups.find((group) =>
      group.items.some((item) => isRouteMatch(location.pathname, item.to)),
    )
    return activeGroup?.label ?? null
  }, [groups, location.pathname])

  const [openGroupLabel, setOpenGroupLabel] = useState<string | null>(activeGroupLabel)

  useEffect(() => {
    setOpenGroupLabel(activeGroupLabel)
  }, [activeGroupLabel])

  const toggleGroup = (label: string) => {
    setOpenGroupLabel((current) => (current === label ? null : label))
  }

  return (
    <>
      <button
        type="button"
        className={`sidebar__backdrop${mobileOpen ? ' sidebar__backdrop--open' : ''}`}
        aria-label="Close navigation"
        onClick={onMobileClose}
      />
      <nav className={`sidebar${mobileOpen ? ' sidebar--mobile-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar__logo-bar">
          <BrandLogo className="sidebar__logo-image" />
        </div>

        <p className="sidebar__portal-label">{title}</p>

        <ul className="sidebar__nav" role="list" onClick={onMobileClose}>
          {!hasAccordionGroups && items.map(({ label, to, icon, sectionLabel }) => (
            <React.Fragment key={to}>
              {sectionLabel && (
                <li className="sidebar__section-label" aria-hidden="true">
                  {sectionLabel}
                </li>
              )}
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
            </React.Fragment>
          ))}

          {hasAccordionGroups && groups.map((group) => {
            const isOpen = openGroupLabel === group.label
            const hasActiveItem = group.items.some((item) => isRouteMatch(location.pathname, item.to))

            return (
              <li
                key={group.label}
                className={`sidebar__group${isOpen ? ' sidebar__group--open' : ''}`}
              >
                <button
                  type="button"
                  className={`sidebar__section-toggle${hasActiveItem ? ' sidebar__section-toggle--active' : ''}`}
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={isOpen}
                >
                  <span className="sidebar__section-toggle-label">{group.label}</span>
                  <span className="sidebar__section-toggle-icon" aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>

                {isOpen && (
                  <ul className="sidebar__group-list" role="list">
                    {group.items.map(({ label, to, icon }) => (
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
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
