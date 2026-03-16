import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDocs, query, orderBy } from 'firebase/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useViewAsStore } from '../../store/viewAsStore'
import { signOut } from '../../lib/auth'
import { usersCol } from '../../lib/firestore'
import { NotificationBell } from './NotificationBell'
import type { AppUser } from '../../types/user'
import './TopBar.css'

interface TopBarProps {
  title: string
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
    getDocs(query(usersCol, orderBy('name')))
      .then((snap) => {
        const all = snap.docs.map((d) => ({ ...d.data(), id: d.id } as AppUser))
        // Only show active customer-role accounts (admins can already see everything natively)
        setUsers(all.filter((u) => u.active && u.role === 'customer'))
      })
      .finally(() => setLoading(false))
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

export const TopBar: React.FC<TopBarProps> = ({ title }) => {
  const { user, realUser } = useAuth()
  const navigate  = useNavigate()
  const { viewAsUser, setViewAsUser, exitViewAs } = useViewAsStore()

  const [open,         setOpen]       = useState(false)
  const [pickerOpen,   setPickerOpen] = useState(false)
  const [loggingOut,   setLoggingOut] = useState(false)
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

  const isAdmin    = realUser?.role === 'admin'
  const isViewingAs = viewAsUser !== null

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

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">{title}</h1>
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

                    {isViewingAs && (
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
    </>
  )
}
