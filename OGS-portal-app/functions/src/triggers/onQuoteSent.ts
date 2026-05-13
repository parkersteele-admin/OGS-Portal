/**
 * functions/src/triggers/onQuoteSent.ts
 *
 * Firestore onDocumentWritten trigger for quotes/{quoteId}.
 *
 * When a quote's status transitions to 'sent' or 'accepted' for the first time
 * (from any previous status):
 *   1. Set pricingUnlocked = true on the customer document.
 *
 * NOTE: The quote email with the public acceptance link is sent by the
 * generateQuotePdf callable — NOT here. Sending it here would produce a second
 * plain email that points to the login-required portal instead of the public
 * token URL. Do not add email sending to this trigger.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'

function buildOrderGroupId(): string {
  return `QO-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`
}

function getQuoteItems(raw: unknown): Array<{ productId: string; description: string; quantity: number; unitPrice: number; amount: number }> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const data = item as Record<string, unknown>
      return {
        productId: typeof data.productId === 'string' ? data.productId : '',
        description: typeof data.description === 'string' ? data.description : 'Quote item',
        quantity: typeof data.quantity === 'number' ? data.quantity : Number(data.quantity ?? 0),
        unitPrice: typeof data.unitPrice === 'number' ? data.unitPrice : Number(data.unitPrice ?? 0),
        amount: typeof data.amount === 'number' ? data.amount : Number(data.amount ?? 0),
      }
    })
    .filter((item) => item.quantity > 0)
}

export const onQuoteSent = onDocumentWritten(
  { document: 'quotes/{quoteId}' },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!after) return

    const beforeStatus = before?.status as string | undefined
    const afterStatus  = after.status  as string
    const quoteId = event.params.quoteId

    // Only act when status first transitions to 'sent' or 'accepted'
    const isUnlockingStatus = afterStatus === 'sent' || afterStatus === 'accepted'
    const wasAlreadyUnlocking = beforeStatus === 'sent' || beforeStatus === 'accepted'
    if (!isUnlockingStatus) return

    const customerId = after.customerId as string | undefined
    if (!customerId) return

    if (!wasAlreadyUnlocking) {
      await db.collection('customers').doc(customerId).update({
        pricingUnlocked: true,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    // Fail-safe: if a quote reaches accepted state without an order linkage,
    // create the operational order so it appears in /admin/ops/orders.
    const transitionedToAccepted = afterStatus === 'accepted' && beforeStatus !== 'accepted'
    if (!transitionedToAccepted) return

    if (after.convertedOrderId) return

    const existingOrderSnap = await db
      .collection('orders')
      .where('quoteId', '==', quoteId)
      .limit(1)
      .get()

    if (!existingOrderSnap.empty) {
      const existingOrderId = existingOrderSnap.docs[0].id
      await db.collection('quotes').doc(quoteId).update({
        convertedOrderId: existingOrderId,
        convertedOrderIds: [existingOrderId],
        needsOrderSetup: false,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const quoteItems = getQuoteItems(after.lineItems)
    const eligible = quoteItems.filter((item) => item.productId !== 'delivery' && item.productId !== 'rental')
    const [primary, ...rest] = (eligible.length > 0 ? eligible : quoteItems)
    if (!primary) return

    const groupId = buildOrderGroupId()
    const subtotal = (eligible.length > 0 ? eligible : [primary]).reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : item.quantity * item.unitPrice), 0)
    const deliveryFee = 35
    const total = subtotal + deliveryFee
    const addOnAddedAt = new Date().toISOString()
    const repFields = Object.fromEntries(
      Object.entries({
        salesRepId: (after.salesRepId as string | undefined) ?? undefined,
        salesRepName: (after.salesRepName as string | undefined) ?? undefined,
        salesRepEmail: (after.salesRepEmail as string | undefined) ?? undefined,
        salesRepPhone: (after.salesRepPhone as string | undefined) ?? undefined,
      }).filter(([, value]) => value !== undefined),
    )

    const orderRef = db.collection('orders').doc()
    await orderRef.set({
      customerId,
      productId: primary.productId,
      quantity: primary.quantity,
      deliveryTier: 'standard',
      unitPrice: primary.unitPrice,
      upchargePercent: 0,
      subtotal,
      deliveryFee,
      total,
      status: 'pending',
      groupId,
      orderType: 'offRoute',
      quoteId,
      quoteNumber: (after.quoteNumber as string | undefined) ?? null,
      ...repFields,
      approvedByName: (after.approval as Record<string, unknown> | undefined)?.approvedByName ?? null,
      approvedByEmail: (after.approval as Record<string, unknown> | undefined)?.approvedByEmail ?? null,
      primaryCommunicationMethod: (after.approval as Record<string, unknown> | undefined)?.primaryCommunicationMethod ?? 'email',
      paymentPreference: (after.approval as Record<string, unknown> | undefined)?.paymentChoice ?? 'undecided',
      quoteProvidedTo: (after.approval as Record<string, unknown> | undefined)?.quoteProvidedTo ?? null,
      quotedLineItems: eligible,
      addOns: rest.map((item) => ({
        productId: item.productId,
        productName: item.description,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        addedBy: 'quote_acceptance_trigger',
        // Firestore sentinels are not valid inside array elements.
        addedAt: addOnAddedAt,
      })),
      notes: `Accepted quote ${(after.quoteNumber as string | undefined) ?? quoteId} auto-converted to order.`,
      deliveryContactName: (after.approval as Record<string, unknown> | undefined)?.deliveryContactName ?? null,
      deliveryContactPhone: (after.approval as Record<string, unknown> | undefined)?.deliveryContactPhone ?? null,
      deliveryContactEmail: (after.approval as Record<string, unknown> | undefined)?.deliveryContactEmail ?? null,
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await db.collection('quotes').doc(quoteId).update({
      convertedOrderId: orderRef.id,
      convertedOrderIds: [orderRef.id],
      orderGroupId: groupId,
      needsOrderSetup: false,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)
