import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { signOut } from '../../lib/auth'
import { NotificationBell } from './NotificationBell'
import './TopBar.css'

interface TopBarProps {
  title: string
}

export const TopBar: React.FC<TopBarProps> = ({ title }) => {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [open, setOpen]     = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n: string) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : (user?.email?.[0] ?? '?').toUpperCase()

  // Close on outside click
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
    setLoggingOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate])

  return (
    <header className="topbar">
      <h1 className="topbar__title">{title}</h1>
      <div className="topbar__actions">
        <NotificationBell />
        <div className="topbar__avatar-wrap" ref={containerRef}>
          <button
            className={`topbar__avatar ${open ? 'topbar__avatar--open' : ''}`}
            aria-label="Account menu"
            aria-expanded={open}
            aria-haspopup="true"
            onClick={() => setOpen((v) => !v)}
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="topbar__avatar-img" />
            ) : (
              <span className="topbar__avatar-initials">{initials}</span>
            )}
          </button>

          {open && (
            <div className="topbar__dropdown" role="menu">
              <div className="topbar__dropdown-header">
                <span className="topbar__dropdown-name">{user?.name ?? 'Account'}</span>
                <span className="topbar__dropdown-email">{user?.email}</span>
              </div>
              <div className="topbar__dropdown-divider" />
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
  )
}
