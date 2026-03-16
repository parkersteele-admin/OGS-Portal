import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { UserRole } from '../types/auth'

interface UseUserRoleResult {
  userRole: UserRole | null
  roleLoading: boolean
}

export function useUserRole(uid: string | undefined): UseUserRoleResult {
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setUserRole(null)
      setRoleLoading(false)
      return
    }

    let cancelled = false

    getDoc(doc(db, 'users', uid))
      .then((snap) => {
        if (!cancelled) {
          setUserRole((snap.data()?.role as UserRole) ?? null)
          setRoleLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUserRole(null)
          setRoleLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [uid])

  return { userRole, roleLoading }
}
