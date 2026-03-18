/**
 * functions/src/triggers/onRunCreated.ts
 *
 * Trigger: Firestore onDocumentCreated — runs/{runId}
 *
 * Sends an in-app notification to the assigned driver when a new run is
 * created. Notifications cannot be written directly by the client (rules
 * enforce `allow create: if false`), so this trigger handles it server-side.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { db } from '../admin'
import { createNotification } from '../notifications/createNotification'

export const onRunCreated = onDocumentCreated(
  { document: 'runs/{runId}' },
  async (event) => {
    const run = event.data?.data()
    if (!run) return

    const { runId } = event.params
    const driverId: string | undefined = run.driverId

    if (!driverId) return

    // Resolve a human-readable run label (notes field holds the run name set in RunBuilder)
    const runLabel: string = run.notes || `Run ${runId.slice(-6).toUpperCase()}`

    // Fetch the total stop count from the stopIds array written in the same batch
    const stopCount: number = Array.isArray(run.stopIds) ? run.stopIds.length : 0

    // Format the scheduled date
    let dateStr = ''
    try {
      const d: Date =
        run.scheduledDate && typeof run.scheduledDate.toDate === 'function'
          ? run.scheduledDate.toDate()
          : new Date(run.scheduledDate)
      dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    } catch {
      // fallback — omit date from body
    }

    // Verify the driver still exists before notifying
    const driverSnap = await db.collection('users').doc(driverId).get()
    if (!driverSnap.exists) {
      console.warn(`onRunCreated [run=${runId}]: driver ${driverId} not found — skipping notification`)
      return
    }

    await createNotification({
      userId:   driverId,
      type:     'run_assigned',
      title:    'New run assigned',
      body:     [
        runLabel,
        stopCount > 0 ? `${stopCount} stop${stopCount !== 1 ? 's' : ''}` : null,
        dateStr || null,
      ].filter(Boolean).join(' · '),
      link:     '/driver/schedule',
      entityId: runId,
      priority: 'high',
    })
  },
)
