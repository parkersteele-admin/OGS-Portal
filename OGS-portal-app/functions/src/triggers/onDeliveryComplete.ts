/**
 * functions/src/triggers/onDeliveryComplete.ts
 *
 * Trigger: Firestore onDocumentUpdated — runs/{runId}/stops/{stopId}
 * Condition: stop.status transitions to 'delivered' or 'completed'
 *
 * Execution sequence (each step wrapped in try/catch — see below):
 *
 *  1. [Transaction] Update order:     status='delivered', deliveredAt, quantityDelivered
 *  2. [Transaction] Update tank level: recalculate currentLevelPct, lastFilledAt
 *  2b.              Clear any pending low-level alerts if new level > 25%
 *  3.               Delivery confirmation email to customer
 *  4.               In-app notification for dispatch
 *  [bonus]          Run completion check: mark run 'completed' if all stops delivered
 *
 * Error strategy:
 *  - Steps 1+2 (transaction): re-throw on failure — function retries are desirable
 *  - Steps 3-4 + run check:   catch + log, continue — delivery is complete regardless
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { sendEmail } from '../mail'
import { createNotification } from '../notifications/createNotification'
import { appendStatusHistory } from '../lib/orderStatus'

// ── Trigger ───────────────────────────────────────────────────────────────────

export const onDeliveryComplete = onDocumentUpdated(
  {
    document:      'runs/{runId}/stops/{stopId}',
    memory:        '512MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()

    // React only when a stop first enters a delivery-complete state.
    const beforeStatus = before?.status as string | undefined
    const afterStatus = after?.status as string | undefined
    const wasDeliveryComplete = beforeStatus === 'delivered' || beforeStatus === 'completed'
    const isDeliveryComplete = afterStatus === 'delivered' || afterStatus === 'completed'

    if (!after || wasDeliveryComplete || !isDeliveryComplete) {
      return
    }

    // Signed-delivery flow is handled end-to-end by finalizeSignedDelivery callable.
    // Skip here to avoid duplicate invoice emails/notifications.
    if (afterStatus === 'completed' && (after.signedAt || after.signatureUrl)) {
      return
    }

    const { runId, stopId } = event.params
    const orderId           = after.orderId          as string | undefined
    const quantityDelivered = (after.quantityDelivered ?? after.gallonsDelivered ?? after.gallons ?? 0) as number

    if (!orderId) {
      console.error(`onDeliveryComplete [stop=${stopId}]: missing orderId — skipping`)
      return
    }

    console.log(`onDeliveryComplete: run=${runId} stop=${stopId} order=${orderId} qty=${quantityDelivered}`)

    // Shared state accumulated across steps
    let orderData:    Record<string, unknown> | undefined
    let tankId:       string | undefined
    let newLevelPct   = 0
    let customerId:   string | undefined
    let customerData: Record<string, unknown> | null = null

    // ── Steps 1 + 2: Transaction ─────────────────────────────────────────────
    try {
      await db.runTransaction(async (tx) => {
        // ── Read order ────────────────────────────────────────────────────────
        const orderRef  = db.collection('orders').doc(orderId)
        const orderSnap = await tx.get(orderRef)
        if (!orderSnap.exists) {
          throw new Error(`Order ${orderId} not found`)
        }
        orderData  = orderSnap.data() as Record<string, unknown>
        tankId     = orderData.tankId  as string | undefined
        customerId = orderData.customerId as string | undefined

        // ── Step 1: Update order ──────────────────────────────────────────────
        const shouldMarkReadyToInvoice =
          afterStatus === 'completed' && (orderData.deliveryStatus as string | undefined) !== 'signed'
        const nextOrderStatus = shouldMarkReadyToInvoice ? 'ready_to_invoice' : 'delivered'
        tx.update(orderRef, {
          status:             nextOrderStatus,
          deliveredAt:        FieldValue.serverTimestamp(),
          quantityDelivered,
          updatedAt:          FieldValue.serverTimestamp(),
        })

        // ── Step 2: Update tank level ─────────────────────────────────────────
        if (tankId) {
          const tankRef  = db.collection('tanks').doc(tankId)
          const tankSnap = await tx.get(tankRef)

          if (tankSnap.exists) {
            const tank     = tankSnap.data() as Record<string, unknown>
            const capacity = Math.max((tank.capacityGallons as number) || 500, 1)
            const current  = (tank.currentLevelPct  as number) ?? 0
            newLevelPct    = Math.min(100, current + (quantityDelivered / capacity) * 100)

            tx.update(tankRef, {
              currentLevelPct: newLevelPct,
              lastFilledAt:    FieldValue.serverTimestamp(),
              updatedAt:       FieldValue.serverTimestamp(),
            })
          }
        }
      })

      console.log(`onDeliveryComplete [${orderId}]: order + tank updated in transaction`)
    } catch (err) {
      console.error(`onDeliveryComplete [${orderId}]: transaction failed —`, err)
      throw err // re-throw: Functions will retry
    }

    if (afterStatus === 'completed' && (orderData?.deliveryStatus as string | undefined) !== 'signed') {
      await appendStatusHistory(
        db,
        orderId,
        'ready_to_invoice',
        'system:onDeliveryComplete',
        'Delivery Completion Trigger',
        'Stop marked completed and moved to ready_to_invoice.',
      )
    }

    // ── Step 2b: Clear pending low-level alerts ───────────────────────────────
    if (tankId && newLevelPct > LOW_LEVEL_THRESHOLD_PCT) {
      try {
        const alertsSnap = await db
          .collection('notifications')
          .where('entityId', '==', tankId)
          .where('type',     '==', 'low_tank_level')
          .where('read',     '==', false)
          .get()

        if (!alertsSnap.empty) {
          const batch = db.batch()
          alertsSnap.docs.forEach((d) => batch.update(d.ref, { read: true }))
          await batch.commit()
          console.log(`onDeliveryComplete [${orderId}]: cleared ${alertsSnap.size} low-level alert(s)`)
        }
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: failed to clear alerts —`, err)
      }
    }

    // ── Fetch customer record (needed for step 3) ────────────────────────────
    if (customerId) {
      try {
        const snap = await db.collection('customers').doc(customerId).get()
        customerData = snap.exists ? (snap.data() as Record<string, unknown>) : null
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: failed to fetch customer —`, err)
      }
    }

    // ── Step 3: Delivery confirmation email ───────────────────────────────────
    if (customerData?.email) {
      try {
        const tankLine = tankId && newLevelPct > 0
          ? `<p>Your tank is now at approximately <strong>${Math.round(newLevelPct)}%</strong> capacity.</p>`
          : ''

        await sendEmail({
          to:      customerData.email as string,
          subject: 'Delivery Complete — OGS Portal',
          html: `
            <h2>Your Delivery is Complete</h2>
            <p>Hi ${customerData.name as string},</p>
            <p>Your gas delivery of <strong>${quantityDelivered.toFixed(1)} gallons</strong>
            has been completed successfully.</p>
            ${tankLine}
            <p>Thank you for choosing OGS Portal.</p>
            <p style="color:#666;font-size:12px">— The OGS Portal Team</p>
          `,
        })
        console.log(`onDeliveryComplete [${orderId}]: confirmation email sent`)
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: confirmation email failed —`, err)
      }
    }

    // ── Step 4: In-app notification for dispatch ──────────────────────────────
    const orderNum = (orderData!.orderNumber as string | undefined) ?? orderId
    await createNotification({
      userId:   null,
      role:     'dispatch',
      type:     'delivery_complete',
      title:    'Delivery Complete',
      body:     `Order ${orderNum} delivered — ${quantityDelivered.toFixed(1)} gal.`,
      entityId: orderId,
    })
    console.log(`onDeliveryComplete [${orderId}]: dispatch notification created`)

    // ── Run completion check ──────────────────────────────────────────────────
    // Mark run complete when every stop is in a terminal state.
    try {
      const stopsSnap   = await db.collection(`runs/${runId}/stops`).get()
      const terminalStates = new Set(['delivered', 'completed', 'skipped', 'failed'])
      const allTerminal = stopsSnap.docs.every((d) =>
        terminalStates.has(d.data().status as string),
      )

      if (allTerminal) {
        await db.collection('runs').doc(runId).update({
          status:      'completed',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt:   FieldValue.serverTimestamp(),
        })
        console.log(`onDeliveryComplete [${orderId}]: run ${runId} marked complete`)
      }
    } catch (err) {
      console.error(`onDeliveryComplete [${orderId}]: run completion check failed —`, err)
    }

    console.log(`onDeliveryComplete [${orderId}]: all steps complete`)
  },
)
