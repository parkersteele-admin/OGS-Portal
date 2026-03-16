/**
 * src/components/ui/ViewAsBanner.tsx
 *
 * Sticky banner shown at the top of any layout whenever an admin is in
 * "View as" mode. Displays the impersonated user's name and a button to exit.
 */

import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useViewAsStore } from '../../store/viewAsStore'
import { useAuth } from '../../hooks/useAuth'
import './ViewAsBanner.css'

export const ViewAsBanner: React.FC = () => {
  const { isViewingAs, user, realUser } = useAuth()
  const { exitViewAs } = useViewAsStore()
  const navigate = useNavigate()

  // Role-preview: admin set viewAsUser to a synthetic copy of themselves with a different role
  const isRolePreview = isViewingAs && user?.id === realUser?.id

  const handleExit = useCallback(() => {
    exitViewAs()
    // Role-preview → return to admin home; user-impersonation → return to customer portal
    navigate(realUser ? (isRolePreview ? '/portal/dashboard' : '/portal/dashboard') : '/portal/dashboard', { replace: true })
  }, [exitViewAs, navigate, realUser, isRolePreview])

  if (!isViewingAs || !user) return null

  return (
    <div
      className={`va-banner${isRolePreview ? ' va-banner--role' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="va-banner__inner">
        <svg
          className="va-banner__icon"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {isRolePreview ? (
          <span className="va-banner__text">
            Previewing as <strong>{user.role}</strong> role
          </span>
        ) : (
          <span className="va-banner__text">
            Viewing as <strong>{user.name}</strong>
            {user.email && (
              <span className="va-banner__email"> ({user.email})</span>
            )}
          </span>
        )}
      </div>

      <button className="va-banner__exit" onClick={handleExit}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6"  y1="6" x2="18" y2="18" />
        </svg>
        Exit
      </button>
    </div>
  )
}
