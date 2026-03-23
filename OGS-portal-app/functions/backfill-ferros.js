const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

initializeApp({
  credential: cert(require('/Users/parkersteele/Documents/OGS-Portal-App/ogs-portal-firebase-adminsdk-fbsvc-afadf3dbfb.json'))
})
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

  for (const d of snap.docs) {
    console.log('Found customer:', d.id, d.data().companyName)
    const existing = await db.collection('leads').doc(d.id).get()
    if (existing.exists) {
      console.log('  Lead already exists — skipping')
      continue
    }
    const now = new Date()
    await db.collection('leads').doc(d.id).set({
      companyId: d.id,
      companyName: d.data().companyName,
      businessType: d.data().businessType || null,
      stage: 'new_signup',
      assignedTo: null,
      assignedAt: null,
      priority: 'normal',
      estimatedMonthlyValue: 0,
      source: 'online_signup',
      notes: [],
      tags: [],
      lostReason: null,
      nextFollowUpAt: null,
      stageHistory: [{ stage: 'new_signup', enteredAt: now, exitedAt: null, actor: 'system', note: null }],
      createdAt: now,
      updatedAt: now,
    })
    console.log('  Lead created for', d.data().companyName)
  }
}

run().catch((err) => { console.error(err); process.exit(1) })
