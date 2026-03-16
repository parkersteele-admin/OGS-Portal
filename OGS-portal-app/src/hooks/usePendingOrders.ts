import { useState, useEffect } from 'react'
import { onSnapshot, query, where, orderBy } from 'firebase/firestore'
import { ordersCol } from '../lib/firestore'
import type { Order } from '../types/order'

interface UsePendingOrdersResult {
  orders: Order[]
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to all orders with status 'pending', ordered by requestedAt ASC.
 * Used by the dispatch run builder to show the unscheduled order pool.
 */
export function usePendingOrders(): UsePendingOrdersResult {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        ordersCol,
        where('status', '==', 'pending'),
        orderBy('requestedAt', 'asc'),
      ),
      (snap) => {
        setOrders(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order))
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [])

  return { orders, loading, error }
}
