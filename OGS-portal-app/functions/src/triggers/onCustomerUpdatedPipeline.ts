/**
 * functions/src/triggers/onCustomerUpdatedPipeline.ts
 *
 * Firestore onUpdate trigger: customers/{companyId}
 * Advances the pipeline lead stage when customer onboarding progresses:
 *   setupStep > 0 & !setupComplete  → pending_setup
 *   status → 'pending_quote'        → quote_requested (+ calculateLeadValue)
 *   status → 'active'               → won
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { SENDGRID_API_KEY } from '../config'
import { sendEmail } from '../email/sendEmail'
import { calculateEstimatedValue } from '../lib/leadValue'

const STAGE_ORDER = [
  'new_signup',
  'pending_setup',
  'quote_requested',
  'quote_sent',
  'negotiating',
  'won',
]

function isForward(from: string, to: string): boolean {
  const fromIdx = STAGE_ORDER.indexOf(from)
  const toIdx   = STAGE_ORDER.indexOf(to)
  return toIdx > fromIdx
}

async function advanceStage(
  companyId: string,
  newStage: string,
  currentLead: FirebaseFirestore.DocumentData,
): Promise<void> {
  const currentStage = currentLead.stage as string
  if (currentStage === newStage) return
  if (!isForward(currentStage, newStage)) return  // only advance, never regress

  const now    = FieldValue.serverTimestamp()
  const nowDate = new Date()
  const history = Array.isArray(currentLead.stageHistory) ? currentLead.stageHistory : []
  const updated = history.map((e: Record<string, unknown>) =>
    e.exitedAt === null ? { ...e, exitedAt: nowDate } : e,
  )
  updated.push({ stage: newStage, enteredAt: nowDate, exitedAt: null, actor: 'system', note: null })

  await db.collection('leads').doc(companyId).update({
    stage: newStage,
    stageHistory: updated,
    updatedAt: now,
  })
}

export const onCustomerUpdatedPipeline = onDocumentUpdated(
  { document: 'customers/{companyId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!before || !after) return

    const { companyId } = event.params

    const leadSnap = await db.collection('leads').doc(companyId).get()
    if (!leadSnap.exists) return
    const lead = leadSnap.data()!

    // Guard: don't touch already-terminal leads
    if (lead.stage === 'won' || lead.stage === 'lost') return

    const setupStepChanged = before.setupStep !== after.setupStep
    const statusChanged    = before.status    !== after.status

    // pending_setup: customer started onboarding
    if (setupStepChanged && after.setupStep > 0 && !after.setupComplete) {
      await advanceStage(companyId, 'pending_setup', lead)
    }

    // quote_requested: customer finished setup + submitted quote request
    if (statusChanged && after.status === 'pending_quote') {
      await advanceStage(companyId, 'quote_requested', lead)

      // Calculate estimated monthly value
      try {
        const emv = await calculateEstimatedValue(companyId, after)
        if (emv > 0) {
          await db.collection('leads').doc(companyId).update({
            estimatedMonthlyValue: emv,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      } catch (err) {
        console.error('onCustomerUpdatedPipeline: calculateEstimatedValue failed', err)
      }

      // Email assigned rep
      try {
        const assignedUid = lead.assignedTo as string | null
        if (assignedUid) {
          const repSnap = await db.collection('users').doc(assignedUid).get()
          const repEmail = repSnap.data()?.email as string | undefined
          if (repEmail) {
            const emv = lead.estimatedMonthlyValue as number
            await sendEmail({
              to: repEmail,
              subject: `Quote requested: ${lead.companyName} — ~$${emv}/mo estimated`,
              html: `
                <p><strong>${lead.companyName}</strong> has completed setup and requested a quote.</p>
                <p><strong>Estimated monthly value:</strong> ~$${emv}/mo</p>
                <p><a href="https://app.ohiogassupply.com/ops/sales/dashboard">View in Pipeline →</a></p>
              `,
            })
          }
        }
      } catch (err) {
        console.error('onCustomerUpdatedPipeline: rep notification failed', err)
      }
    }

    // won: customer account activated
    if (statusChanged && after.status === 'active') {
      await advanceStage(companyId, 'won', lead)
    }
  },
)
