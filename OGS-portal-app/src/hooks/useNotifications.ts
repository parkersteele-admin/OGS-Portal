import { useCallback, useMemo } from 'react'
import {
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { notificationsCol } from '../lib/firestore'
import { useFirestoreSubscription } from './useFirestoreSubscription'
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
 * Used by the TopBar notification bell badge.
 * Refactored to use generic useFirestoreSubscription hook.
 */
export function useUnreadNotifications(
  userId: string | null | undefined,
): UseUnreadNotificationsResult {
  const { data: notifications, loading, error } = useFirestoreSubscription<Notification>(
    query(
      notificationsCol,
      where('userId', '==', userId ?? ''),
      where('read', '==', false),
    ),
    !!userId,
  )

  const markRead = useCallback(async (notifId: string) => {
    await updateDoc(doc(db, 'notifications', notifId), { read: true })
  }, [])

  const markAllRead = useCallback(async () => {
    if (notifications.length === 0) return
    const batch = writeBatch(db)
    notifications.forEach((n) =>
      batch.update(doc(db, 'notifications', n.id), { read: true }),
    )
    await batch.commit()
  }, [notifications])

  return {
    notifications: userId ? notifications : [],
    unreadCount: userId ? notifications.length : 0,
    markRead,
    markAllRead,
    loading: userId ? loading : false,
    error: userId ? error : null,
  }
}

interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  markRead: (notifId: string) => Promise<void>
  markAllRead: () => Promise<void>
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to the last 20 notifications for the given user (read + unread),
 * ordered newest-first. Also derives unreadCount for the badge.
 *
 * Use this in the NotificationBell dropdown.
 * Refactored to use generic useFirestoreSubscription hook.
 */
export function useNotifications(
  userId: string | null | undefined,
): UseNotificationsResult {
  const { data: notifications, loading, error } = useFirestoreSubscription<Notification>(
    query(
      notificationsCol,
      where('userId', '==', userId ?? ''),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
    !!userId,
  )

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  )

  const markRead = useCallback(async (notifId: string) => {
    await updateDoc(doc(db, 'notifications', notifId), { read: true })
  }, [])

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    const batch = writeBatch(db)
    unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }))
    await batch.commit()
  }, [notifications])

  return {
    notifications: userId ? notifications : [],
    unreadCount,
    markRead,
    markAllRead,
    loading: userId ? loading : false,
    error: userId ? error : null,
  }
}

