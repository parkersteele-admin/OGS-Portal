import { useState, useEffect } from 'react'
import { onSnapshot, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { RunStop } from '../types/run'

interface UseRunStopLiveResult {
  stop: RunStop | null
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to a single run stop document in real time.
 * Used by the driver stop detail view.
 */
export function useRunStopLive(
  runId: string | null | undefined,
  stopId: string | null | undefined,
): UseRunStopLiveResult {
  const [stop, setStop] = useState<RunStop | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!runId || !stopId) {
      setStop(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const unsubscribe = onSnapshot(
      doc(db, 'runs', runId, 'stops', stopId),
      (snap) => {
        setStop(snap.exists() ? ({ ...snap.data(), id: snap.id } as RunStop) : null)
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [runId, stopId])

  return { stop, loading, error }
}
