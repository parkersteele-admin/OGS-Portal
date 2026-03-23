/**
 * One-time script: backfill the missing leads/{companyId} doc for Ferros Dynamics.
 * The onCustomerCreated trigger failed due to serverTimestamp-in-array bug (now fixed).
 * Run: npx ts-node --project tsconfig.node.json scripts/backfill-ferros-lead.ts
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'

const svcPath = './service-account.json'
if (!fs.existsSync(svcPath)) {
  console.error('service-account.json not found — download it from Firebase console > Project Settings > Service accounts')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(svcPath, 'utf8'))) })
const db = getFirestore()

async function run() {
  const snap = await db.collection('customers')
    .where('companyNameNormalized', '>=', 'ferros')
    .where('companyNameNormalized', '<=', 'ferros\uf8ff')
    .get()

  if (snap.empty) {
    console.log('No customer found matching "ferros"')
    return
  }

  for (const customerDoc of snap.docs) {
    const data = customerDoc.data()
    console.log(`Found customer: ${customerDoc.id} — ${data.companyName}`)

    const leadRef = db.collection('leads').doc(customerDoc.id)
    const existing = await leadRef.get()
    if (existing.exists) {
      console.log(`  Lead already exists — skipping`)
      continue
    }

    const now = new Date()
    await leadRef.set({
      companyId:              customerDoc.id,
      companyName:            data.companyName ?? 'Unknown',
      businessType:           data.businessType ?? null,
      stage:                  'new_signup',
      assignedTo:             null,
      assignedAt:             null,
      priority:               'normal',
      estimatedMonthlyValue:  0,
      source:                  'online_signup',
      notes:                  [],
      stageHistory:           [{ stage: 'new_signup', enteredAt: now, exitedAt: null, actor: 'system', note: null }],
      nextFollowUpAt:         null,
      tags:                   [],
      lostReason:             null,
      createdAt:              now,
      updatedAt:              now,
    })
    console.log(`  ✓ Lead created for ${data.companyName}`)
  }
}

run().catch((err) => { console.error(err); process.exit(1) })
