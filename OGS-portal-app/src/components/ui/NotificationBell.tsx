import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { formatRelative } from '../../utils/format'
import type { NotificationType } from '../../types/index'
import './NotificationBell.css'

// ─── Per-type icon map ────────────────────────────────────────────────────────

const typeIconBg: Record<string, string> = {
  rush_order:        'var(--color-warning)',
  delivery_complete: 'var(--color-success)',
  payment_received:  'var(--color-success)',
  payment_failed:    'var(--color-danger)',
  low_tank:          'var(--color-warning)',
  overdue_invoice:   'var(--color-danger)',
  cert_expiry:       'var(--color-warning)',
}

function NotifIcon({ type }: { type: NotificationType | string }) {
  const bg = typeIconBg[type] ?? 'var(--color-primary)'

  let path: React.ReactNode

  switch (type) {
    case 'rush_order':
      // shopping bag
      path = (
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" />
      )
      break
    case 'delivery_complete':
      // check circle
      path = (
        <>
          <circle cx="12" cy="12" r="10" />
          <polyline points="9 12 11 14 15 10" />
        </>
      )
      break
    case 'payment_received':
      // dollar sign circle
      path = (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <path d="M9 10h4.5a1.5 1.5 0 010 3H9a1.5 1.5 0 000 3H14" />
        </>
      )
      break
    case 'payment_failed':
      // x circle
      path = (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </>
      )
      break
    case 'low_tank':
    case 'cert_expiry':
      // warning triangle
      path = (
        <>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </>
      )
      break
    case 'overdue_invoice':
      // clock
      path = (
        <>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </>
      )
      break
    default:
      // bell
      path = (
        <>
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </>
      )
  }

  return (
    <span className="notif__icon" style={{ background: bg }} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {path}
      </svg>
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export const NotificationBell: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { notifications, unreadCount, markRead, markAllRead, loading } =
    useNotifications(user?.id)

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleItemClick = useCallback(
    async (id: string, link: string | undefined, read: boolean) => {
      if (!read) await markRead(id)
      if (link) {
        setOpen(false)
        navigate(link)
      }
    },
    [markRead, navigate],
  )

  const handleMarkAll = useCallback(async () => {
    await markAllRead()
  }, [markAllRead])

  return (
    <div className="notif" ref={wrapperRef}>
      <button
        className="notif__btn"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="notif__badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif__popover" role="region" aria-label="Notifications">
          {/* Header */}
          <div className="notif__header">
            <span className="notif__heading">Notifications</span>
            {unreadCount > 0 && (
              <button className="notif__mark-all" onClick={handleMarkAll}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <p className="notif__empty">Loading…</p>
          ) : notifications.length === 0 ? (
            <div className="notif__empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="var(--color-text-3)" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <p className="notif__empty">No notifications</p>
            </div>
          ) : (
            <ul className="notif__list" role="list">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`notif__item${!n.read ? ' notif__item--unread' : ''}`}
                  role="listitem"
                  onClick={() => handleItemClick(n.id, n.link, n.read)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void handleItemClick(n.id, n.link, n.read)
                    }
                  }}
                >
                  <NotifIcon type={n.type} />
                  <div className="notif__content">
                    <p className="notif__title">{n.title}</p>
                    <p className="notif__body">{n.body}</p>
                  </div>
                  <span className="notif__time">
                    {n.createdAt ? formatRelative(n.createdAt) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
