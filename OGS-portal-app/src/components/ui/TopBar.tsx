import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { NotificationBell } from './NotificationBell'
import './TopBar.css'

interface TopBarProps {
  title: string
}

export const TopBar: React.FC<TopBarProps> = ({ title }) => {
  const { user } = useAuth()
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n: string) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : (user?.email?.[0] ?? '?').toUpperCase()

  return (
    <header className="topbar">
      <h1 className="topbar__title">{title}</h1>
      <div className="topbar__actions">
        <NotificationBell />
        <button className="topbar__avatar" aria-label={`Account: ${user?.name ?? user?.email}`}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="topbar__avatar-img" />
          ) : (
            <span className="topbar__avatar-initials">{initials}</span>
          )}
        </button>
      </div>
    </header>
  )
}
