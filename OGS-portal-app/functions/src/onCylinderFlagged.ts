/**
 * functions/src/onCylinderFlagged.ts
 *
 * Firestore trigger: runs/{runId}/flags/{cylinderId} onCreate
 *
 * Fires when a driver or dispatch member creates a flag record for a cylinder
 * that is missing from the truck or otherwise problematic.
 *
 * TODO: notify dispatch via push notification or email
 *       (use existing mail module: src/mail.ts + resend template)
 * TODO: write a summary doc to /alerts/{alertId} for the dispatch dashboard
 *       e.g. { type: 'cylinderFlag', runId, cylinderId, notes, createdAt }
 * TODO: optionally page on-call via Cloud Scheduler if flag is unresolved > N min
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import './admin'

export const onCylinderFlagged = onDocumentCreated(
  'runs/{runId}/flags/{cylinderId}',
  async (event) => {
    const { runId, cylinderId } = event.params
    const flagData = event.data?.data()

    if (!flagData) return

    const db = getFirestore()

    // TODO: send dispatch notification
    // TODO: write to /alerts collection for dispatch dashboard
    await db.collection('alerts').add({
      type: 'cylinderFlag',
      runId,
      cylinderId,
      notes: flagData.notes ?? '',
      reportedBy: flagData.reportedBy ?? '',
      reportedAt: flagData.reportedAt ?? null,
      resolved: false,
      createdAt: new Date(),
    })
  },
)
