import { useState, useEffect, useCallback } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Notification } from '../types/index'

interface UseUnreadNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  /** Marks a single notification as read. */
  markRead: (notifId: string) => Promise<void>
  /** Marks all current unread notifications as read. */
  markAllRead: () => Promise<void>
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to unread notifications for the given user in real time.
 * Used by the TopBar notification bell.
 */
export function useUnreadNotifications(
  userId: string | null | undefined,
): UseUnreadNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!userId) {
      setNotifications([])
      setLoading(false)
      return
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      where('read', '==', false),
    )

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setNotifications(
          snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Notification),
        )
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [userId])

  const markRead = useCallback(async (notifId: string) => {
    await updateDoc(doc(db, 'notifications', notifId), { read: true })
  }, [])

  const markAllRead = useCallback(async () => {
    await Promise.all(
      notifications.map((n) =>
        updateDoc(doc(db, 'notifications', n.id), { read: true }),
      ),
    )
  }, [notifications])

  return {
    notifications,
    unreadCount: notifications.length,
    markRead,
    markAllRead,
    loading,
    error,
  }
}

// Keep the legacy export used by the TopBar NotificationBell (unreadCount only).
export function useNotifications(uid: string | undefined): { unreadCount: number } {
  const { unreadCount } = useUnreadNotifications(uid)
  return { unreadCount }
}

