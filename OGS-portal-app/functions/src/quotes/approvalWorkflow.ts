import { db, FieldValue, adminAuth } from '../admin'
import { sendEmail } from '../email/sendEmail'
import { getCompanySettings } from '../pdf/companySettings'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import { generateTermsAcceptancePdf } from '../pdf/generateTermsAcceptancePdf'

type CommunicationMethod = 'email' | 'phone' | 'text'
type PaymentChoice = 'card_on_file' | 'net_terms' | 'cod' | 'send_invoice' | 'undecided'
type PaymentStatus = 'saved' | 'setup_requested' | 'invoice_requested' | 'not_provided'

export interface QuoteApprovalInput {
  approvedByName: string
  approvedByEmail?: string
  acceptedTerms: boolean
  deliveryContactName: string
  deliveryContactPhone?: string
  deliveryContactEmail?: string
  primaryCommunicationMethod: CommunicationMethod
  quoteProvidedTo?: string
  paymentChoice?: PaymentChoice
  requestPaymentSetup?: boolean
}

interface InternalRecipient {
  id: string
  email?: string
  name?: string
}

export interface CompleteQuoteAcceptanceArgs {
  quoteId: string
  quote: Record<string, unknown>
  customerId: string
  approval: QuoteApprovalInput
  acceptedByUid?: string
  acceptedVia: 'portal' | 'public-link'
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function buildCommunicationLabel(method: CommunicationMethod): string {
  switch (method) {
    case 'phone':
      return 'Phone'
    case 'text':
      return 'Text'
    default:
      return 'Email'
  }
}

function derivePaymentStatus(
  approval: QuoteApprovalInput,
  customer: Record<string, unknown> | null,
): PaymentStatus {
  if (customer?.autopayStripePaymentMethodId) return 'saved'
  if (approval.requestPaymentSetup || approval.paymentChoice === 'card_on_file') return 'setup_requested'
  if (['send_invoice', 'net_terms', 'cod'].includes(approval.paymentChoice ?? '')) return 'invoice_requested'
  return 'not_provided'
}

function buildOrderGroupId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let id = 'ORD-'
  for (let i = 0; i < 6; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function sanitizeQuoteItems(
  quote: Record<string, unknown>,
): Array<{ productId: string; description: string; quantity: number; unitPrice: number; amount: number }> {
  const raw = Array.isArray(quote.lineItems) ? quote.lineItems : []
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.productId === 'string' && typeof item.description === 'string')
    .map((item) => ({
      productId: item.productId as string,
      description: item.description as string,
      quantity: safeNumber(item.quantity),
      unitPrice: safeNumber(item.unitPrice),
      amount: safeNumber(item.amount),
    }))
}

export function validateQuoteApprovalInput(input: Record<string, unknown>): QuoteApprovalInput {
  const approvedByName = normalize(input.approvedByName as string | undefined)
  const deliveryContactName = normalize(input.deliveryContactName as string | undefined)
  const primaryCommunicationMethod = input.primaryCommunicationMethod as CommunicationMethod | undefined
  const acceptedTerms = input.acceptedTerms === true
  const approvedByEmail = normalize(input.approvedByEmail as string | undefined)
  const deliveryContactPhone = normalize(input.deliveryContactPhone as string | undefined)
  const deliveryContactEmail = normalize(input.deliveryContactEmail as string | undefined)
  const quoteProvidedTo = normalize(input.quoteProvidedTo as string | undefined)
  const paymentChoice = (input.paymentChoice as PaymentChoice | undefined) ?? 'undecided'
  const requestPaymentSetup = input.requestPaymentSetup === true

  if (!approvedByName) {
    throw new Error('Approved by name is required.')
  }
  if (!deliveryContactName) {
    throw new Error('Delivery point of contact is required.')
  }
  if (!acceptedTerms) {
    throw new Error('Terms and conditions must be accepted.')
  }
  if (!['email', 'phone', 'text'].includes(primaryCommunicationMethod ?? '')) {
    throw new Error('Primary communication method is required.')
  }
  if (!['card_on_file', 'net_terms', 'cod', 'send_invoice', 'undecided'].includes(paymentChoice)) {
    throw new Error('Payment preference is invalid.')
  }

  return {
    approvedByName,
    approvedByEmail,
    acceptedTerms,
    deliveryContactName,
    deliveryContactPhone,
    deliveryContactEmail,
    primaryCommunicationMethod: primaryCommunicationMethod as CommunicationMethod,
    quoteProvidedTo,
    paymentChoice,
    requestPaymentSetup,
  }
}

async function applyQuotePricing(
  customerId: string,
  quoteId: string,
  lineItems: Array<{ productId: string; unitPrice: number }>,
  setBy: string,
): Promise<void> {
  const eligible = lineItems.filter(
    (item) =>
      item.productId
      && item.productId !== 'delivery'
      && item.productId !== 'rental'
      && item.unitPrice > 0,
  )
  if (eligible.length === 0) return

  const batch = db.batch()
  for (const item of eligible) {
    const ref = db.collection('customers').doc(customerId).collection('productPricing').doc(item.productId)
    batch.set(ref, {
      productId: item.productId,
      price: item.unitPrice,
      source: 'quote',
      quoteId,
      setBy,
      setAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}

async function createOperationalOrder(args: {
  quoteId: string
  customerId: string
  quote: Record<string, unknown>
  approval: QuoteApprovalInput
}): Promise<{ orderId: string; groupId: string }> {
  const quoteItems = sanitizeQuoteItems(args.quote)
  const eligible = quoteItems.filter(
    (item) => item.productId !== 'delivery' && item.productId !== 'rental' && item.quantity > 0,
  )
  const [primary, ...rest] = eligible.length > 0 ? eligible : quoteItems

  if (!primary) {
    throw new Error('Accepted quote has no line items to convert into an order.')
  }

  const groupId = buildOrderGroupId()
  
  // Extract fees from line items
  const deliveryFeeItem = quoteItems.find(
    (item) => item.description?.toLowerCase().includes('delivery fee') ||
             (item.description?.toLowerCase().includes('delivery') && item.description?.toLowerCase().includes('fee'))
  )
  const deliveryFee = deliveryFeeItem?.amount ?? 35
  
  const hazmatFeeItem = quoteItems.find(
    (item) => item.description?.toLowerCase().includes('hazmat') ||
             item.description?.toLowerCase().includes('hazardous material')
  )
  const hazmatFee = hazmatFeeItem?.amount ?? 0
  
  const pricedItems = eligible.length > 0 ? eligible : [primary]
  const subtotal = pricedItems.reduce((sum, item) => sum + safeNumber(item.amount), 0)
  const total = subtotal + deliveryFee + hazmatFee
  const orderRef = db.collection('orders').doc()
  const addOnAddedAt = new Date().toISOString()
  const repFields = Object.fromEntries(
    Object.entries({
      salesRepId: (args.quote.salesRepId as string | undefined) ?? undefined,
      salesRepName: (args.quote.salesRepName as string | undefined) ?? undefined,
      salesRepEmail: (args.quote.salesRepEmail as string | undefined) ?? undefined,
      salesRepPhone: (args.quote.salesRepPhone as string | undefined) ?? undefined,
    }).filter(([, value]) => value !== undefined),
  )

  await orderRef.set({
    customerId: args.customerId,
    productId: primary.productId,
    quantity: primary.quantity,
    deliveryTier: 'standard',
    unitPrice: primary.unitPrice,
    upchargePercent: 0,
    subtotal,
    deliveryFee,
    hazmatFee,
    total,
    status: 'pending',
    groupId,
    orderType: 'offRoute',
    quoteId: args.quoteId,
    quoteNumber: (args.quote.quoteNumber as string | undefined) ?? null,
    ...repFields,
    approvedByName: args.approval.approvedByName,
    approvedByEmail: args.approval.approvedByEmail ?? null,
    primaryCommunicationMethod: args.approval.primaryCommunicationMethod,
    paymentPreference: args.approval.paymentChoice ?? 'undecided',
    quoteProvidedTo: args.approval.quoteProvidedTo ?? null,
    quotedLineItems: eligible,
    addOns: rest.map((item) => ({
      productId: item.productId,
      productName: item.description,
      qty: item.quantity,
      unitPrice: item.unitPrice,
      addedBy: 'quote_acceptance',
      // Firestore sentinels are not valid inside array elements.
      addedAt: addOnAddedAt,
    })),
    notes: [
      `Accepted quote ${(args.quote.quoteNumber as string | undefined) ?? args.quoteId}.`,
      `Delivery contact: ${args.approval.deliveryContactName}.`,
      `Preferred communication: ${buildCommunicationLabel(args.approval.primaryCommunicationMethod)}.`,
    ].join(' '),
    deliveryContactName: args.approval.deliveryContactName,
    deliveryContactPhone: args.approval.deliveryContactPhone ?? null,
    deliveryContactEmail: args.approval.deliveryContactEmail ?? null,
    requestedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { orderId: orderRef.id, groupId }
}

async function getInternalRecipients(createdBy?: string, salesRepId?: string): Promise<InternalRecipient[]> {
  const usersSnap = await db.collection('users').get()
  const recipients = new Map<string, InternalRecipient>()

  for (const doc of usersSnap.docs) {
    const data = doc.data()
    const role = data.role as string | undefined
    if (doc.id === createdBy || doc.id === salesRepId || role === 'admin' || role === 'dispatch') {
      recipients.set(doc.id, {
        id: doc.id,
        email: data.email as string | undefined,
        name: data.name as string | undefined,
      })
    }
  }

  if (createdBy && !recipients.has(createdBy)) {
    const authUser = await adminAuth.getUser(createdBy).catch(() => null)
    recipients.set(createdBy, {
      id: createdBy,
      email: authUser?.email,
      name: authUser?.displayName ?? undefined,
    })
  }
  if (salesRepId && !recipients.has(salesRepId)) {
    const authUser = await adminAuth.getUser(salesRepId).catch(() => null)
    recipients.set(salesRepId, {
      id: salesRepId,
      email: authUser?.email,
      name: authUser?.displayName ?? undefined,
    })
  }

  return [...recipients.values()]
}

async function notifyInternalTeam(args: {
  quoteId: string
  quote: Record<string, unknown>
  customerId: string
  approval: QuoteApprovalInput
  orderId: string
}): Promise<void> {
  const recipients = await getInternalRecipients(
    args.quote.createdBy as string | undefined,
    args.quote.salesRepId as string | undefined,
  )
  if (recipients.length === 0) return

  const customerSnap = await db.collection('customers').doc(args.customerId).get()
  const customerName = customerSnap.data()?.companyName
    || customerSnap.data()?.name
    || 'Customer'
  const quoteNum = (args.quote.quoteNumber as string | undefined) || args.quoteId
  const total = `$${safeNumber(args.quote.total).toFixed(2)}`
  const body = `${customerName} accepted Quote #${quoteNum} (${total}). Dispatch can now schedule order ${args.orderId.slice(0, 8).toUpperCase()}.`
  const company = await getCompanySettings()
  const resendConfigured = Boolean(process.env.RESEND_API_KEY)

  await Promise.all(
    recipients.map(async (recipient) => {
      await db.collection('notifications').add({
        userId: recipient.id,
        type: 'quote_accepted',
        title: `Quote #${quoteNum} accepted`,
        body,
        link: `/crm/quotes/${args.quoteId}`,
        entityId: args.quoteId,
        priority: 'high',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })

      if (!recipient.email || !resendConfigured) return

      try {
        await sendEmail({
          to: recipient.email,
          subject: `Quote accepted — ${customerName} — ${quoteNum}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
  <div style="background:#111;padding:22px 28px;border-top:4px solid #E87722">
    <h1 style="margin:0;color:#fff;font-size:22px">${company.name || 'Ohio Gas Supply'}</h1>
    <p style="margin:8px 0 0;color:#d4d4d4;font-size:13px">Quote approval received</p>
  </div>
  <div style="padding:24px 28px;border:1px solid #e5e5e5;border-top:none">
    <p style="margin:0 0 14px"><strong>${customerName}</strong> accepted Quote <strong>#${quoteNum}</strong>.</p>
    <p style="margin:0 0 8px">Approved by: ${args.approval.approvedByName}${args.approval.approvedByEmail ? ` (${args.approval.approvedByEmail})` : ''}</p>
    <p style="margin:0 0 8px">Delivery contact: ${args.approval.deliveryContactName}</p>
    <p style="margin:0 0 18px">Preferred communication: ${buildCommunicationLabel(args.approval.primaryCommunicationMethod)}</p>
    <a href="https://app.ohiogassupply.com/crm/quotes/${args.quoteId}" clicktracking="off"
       style="display:inline-block;background:#E87722;color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Open quote in CRM
    </a>
  </div>
</div>`,
        })
      } catch (err) {
        console.warn('[completeQuoteAcceptance] internal acceptance email failed —', err)
      }
    }),
  )
}

export async function completeQuoteAcceptance(
  args: CompleteQuoteAcceptanceArgs,
): Promise<{ orderId: string; groupId: string; paymentMethodStatus: PaymentStatus }> {
  const now = FieldValue.serverTimestamp()
  const customerSnap = await db.collection('customers').doc(args.customerId).get()
  const customer = customerSnap.exists ? (customerSnap.data() as Record<string, unknown>) : null
  const paymentMethodStatus = derivePaymentStatus(args.approval, customer)

  const { orderId, groupId } = await createOperationalOrder({
    quoteId: args.quoteId,
    customerId: args.customerId,
    quote: args.quote,
    approval: args.approval,
  })

  await applyQuotePricing(
    args.customerId,
    args.quoteId,
    sanitizeQuoteItems(args.quote),
    args.acceptedByUid ?? args.acceptedVia,
  )

  const approvalRecord = {
    approvedByName: args.approval.approvedByName,
    approvedByEmail: args.approval.approvedByEmail ?? null,
    acceptedTerms: true,
    acceptedTermsAt: now,
    approvedAt: now,
    approvedByUid: args.acceptedByUid ?? null,
    deliveryContactName: args.approval.deliveryContactName,
    deliveryContactPhone: args.approval.deliveryContactPhone ?? null,
    deliveryContactEmail: args.approval.deliveryContactEmail ?? null,
    primaryCommunicationMethod: args.approval.primaryCommunicationMethod,
    quoteProvidedTo: args.approval.quoteProvidedTo ?? null,
    paymentChoice: args.approval.paymentChoice ?? 'undecided',
    paymentMethodStatus,
    requestPaymentSetup: args.approval.requestPaymentSetup === true,
    source: args.acceptedVia,
  }

  await Promise.all([
    db.collection('quotes').doc(args.quoteId).update({
      status: 'accepted',
      acceptedAt: now,
      updatedAt: now,
      acceptedVia: args.acceptedVia,
      customerId: args.customerId,
      approval: approvalRecord,
      approvalEvents: FieldValue.arrayUnion({
        type: 'accepted',
        source: args.acceptedVia,
        approvedByName: args.approval.approvedByName,
        approvedByEmail: args.approval.approvedByEmail ?? null,
        primaryCommunicationMethod: args.approval.primaryCommunicationMethod,
        deliveryContactName: args.approval.deliveryContactName,
        paymentMethodStatus,
        createdAt: new Date().toISOString(),
      }),
      needsOrderSetup: false,
      convertedOrderId: orderId,
      convertedOrderIds: [orderId],
      orderGroupId: groupId,
    }),
    db.collection('customers').doc(args.customerId).set({
      status: 'active',
      billingContactName: args.approval.approvedByName,
      ...(args.approval.approvedByEmail ? { billingEmail: args.approval.approvedByEmail } : {}),
      deliveryContactName: args.approval.deliveryContactName,
      deliveryContactPhone: args.approval.deliveryContactPhone ?? null,
      deliveryContactEmail: args.approval.deliveryContactEmail ?? null,
      primaryCommunicationMethod: args.approval.primaryCommunicationMethod,
      quoteProvidedTo: args.approval.quoteProvidedTo ?? null,
      paymentMethodStatus,
      quoteApprovedAt: now,
      quoteApprovedQuoteId: args.quoteId,
      updatedAt: now,
    }, { merge: true }),
    notifyInternalTeam({
      quoteId: args.quoteId,
      quote: args.quote,
      customerId: args.customerId,
      approval: args.approval,
      orderId,
    }),
  ])

  const quotePdfUrl = args.quote.pdfUrl as string | undefined
  if (quotePdfUrl) {
    await registerGeneratedFile({
      targets: [
        { entityType: 'quote', entityId: args.quoteId },
        { entityType: 'customer', entityId: args.customerId },
      ],
      fileType: 'quote',
      url: quotePdfUrl,
      storagePath: `ogs-portal/quotes/${args.quoteId}.pdf`,
      fileName: `Quote-${(args.quote.quoteNumber as string | undefined) || args.quoteId}.pdf`,
      mimeType: 'application/pdf',
      metadata: {
        linkedEntityType: 'quote',
        linkedEntityId: args.quoteId,
        orderId,
        approved: true,
      },
    })
  }

  await generateTermsAcceptancePdf({
    customerId: args.customerId,
    quoteId: args.quoteId,
    quoteNumber: (args.quote.quoteNumber as string | undefined) ?? null,
    approvedAt: new Date(),
    approvedByName: args.approval.approvedByName,
    approvedByEmail: args.approval.approvedByEmail ?? null,
    deliveryContactName: args.approval.deliveryContactName,
    deliveryContactPhone: args.approval.deliveryContactPhone ?? null,
    deliveryContactEmail: args.approval.deliveryContactEmail ?? null,
    primaryCommunicationMethod: args.approval.primaryCommunicationMethod,
    quoteProvidedTo: args.approval.quoteProvidedTo ?? null,
    documentLabel: 'Terms & Conditions Acceptance',
    documentVersion: 'current',
  })

  return { orderId, groupId, paymentMethodStatus }
}
