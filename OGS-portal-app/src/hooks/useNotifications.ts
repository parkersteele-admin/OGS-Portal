import { useState, useEffect, useCallback } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
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
    const unread = notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    const batch = writeBatch(db)
    unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }))
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
}

/**
 * Subscribes to the last 20 notifications for the given user (read + unread),
 * ordered newest-first.  Also derives unreadCount for the badge.
 *
 * Use this in the NotificationBell dropdown.
 * Use useUnreadNotifications when you only need the badge count.
 */
export function useNotifications(
  userId: string | null | undefined,
): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      return
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(20),
    )

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setNotifications(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Notification))
        setLoading(false)
      },
      () => setLoading(false),
    )

    return unsubscribe
  }, [userId])

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
    unreadCount: userId ? notifications.filter((n) => !n.read).length : 0,
    markRead,
    markAllRead,
    loading: userId ? loading : false,
  }
}

