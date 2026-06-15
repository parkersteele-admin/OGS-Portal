import { useState, useEffect } from 'react'
import { onSnapshot, query, orderBy, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { runStopsCol } from '../lib/firestore'
import { useFirestoreSubscription } from './useFirestoreSubscription'
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
 * 
 * Note: Run document uses direct onSnapshot since it's a single doc.
 * Stops use generic useFirestoreSubscription for consistency.
 */
export function useActiveRun(runId: string | null | undefined): UseActiveRunResult {
  const [run, setRun] = useState<Run | null>(null)
  const [runLoading, setRunLoading] = useState(true)
  const [runError, setRunError] = useState<Error | null>(null)

  // Subscribe to run document (single doc, use direct onSnapshot)
  useEffect(() => {
    if (!runId) {
      setRun(null)
      setRunLoading(false)
      return
    }

    const unsubscribe = onSnapshot(
      doc(db, 'runs', runId),
      (snap) => {
        if (snap.exists()) {
          setRun({ id: snap.id, ...snap.data() } as Run)
        } else {
          setRun(null)
        }
        setRunLoading(false)
      },
      (err) => {
        setRunError(err)
        setRunLoading(false)
      },
    )

    return unsubscribe
  }, [runId])

  // Subscribe to run stops (collection, use generic hook)
  const { data: stops, loading: stopsLoading } = useFirestoreSubscription<RunStop>(
    query(runStopsCol(runId!), orderBy('order')),
    !!runId,
  )

  return {
    run: runId ? run : null,
    stops: runId ? stops : [],
    loading: runId ? runLoading || stopsLoading : false,
    error: runId ? runError : null,
  }
}
