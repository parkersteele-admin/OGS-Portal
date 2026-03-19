/**
 * functions/src/generateRunManifest.ts
 *
 * Firestore trigger: runs/{runId} onCreate
 *
 * Generates the truck load manifest for a newly created run by expanding
 * all line items and add-ons assigned to each stop into individual cylinder
 * records in /runs/{runId}/manifest/{cylinderId}.
 *
 * Also sets Run.loadStatus = 'pending' to signal the driver-facing load
 * checklist that the truck has not yet been loaded.
 *
 * TODO: read all orders assigned to this run's stops
 * TODO: expand lineItems and addOns into individual cylinder records
 *       (one ManifestItem per physical cylinder, not per order line)
 * TODO: resolve cylinderId from /cylinders by productId + status='available'
 * TODO: write one doc per cylinder to /runs/{runId}/manifest/{cylinderId}
 * TODO: set Run.loadStatus = 'pending'
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import './admin'

export const generateRunManifest = onDocumentCreated(
  'runs/{runId}',
  async (event) => {
    const runId = event.params.runId
    const db = getFirestore()

    // TODO: implement manifest generation
    // Stub: just mark the run as pending so the driver UI shows the load prompt
    await db.collection('runs').doc(runId).update({
      loadStatus: 'pending',
    })
  },
)
