import React, { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import './NotificationBell.css'

export const NotificationBell: React.FC = () => {
  const { user } = useAuth()
  const { unreadCount } = useNotifications(user?.id)
  const [open, setOpen] = useState(false)

  return (
    <div className="notif">
      <button
        className="notif__btn"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Bell icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <p className="notif__empty">No new notifications</p>
        </div>
      )}
    </div>
  )
}
