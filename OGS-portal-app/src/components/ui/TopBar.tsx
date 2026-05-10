import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getDocs, query, orderBy } from 'firebase/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useViewAsStore } from '../../store/viewAsStore'
import { signOut } from '../../lib/auth'
import { customersCol, usersCol } from '../../lib/firestore'
import { NotificationBell } from './NotificationBell'
import { CreateUserModal } from './CreateUserModal'
import { ROLE_HOME } from '../../types/auth'
import type { AppUser, UserRole } from '../../types/user'
import type { Customer } from '../../types/customer'
import './TopBar.css'
import './CreateUserModal.css'

interface TopBarProps {
  title: string
  onMenuClick?: () => void
}

// ── View-as user picker modal ──────────────────────────────────────────────────

function ViewAsModal({
  onClose,
  onSelect,
}: {
  onClose:  () => void
  onSelect: (user: AppUser) => void
}): React.ReactElement {
  const [users,   setUsers]   = useState<AppUser[]>([])
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()

    // Load all customers from the customers collection, then overlay real
    // portal user accounts where they exist (so customerId is preserved).
    Promise.all([
      getDocs(query(customersCol, orderBy('name'))),
      getDocs(query(usersCol, orderBy('name'))),
    ]).then(([custSnap, userSnap]) => {
      // Build a map of customerId → portal AppUser
      const portalByCustomerId = new Map<string, AppUser>()
      for (const d of userSnap.docs) {
        const u = { ...d.data(), id: d.id } as AppUser
        if (u.role === 'customer' && u.customerId) {
          portalByCustomerId.set(u.customerId, u)
        }
      }

      // For every customer record, use their real portal account if one exists,
      // otherwise synthesise an AppUser so the view-as store still gets the
      // right shape (name, email, role, customerId).
      const list: AppUser[] = custSnap.docs
        .map((d) => {
          const c = { ...d.data(), id: d.id } as Customer
          if (c.status !== 'active') return null
          const real = portalByCustomerId.get(c.id)
          if (real) return real
          // Synthetic — no portal login yet, but still previewable
          return {
            id:         c.id,
            name:       c.name,
            email:      c.email,
            role:       'customer' as UserRole,
            active:     true,
            customerId: c.id,
            createdAt:  c.createdAt,
            updatedAt:  c.updatedAt,
          } as AppUser
        })
        .filter((u): u is AppUser => u !== null)

      setUsers(list)
    }).finally(() => setLoading(false))
  }, [])

  const filtered = search.trim()
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()),
      )
    : users

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="va-overlay" role="dialog" aria-modal="true" aria-label="View as customer" onClick={onClose}>
      <div className="va-modal" onClick={(e) => e.stopPropagation()}>
        <div className="va-modal__header">
          <span className="va-modal__title">View portal as…</span>
          <button className="va-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="va-modal__search">
          <svg className="va-modal__search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            className="va-modal__input"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="va-modal__list" role="listbox">
          {loading ? (
            <div className="va-modal__empty">Loading customers…</div>
          ) : filtered.length === 0 ? (
            <div className="va-modal__empty">No customers found.</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                role="option"
                aria-selected="false"
                className="va-modal__item"
                onClick={() => onSelect(u)}
              >
                <span className="va-modal__item-avatar" aria-hidden="true">
                  {u.name[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="va-modal__item-info">
                  <span className="va-modal__item-name">{u.name}</span>
                  <span className="va-modal__item-email">{u.email}</span>
                </span>
                <svg className="va-modal__item-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── TopBar ─────────────────────────────────────────────────────────────────────

export const TopBar: React.FC<TopBarProps> = ({ title, onMenuClick }) => {
  const { user, realUser } = useAuth()
  const navigate  = useNavigate()
  const { viewAsUser, setViewAsUser, exitViewAs } = useViewAsStore()

  const [open,           setOpen]       = useState(false)
  const [pickerOpen,     setPickerOpen] = useState(false)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [loggingOut,     setLoggingOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use real admin identity for display in the avatar/dropdown header
  const displayUser = realUser ?? user
  const initials = displayUser?.name
    ? displayUser.name
        .split(' ')
        .map((n: string) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : (displayUser?.email?.[0] ?? '?').toUpperCase()

  const isAdmin       = realUser?.role === 'admin'
  const isViewingAs   = viewAsUser !== null
  const isRolePreview = isViewingAs && viewAsUser?.id === realUser?.id
  const activePreviewRole: UserRole = (isRolePreview ? viewAsUser?.role : realUser?.role) ?? 'admin'

  // Close dropdown on outside click
  const handleOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open, handleOutside])

  const handleLogout = useCallback(async () => {
    exitViewAs()
    setLoggingOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, exitViewAs])

  const handleSelectUser = useCallback((u: AppUser) => {
    setViewAsUser(u)
    setPickerOpen(false)
    setOpen(false)
    // Navigate to customer portal so the view takes effect immediately
    navigate('/portal/dashboard', { replace: true })
  }, [setViewAsUser, navigate])

  const handleSwitchRole = useCallback((role: UserRole) => {
    if (!realUser) return
    if (isRolePreview && viewAsUser?.role === role) {
      // Clicking the active preview role → exit preview
      exitViewAs()
      setOpen(false)
      return
    }
    if (!isViewingAs && role === realUser.role) {
      // Already on own role, just close
      setOpen(false)
      return
    }
    if (role === realUser.role) {
      // Exit preview back to own role
      exitViewAs()
      setOpen(false)
      navigate(ROLE_HOME[role], { replace: true })
      return
    }
    setViewAsUser({ ...realUser, role })
    setOpen(false)
    navigate(ROLE_HOME[role], { replace: true })
  }, [realUser, isViewingAs, isRolePreview, viewAsUser, exitViewAs, setViewAsUser, navigate])

  return (
    <>
      <header className="topbar">
        <div className="topbar__title-wrap">
          {onMenuClick && (
            <button
              type="button"
              className="topbar__menu-btn"
              onClick={onMenuClick}
              aria-label="Open navigation"
            >
              <Menu size={22} color="#ffffff" />
            </button>
          )}
          <h1 className="topbar__title">{title}</h1>
        </div>
        <div className="topbar__actions">
          <NotificationBell />
          <div className="topbar__avatar-wrap" ref={containerRef}>
            <button
              className={`topbar__avatar ${open ? 'topbar__avatar--open' : ''}${isViewingAs ? ' topbar__avatar--viewing-as' : ''}`}
              aria-label="Account menu"
              aria-expanded={open}
              aria-haspopup="true"
              onClick={() => setOpen((v) => !v)}
            >
              {displayUser?.avatarUrl ? (
                <img src={displayUser.avatarUrl} alt="" className="topbar__avatar-img" />
              ) : (
                <span className="topbar__avatar-initials">{initials}</span>
              )}
              {isViewingAs && <span className="topbar__avatar-va-dot" aria-label="Viewing as another user" />}
            </button>

            {open && (
              <div className="topbar__dropdown" role="menu">
                <div className="topbar__dropdown-header">
                  <span className="topbar__dropdown-name">{displayUser?.name ?? 'Account'}</span>
                  <span className="topbar__dropdown-email">{displayUser?.email}</span>
                </div>
                <div className="topbar__dropdown-divider" />

                {/* View As (admin only) */}
                {isAdmin && (
                  <>
                    <button
                      className="topbar__dropdown-item topbar__dropdown-item--view-as"
                      role="menuitem"
                      onClick={() => { setOpen(false); setPickerOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                      </svg>
                      View as customer…
                    </button>

                    {isViewingAs && !isRolePreview && (
                      <button
                        className="topbar__dropdown-item topbar__dropdown-item--exit-view-as"
                        role="menuitem"
                        onClick={() => { exitViewAs(); setOpen(false); navigate('/portal/dashboard', { replace: true }) }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                        Exit view as {viewAsUser?.name}
                      </button>
                    )}
                    <div className="topbar__dropdown-divider" />

                    <div className="topbar__dropdown-section">
                      <span className="topbar__dropdown-section-label">Preview role</span>
                      <div className="topbar__roles">
                        {(['admin', 'dispatch', 'driver', 'sales', 'customer'] as UserRole[]).map((r) => (
                          <button
                            key={r}
                            className={`topbar__role-pill topbar__role-pill--${r}${activePreviewRole === r ? ' topbar__role-pill--active' : ''}`}
                            onClick={() => handleSwitchRole(r)}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="topbar__dropdown-divider" />

                    {/* Create User shortcut */}
                    <button
                      className="topbar__dropdown-item topbar__dropdown-item--create-user"
                      role="menuitem"
                      onClick={() => { setOpen(false); setCreateUserOpen(true) }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <line x1="19" y1="8" x2="19" y2="14" />
                        <line x1="16" y1="11" x2="22" y2="11" />
                      </svg>
                      Create user…
                    </button>

                    {/* Manage Users link */}
                    <button
                      className="topbar__dropdown-item topbar__dropdown-item--manage-users"
                      role="menuitem"
                      onClick={() => { setOpen(false); navigate('/admin/users') }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 00-3-3.87" />
                        <path d="M16 3.13a4 4 0 010 7.75" />
                      </svg>
                      Manage users →
                    </button>
                    <div className="topbar__dropdown-divider" />
                  </>
                )}

                <button
                  className="topbar__dropdown-item topbar__dropdown-item--danger"
                  role="menuitem"
                  disabled={loggingOut}
                  onClick={handleLogout}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  {loggingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {pickerOpen && (
        <ViewAsModal
          onClose={() => setPickerOpen(false)}
          onSelect={handleSelectUser}
        />
      )}

      {createUserOpen && (
        <CreateUserModal
          onClose={() => setCreateUserOpen(false)}
          onCreated={() => setCreateUserOpen(false)}
        />
      )}
    </>
  )
}
