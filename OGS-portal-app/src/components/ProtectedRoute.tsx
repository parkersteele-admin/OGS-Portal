import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME } from '../types/auth'
import type { UserRole } from '../types/auth'

interface ProtectedRouteProps {
  role: UserRole | UserRole[]
  children: React.ReactNode
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ role, children }) => {
  const { user, loading, role: userRole } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="layout-loading"><span className="layout-loading__spinner" /></div>
  }

  if (!user || !userRole) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const allowed = Array.isArray(role) ? role : [role]
  if (!allowed.includes(userRole)) {
    return <Navigate to={ROLE_HOME[userRole]} replace />
  }

  return <>{children}</>
}
