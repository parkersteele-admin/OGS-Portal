import { useState, useEffect, useRef } from 'react'
import { onSnapshot, query, orderBy } from 'firebase/firestore'
import { runStopsCol } from '../lib/firestore'
import { db } from '../lib/firebase'
import { doc } from 'firebase/firestore'
import type { Run } from '../types/run'
import type { RunStop } from '../types/run'

interface UseActiveRunResult {
  run: Run | null
  stops: RunStop[]
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to a run document and its ordered stops in real time.
 * Used by the dispatch live map and the driver schedule view.
 */
export function useActiveRun(runId: string | null | undefined): UseActiveRunResult {
  const [run, setRun] = useState<Run | null>(null)
  const [stops, setStops] = useState<RunStop[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Track whether both subscriptions have delivered their first snapshot
  const runReady = useRef(false)
  const stopsReady = useRef(false)

  useEffect(() => {
    if (!runId) {
      setRun(null)
      setStops([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    runReady.current = false
    stopsReady.current = false

    const checkBothReady = () => {
      if (runReady.current && stopsReady.current) setLoading(false)
    }

    const unsubRun = onSnapshot(
      doc(db, 'runs', runId),
      (snap) => {
        setRun(snap.exists() ? ({ id: snap.id, ...snap.data() } as Run) : null)
        runReady.current = true
        checkBothReady()
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    const unsubStops = onSnapshot(
      query(runStopsCol(runId), orderBy('order')),
      (snap) => {
        setStops(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as RunStop))
        stopsReady.current = true
        checkBothReady()
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return () => {
      unsubRun()
      unsubStops()
    }
  }, [runId])

  return { run, stops, loading, error }
}
