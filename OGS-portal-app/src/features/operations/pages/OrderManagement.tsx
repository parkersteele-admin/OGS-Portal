/**
 * src/pages/dispatch/OrderManagement.tsx
 * BEM prefix: om-
 *
 * Internal ops order management page at /ops/orders.
 *
 * Sections:
 *   1. Filter/search bar (search, status, tier, date range, rush toggle)
 *   2. Orders table with bulk-select + bulk "Add to run" action
 *   3. Order detail slide-in panel
 *   4. Create order modal (customer typeahead, product selector, pricing preview)
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle, DollarSign, Eye, FileText, Pencil, Send, Truck, XCircle, type LucideIcon } from 'lucide-react'
import {
  onSnapshot,
  query,
  orderBy,
  getDocs,
  getDoc,
  doc,
  where,
  collectionGroup,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { ordersCol, productsCol, invoicesCol } from '../../../lib/firestore'
import {
  createOrder,
  updateOrder,
  transitionOrderStatus,
  calculateOrderPricing,
  canTransition,
  archiveOrder,
  deleteOrder,
  updateOrderBillingStatus,
} from '../../../services/orderService'
import { generateInvoiceForOrder, sendInvoiceEmailForOrder } from '../../../services/invoiceService'
import { subscribeToCustomers } from '../../../services/customerService'
import { useAuth } from '../../../hooks/useAuth'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { InvoiceDetailDrawer } from '../components/InvoiceDetailDrawer'
import { DeliveryCompleteModal } from '../../../components/delivery/DeliveryCompleteModal'
import MobileOrderCard from '../../../components/orders/MobileOrderCard'
import type { Order, OrderStatus, DeliveryTier } from '../../../types/order'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import type { Invoice } from '../../../types/billing'
import './OrderManagement.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:    'Pending',
  scheduled:  'Scheduled',
  assigned:   'Assigned',
  'in-transit': 'In Transit',
  delivered:  'Delivered',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  invoiced:   'Invoiced',
  paid:       'Paid',
  cancelled:  'Cancelled',
  archived:   'Archived',
}

const STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  pending: FileText,
  scheduled: FileText,
  assigned: FileText,
  'in-transit': Send,
  delivered: CheckCircle,
  ready_to_invoice: FileText,
  invoice_sent: Send,
  invoiced: CheckCircle,
  paid: CheckCircle,
  cancelled: CheckCircle,
  archived: CheckCircle,
}

const STATUS_ICON_COLORS: Record<OrderStatus, string> = {
  pending: '#92400e',
  scheduled: '#1e40af',
  assigned: '#3730a3',
  'in-transit': '#9d174d',
  delivered: '#065f46',
  ready_to_invoice: '#FF6A00',
  invoice_sent: '#0066FF',
  invoiced: '#00B7FF',
  paid: '#065f46',
  cancelled: '#6b7280',
  archived: '#6b7280',
}

const TIER_LABELS: Record<DeliveryTier, string> = {
  standard:  'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const RUSH_TIERS: DeliveryTier[] = ['next-day', 'same-day']

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(
  ts: { toDate?: () => Date } | null | undefined,
): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtDateTime(
  ts: { toDate?: () => Date } | null | undefined,
): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isRush(order: Order): boolean {
  return RUSH_TIERS.includes(order.deliveryTier)
}

function getOrderStatusLabel(order: Order): string {
  if (order.status === 'delivered' && order.deliveryStatus === 'signed') {
    return 'Delivered / Signed'
  }
  return STATUS_LABELS[order.status]
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ order }: { order: Order }) {
  const StatusIcon = STATUS_ICONS[order.status]
  return (
    <span className={`om-badge om-badge--${order.status}`}>
      <StatusIcon size={12} aria-hidden="true" style={{ color: STATUS_ICON_COLORS[order.status] }} />
      <span>{getOrderStatusLabel(order)}</span>
    </span>
  )
}

// ── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: DeliveryTier }) {
  return (
    <span className={`om-tier om-tier--${tier.replace('-', '')}`}>
      {TIER_LABELS[tier]}
    </span>
  )
}

// ── Order Detail Panel ─────────────────────────────────────────────────────────

interface OrderDetailPanelProps {
  order: Order
  customer?: Customer
  product?: Product
  onClose: () => void
  onCancelOrder: (id: string) => void
  onReschedule: (order: Order) => void
  canCompleteDelivery: boolean
  onCompleteDelivery: (order: Order) => void
  onBillingStatusUpdated: (orderId: string) => Promise<void>
}

interface OrderDetailSheetProps {
  order: Order
  customer?: Customer
  product?: Product
  onClose: () => void
  onCancelOrder: (id: string) => void
  onReschedule: (order: Order) => void
  canCompleteDelivery: boolean
  onCompleteDelivery: (order: Order) => void
  onBillingStatusUpdated: (orderId: string) => Promise<void>
}

function OrderDetailSheet({
  order,
  customer,
  product,
  onClose,
  onCancelOrder,
  onReschedule,
  canCompleteDelivery,
  onCompleteDelivery,
  onBillingStatusUpdated,
}: OrderDetailSheetProps) {
  const { isAdmin } = useAuth()
  const canCancel = canTransition(order.status, 'cancelled')
  const canEdit = order.status === 'pending' || order.status === 'scheduled'
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingToast, setBillingToast] = useState<string | null>(null)
  // Invoice Sent form state
  const [qbInvoiceNumber, setQbInvoiceNumber] = useState('')
  const [invoiceAmountStr, setInvoiceAmountStr] = useState('')
  // Paid form state
  const [paidAmountStr, setPaidAmountStr] = useState(() =>
    order.invoiceAmount != null ? order.invoiceAmount.toFixed(2) : '',
  )
  const [paidAtStr, setPaidAtStr] = useState(() => new Date().toISOString().slice(0, 10))

  const showBillingPanel = isAdmin && (order.status === 'ready_to_invoice' || order.status === 'invoice_sent')

  async function handleMarkInvoiceSent() {
    const invNum = qbInvoiceNumber.trim()
    const invAmt = parseFloat(invoiceAmountStr)
    if (!invNum || isNaN(invAmt) || invAmt <= 0) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'invoice_sent', {
        qbInvoiceNumber: invNum,
        invoiceAmount: invAmt,
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast('Invoice marked as sent.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update billing status.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleMarkPaid() {
    const pAmt = parseFloat(paidAmountStr)
    if (isNaN(pAmt) || pAmt <= 0) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'paid', {
        paidAmount: pAmt,
        paidAt: paidAtStr || new Date().toISOString().slice(0, 10),
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast('Order marked as paid.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update billing status.')
    } finally {
      setBillingBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Order ${order.id.slice(0, 8).toUpperCase()}`} size="lg">
      <div className="om-sheet">
        <div className="om-sheet__row">
          <span>Customer</span>
          <strong>{customer?.name ?? '—'}</strong>
        </div>
        <div className="om-sheet__row">
          <span>Address</span>
          <strong>
            {customer
              ? `${customer.address}, ${customer.city}, ${customer.state} ${customer.zip}`
              : '—'}
          </strong>
        </div>
        <div className="om-sheet__row">
          <span>Product</span>
          <strong>{product?.name ?? '—'} · {order.quantity} {product?.unit ?? 'gal'}</strong>
        </div>
        <div className="om-sheet__row">
          <span>Status</span>
          <StatusBadge order={order} />
        </div>
        <div className="om-sheet__row">
          <span>Scheduled</span>
          <strong>{fmtDate(order.scheduledAt)}</strong>
        </div>
        <div className="om-sheet__row">
          <span>Total</span>
          <strong>{fmtCurrency(order.total)}</strong>
        </div>

        {order.notes && <p className="om-sheet__notes">{order.notes}</p>}

        {showBillingPanel && (
          <section className="om-billing-panel">
            <div className="om-billing-panel__header">
              <span className="om-billing-panel__title"><DollarSign size={14} /> QuickBooks Billing</span>
            </div>
            <div className="om-billing-panel__body">
              <span className={`om-billing-badge om-billing-badge--${order.status}`}>
                {order.status === 'ready_to_invoice' ? 'Ready to Invoice' : 'Invoice Sent'}
              </span>
              <p className="om-billing-copy">
                {order.status === 'ready_to_invoice'
                  ? 'Create the invoice in QuickBooks, then mark it sent below.'
                  : 'Once payment is received, mark this order as paid.'}
              </p>
              {order.status === 'ready_to_invoice' ? (
                <QBInvoiceSentForm
                  qbInvoiceNumber={qbInvoiceNumber}
                  invoiceAmountStr={invoiceAmountStr}
                  busy={billingBusy}
                  onChangeInvoiceNumber={setQbInvoiceNumber}
                  onChangeInvoiceAmount={setInvoiceAmountStr}
                  onSubmit={handleMarkInvoiceSent}
                />
              ) : (
                <QBPaidForm
                  paidAmountStr={paidAmountStr}
                  paidAtStr={paidAtStr}
                  busy={billingBusy}
                  onChangePaidAmount={setPaidAmountStr}
                  onChangePaidAt={setPaidAtStr}
                  onSubmit={handleMarkPaid}
                />
              )}
              {billingToast && <p className="om-billing-toast">{billingToast}</p>}
            </div>
          </section>
        )}

        <div className="om-sheet__actions">
          {canCompleteDelivery && (
            <Button variant="primary" onClick={() => onCompleteDelivery(order)}>
              <Truck size={14} /> Complete Delivery
            </Button>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => onReschedule(order)}
            >
              Reschedule
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              onClick={() => onCancelOrder(order.id)}
            >
              Cancel Order
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function OrderDetailPanel({
  order,
  customer,
  product,
  onClose,
  onCancelOrder,
  onReschedule,
  canCompleteDelivery,
  onCompleteDelivery,
  onBillingStatusUpdated,
}: OrderDetailPanelProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin } = useAuth()
  const opsBase  = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'
  const isAdminView = location.pathname.startsWith('/admin')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [generatingInvoice, setGeneratingInvoice] = useState(false)
  const [sendingInvoiceEmail, setSendingInvoiceEmail] = useState(false)
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingToast, setBillingToast] = useState<string | null>(null)
  // Invoice Sent form state
  const [qbInvoiceNumber, setQbInvoiceNumber] = useState('')
  const [invoiceAmountStr, setInvoiceAmountStr] = useState('')
  // Paid form state
  const [paidAmountStr, setPaidAmountStr] = useState(() =>
    order.invoiceAmount != null ? order.invoiceAmount.toFixed(2) : '',
  )
  const [paidAtStr, setPaidAtStr] = useState(() => new Date().toISOString().slice(0, 10))
  const [runStopInfo, setRunStopInfo] = useState<{
    runNumber: string
    stopOrder: number
  } | null>(null)

  useEffect(() => {
    // Load linked invoice
    if (!order.id) return
    getDocs(
      query(invoicesCol, where('orderId', '==', order.id)),
    ).then((snap) => {
      if (!snap.empty)
        setInvoice({ ...snap.docs[0].data(), id: snap.docs[0].id } as Invoice)
    })
  }, [order.id])

  useEffect(() => {
    // Find the run stop this order is assigned to
    const findRunStop = async () => {
      const stopsQuery = query(
        collectionGroup(db, 'stops'),
        where('orderId', '==', order.id),
      )
      const stopsSnap = await getDocs(stopsQuery)
      if (!stopsSnap.empty) {
        const stopDoc = stopsSnap.docs[0]
        const runId = stopDoc.ref.parent.parent?.id
        if (runId) {
          const runSnap = await getDoc(doc(db, 'runs', runId))
          if (runSnap.exists()) {
            const runData = runSnap.data() as { runNumber?: string }
            setRunStopInfo({
              runNumber: runData.runNumber ?? runId,
              stopOrder: (stopDoc.data() as { order?: number }).order ?? 0,
            })
          }
        }
      }
    }
    findRunStop().catch(() => {})
  }, [order.id])

  // Build status timeline from available timestamps
  const timeline: Array<{ label: string; time: string }> = []
  if (order.requestedAt) {
    timeline.push({ label: 'Order placed', time: fmtDate(order.requestedAt) })
  }
  if (order.scheduledAt) {
    timeline.push({ label: 'Scheduled', time: fmtDate(order.scheduledAt) })
  }
  if (
    order.status === 'assigned' ||
    order.status === 'in-transit' ||
    order.status === 'delivered'
  ) {
    timeline.push({ label: STATUS_LABELS[order.status], time: 'Today' })
  }

  const canCancel = canTransition(order.status, 'cancelled')
  const canEdit =
    order.status === 'pending' || order.status === 'scheduled'
  const showBillingPanel = isAdmin && (order.status === 'ready_to_invoice' || order.status === 'invoice_sent')

  async function handleGenerateInvoice() {
    setGeneratingInvoice(true)
    try {
      const result = await generateInvoiceForOrder(order.id)
      const invoiceSnap = await getDoc(doc(db, 'invoices', result.invoiceId))
      if (invoiceSnap.exists()) {
        setInvoice({ ...invoiceSnap.data(), id: invoiceSnap.id } as Invoice)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate invoice.'
      alert(message)
    } finally {
      setGeneratingInvoice(false)
    }
  }

  async function handleSendInvoiceEmail() {
    setSendingInvoiceEmail(true)
    try {
      const result = await sendInvoiceEmailForOrder(order.id)
      const invoiceSnap = await getDoc(doc(db, 'invoices', result.invoiceId))
      if (invoiceSnap.exists()) {
        setInvoice({ ...invoiceSnap.data(), id: invoiceSnap.id } as Invoice)
      }
      alert(`Invoice email sent to ${result.emailedTo}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invoice email.'
      alert(message)
    } finally {
      setSendingInvoiceEmail(false)
    }
  }

  async function handleMarkInvoiceSent() {
    const invNum = qbInvoiceNumber.trim()
    const invAmt = parseFloat(invoiceAmountStr)
    if (!invNum || isNaN(invAmt) || invAmt <= 0) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'invoice_sent', {
        qbInvoiceNumber: invNum,
        invoiceAmount: invAmt,
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast('Invoice marked as sent.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update billing status.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleMarkPaid() {
    const pAmt = parseFloat(paidAmountStr)
    if (isNaN(pAmt) || pAmt <= 0) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'paid', {
        paidAmount: pAmt,
        paidAt: paidAtStr || new Date().toISOString().slice(0, 10),
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast('Order marked as paid.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update billing status.')
    } finally {
      setBillingBusy(false)
    }
  }

  return (
    <div className="om-panel-overlay" onClick={onClose}>
      <div
        className="om-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Order ${order.id.slice(0, 8).toUpperCase()} details`}
      >
        {/* Header */}
        <div className="om-panel__header">
          <div>
            <div className="om-panel__order-num">
              {order.id.slice(0, 8).toUpperCase()}
            </div>
            {isRush(order) && (
              <span className="om-rush-flag">Rush</span>
            )}
          </div>
          <button
            className="om-panel__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="om-panel__body">
          {/* Customer + product */}
          <section className="om-panel__section">
            <div className="om-panel__row">
              <span className="om-panel__label">Customer</span>
              <span className="om-panel__val">{customer?.name ?? '—'}</span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Address</span>
              <span className="om-panel__val">
                {customer
                  ? `${customer.address}, ${customer.city}, ${customer.state} ${customer.zip}`
                  : '—'}
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Product</span>
              <span className="om-panel__val">
                {product?.name ?? '—'} — {order.quantity} {product?.unit ?? 'gal'}
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Tier</span>
              <span className="om-panel__val">
                <TierBadge tier={order.deliveryTier} />
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Status</span>
              <span className="om-panel__val">
                <StatusBadge order={order} />
              </span>
            </div>
          </section>

          {/* Pricing */}
          <section className="om-panel__section om-panel__section--pricing">
            <div className="om-panel__row">
              <span className="om-panel__label">Unit price</span>
              <span className="om-panel__val">{fmtCurrency(order.unitPrice)}</span>
            </div>
            {order.upchargePercent > 0 && (
              <div className="om-panel__row">
                <span className="om-panel__label">Upcharge</span>
                <span className="om-panel__val">
                  {(order.upchargePercent * 100).toFixed(0)}%
                </span>
              </div>
            )}
            <div className="om-panel__row">
              <span className="om-panel__label">Subtotal</span>
              <span className="om-panel__val">{fmtCurrency(order.subtotal)}</span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Delivery fee</span>
              <span className="om-panel__val">{fmtCurrency(order.deliveryFee)}</span>
            </div>
            <div className="om-panel__row om-panel__row--total">
              <span className="om-panel__label">Total</span>
              <span className="om-panel__val om-panel__val--total">
                {fmtCurrency(order.total)}
              </span>
            </div>
          </section>

          {/* Run assignment */}
          {runStopInfo && (
            <section className="om-panel__section">
              <div className="om-panel__row">
                <span className="om-panel__label">Run</span>
                <span className="om-panel__val">
                  <button
                    className="om-panel__link"
                    onClick={() =>
                      navigate(`${opsBase}/dispatch`, {
                        state: { runId: runStopInfo.runNumber },
                      })
                    }
                  >
                    {runStopInfo.runNumber}
                  </button>{' '}
                  — Stop #{runStopInfo.stopOrder}
                </span>
              </div>
            </section>
          )}

          {/* Delivery evidence */}
          {order.status === 'delivered' && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Delivery Evidence</div>
              <div className="om-panel__row">
                <span className="om-panel__label">Delivery status</span>
                <span className="om-panel__val">
                  {getOrderStatusLabel(order)}
                </span>
              </div>
              {order.signedByName && (
                <div className="om-panel__row">
                  <span className="om-panel__label">Signed by</span>
                  <span className="om-panel__val">{order.signedByName}</span>
                </div>
              )}
              {order.signedAt && (
                <div className="om-panel__row">
                  <span className="om-panel__label">Signed at</span>
                  <span className="om-panel__val">{fmtDateTime(order.signedAt)}</span>
                </div>
              )}
              {order.signatureUrl && (
                <div className="om-panel__row" style={{ alignItems: 'flex-start' }}>
                  <span className="om-panel__label">Signature</span>
                  <span className="om-panel__val">
                    <a href={order.signatureUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={order.signatureUrl}
                        alt="Delivery signature"
                        className="sp-signature"
                        style={{ maxWidth: 220, background: '#fff' }}
                      />
                    </a>
                  </span>
                </div>
              )}
              {(order.billOfLadingUrl || order.invoicePdfUrl) && (
                <>
                  {order.billOfLadingUrl && (
                    <div className="om-panel__row">
                      <span className="om-panel__label">Bill of Lading</span>
                      <span className="om-panel__val">
                        <a href={order.billOfLadingUrl} target="_blank" rel="noopener noreferrer">
                          Open PDF
                        </a>
                      </span>
                    </div>
                  )}
                  {order.invoicePdfUrl && (
                    <div className="om-panel__row">
                      <span className="om-panel__label">Invoice PDF</span>
                      <span className="om-panel__val">
                        <a href={order.invoicePdfUrl} target="_blank" rel="noopener noreferrer">
                          Open PDF
                        </a>
                      </span>
                    </div>
                  )}
                </>
              )}
              {!order.signatureUrl && !order.billOfLadingUrl && !order.invoicePdfUrl && (
                <p className="om-panel__hint">
                  Signed-delivery assets have not been generated for this order yet.
                </p>
              )}
              {order.deliveryNotes && (
                <div className="om-panel__row" style={{ alignItems: 'flex-start' }}>
                  <span className="om-panel__label">Delivery notes</span>
                  <span className="om-panel__val">{order.deliveryNotes}</span>
                </div>
              )}
            </section>
          )}

          {/* Linked invoice */}
          {invoice && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Invoice</div>
              <div className="om-panel__row">
                <span className="om-panel__label">Invoice #</span>
                <button
                  className="om-invoice-link"
                  onClick={() => setShowInvoiceDetail(true)}
                  title="Click to view full invoice details"
                >
                  {invoice.invoiceNumber}
                </button>
              </div>
              <div className="om-panel__row">
                <span className="om-panel__label">Status</span>
                <span className="om-panel__val">{invoice.status}</span>
              </div>
              <div className="om-panel__row">
                <span className="om-panel__label">Total</span>
                <span className="om-panel__val">{fmtCurrency(invoice.total)}</span>
              </div>
              <div className="om-invoice-actions">
                {invoice.pdfUrl && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.open(invoice.pdfUrl, '_blank')}
                  >
                    📄 View PDF
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowInvoiceDetail(true)}
                >
                  More Details
                </Button>
                {isAdminView && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSendInvoiceEmail}
                    disabled={sendingInvoiceEmail}
                  >
                    {sendingInvoiceEmail ? 'Sending...' : 'Send Invoice Email'}
                  </Button>
                )}
                {isAdminView && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleGenerateInvoice}
                    disabled={generatingInvoice || sendingInvoiceEmail}
                  >
                    {generatingInvoice ? 'Regenerating...' : 'Regenerate Invoice'}
                  </Button>
                )}
              </div>
            </section>
          )}

          {showBillingPanel && (
            <section className="om-panel__section om-billing-panel">
              <div className="om-billing-panel__header">
                <span className="om-billing-panel__title"><DollarSign size={14} /> QuickBooks Billing</span>
              </div>
              <div className="om-billing-panel__body">
                <span className={`om-billing-badge om-billing-badge--${order.status}`}>
                  {order.status === 'ready_to_invoice' ? 'Ready to Invoice' : 'Invoice Sent'}
                </span>
                <p className="om-billing-copy">
                  {order.status === 'ready_to_invoice'
                    ? 'Create the invoice in QuickBooks, then mark it sent below.'
                    : 'Once payment is received, mark this order as paid.'}
                </p>
                {order.status === 'ready_to_invoice' ? (
                  <QBInvoiceSentForm
                    qbInvoiceNumber={qbInvoiceNumber}
                    invoiceAmountStr={invoiceAmountStr}
                    busy={billingBusy}
                    onChangeInvoiceNumber={setQbInvoiceNumber}
                    onChangeInvoiceAmount={setInvoiceAmountStr}
                    onSubmit={handleMarkInvoiceSent}
                  />
                ) : (
                  <QBPaidForm
                    paidAmountStr={paidAmountStr}
                    paidAtStr={paidAtStr}
                    busy={billingBusy}
                    onChangePaidAmount={setPaidAmountStr}
                    onChangePaidAt={setPaidAtStr}
                    onSubmit={handleMarkPaid}
                  />
                )}
                {billingToast && <p className="om-billing-toast">{billingToast}</p>}
              </div>
            </section>
          )}

          {order.qbInvoiceNumber && (
            <BillingSummary order={order} />
          )}

          {/* Timeline */}
          <section className="om-panel__section">
            <div className="om-panel__section-title">Timeline</div>
            {timeline.map((t, i) => (
              <div key={i} className="om-timeline-row">
                <div className="om-timeline-dot" />
                <div className="om-timeline-content">
                  <div className="om-timeline-label">{t.label}</div>
                  <div className="om-timeline-time">{t.time}</div>
                </div>
              </div>
            ))}
          </section>

          {/* Notes */}
          {order.notes && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Notes</div>
              <p className="om-panel__note">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Actions */}
        <div className="om-panel__footer">
          {canCompleteDelivery && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onCompleteDelivery(order)}
            >
              <Truck size={14} /> Complete Delivery
            </Button>
          )}
          {isAdminView && !invoice && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleGenerateInvoice}
              disabled={generatingInvoice}
            >
              {generatingInvoice ? 'Generating...' : 'Generate Invoice'}
            </Button>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReschedule(order)}
            >
              Reschedule
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => onCancelOrder(order.id)}
            >
              Cancel Order
            </Button>
          )}
        </div>
      </div>

      {/* Invoice Detail Drawer */}
      {invoice && (
        <InvoiceDetailDrawer
          invoice={invoice}
          isOpen={showInvoiceDetail}
          onClose={() => setShowInvoiceDetail(false)}
          onInvoiceUpdated={setInvoice}
        />
      )}
    </div>
  )
}

// ── QB Billing Inline Forms ────────────────────────────────────────────────────

interface QBInvoiceSentFormProps {
  qbInvoiceNumber: string
  invoiceAmountStr: string
  busy: boolean
  onChangeInvoiceNumber: (v: string) => void
  onChangeInvoiceAmount: (v: string) => void
  onSubmit: () => void
}

function QBInvoiceSentForm({
  qbInvoiceNumber,
  invoiceAmountStr,
  busy,
  onChangeInvoiceNumber,
  onChangeInvoiceAmount,
  onSubmit,
}: QBInvoiceSentFormProps) {
  const invAmt = parseFloat(invoiceAmountStr)
  const canSubmit = qbInvoiceNumber.trim() !== '' && !isNaN(invAmt) && invAmt > 0 && !busy
  return (
    <div className="om-qb-form">
      <div className="om-qb-form__field">
        <label className="om-qb-form__label">QB Invoice Number</label>
        <input
          className="om-qb-form__input"
          type="text"
          placeholder="#1042"
          value={qbInvoiceNumber}
          onChange={(e) => onChangeInvoiceNumber(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="om-qb-form__field">
        <label className="om-qb-form__label">Invoice Amount</label>
        <input
          className="om-qb-form__input"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          value={invoiceAmountStr}
          onChange={(e) => onChangeInvoiceAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        className="om-billing-btn"
        onClick={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? 'Saving…' : 'Mark Invoice Sent'}
      </button>
    </div>
  )
}

interface QBPaidFormProps {
  paidAmountStr: string
  paidAtStr: string
  busy: boolean
  onChangePaidAmount: (v: string) => void
  onChangePaidAt: (v: string) => void
  onSubmit: () => void
}

function QBPaidForm({
  paidAmountStr,
  paidAtStr,
  busy,
  onChangePaidAmount,
  onChangePaidAt,
  onSubmit,
}: QBPaidFormProps) {
  const pAmt = parseFloat(paidAmountStr)
  const canSubmit = !isNaN(pAmt) && pAmt > 0 && !busy
  return (
    <div className="om-qb-form">
      <div className="om-qb-form__field">
        <label className="om-qb-form__label">Amount Received</label>
        <input
          className="om-qb-form__input"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          value={paidAmountStr}
          onChange={(e) => onChangePaidAmount(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="om-qb-form__field">
        <label className="om-qb-form__label">Payment Date</label>
        <input
          className="om-qb-form__input"
          type="date"
          value={paidAtStr}
          onChange={(e) => onChangePaidAt(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        className="om-billing-btn om-billing-btn--paid"
        onClick={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? 'Saving…' : 'Mark as Paid'}
      </button>
    </div>
  )
}

// ── Billing Summary (read-only QB data) ────────────────────────────────────────

function BillingSummary({ order }: { order: Order }) {
  const fmtDateShort = (ts: import('firebase/firestore').Timestamp | string | undefined): string => {
    if (!ts) return '—'
    const d = typeof ts === 'string'
      ? new Date(ts)
      : (ts as import('firebase/firestore').Timestamp).toDate()
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const cols: { label: string; value: string }[] = []
  if (order.qbInvoiceNumber) cols.push({ label: 'QB Invoice #', value: order.qbInvoiceNumber })
  if (order.invoiceAmount != null) cols.push({ label: 'Amount Invoiced', value: `$${order.invoiceAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })
  if (order.paidAmount != null) cols.push({ label: 'Amount Received', value: `$${order.paidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })
  if (order.paidAt) cols.push({ label: 'Payment Date', value: fmtDateShort(order.paidAt) })

  if (cols.length === 0) return null

  return (
    <section className="om-billing-summary">
      <div className="om-billing-summary__cols">
        {cols.map((c) => (
          <div key={c.label} className="om-billing-summary__col">
            <div className="om-billing-summary__label">{c.label}</div>
            <div className="om-billing-summary__value">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Create Order Modal ─────────────────────────────────────────────────────────

interface CreateOrderModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateOrderModal({ onClose, onCreated }: CreateOrderModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(100)
  const [tier, setTier] = useState<DeliveryTier>('standard')
  const [notes, setNotes] = useState('')
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const customerInputRef = useRef<HTMLInputElement>(null)

  // Load products on mount
  useEffect(() => {
    getDocs(query(productsCol, where('active', '==', true)))
      .then((snap) =>
        setProducts(
          snap.docs
            .map((d) => ({ ...d.data(), id: d.id }) as Product)
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
  }, [])

  // Load customers (subscribe for typeahead)
  useEffect(() => {
    const unsub = subscribeToCustomers(
      { status: 'active' },
      (data) => setCustomers(data),
    )
    return unsub
  }, [])

  // Typeahead filter
  const filteredCustomers = useMemo(() => {
    const lc = customerSearch.toLowerCase()
    if (!lc) return customers.slice(0, 8)
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lc) ||
          c.city.toLowerCase().includes(lc),
      )
      .slice(0, 8)
  }, [customers, customerSearch])

  // Pricing preview
  const pricing = useMemo(() => {
    if (!selectedProduct) return null
    return calculateOrderPricing(
      quantity,
      selectedProduct.pricePerUnit,
      tier,
    )
  }, [selectedProduct, quantity, tier])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCustomer) return setError('Please select a customer.')
    if (!selectedProduct) return setError('Please select a product.')
    if (quantity <= 0) return setError('Quantity must be greater than 0.')

    setSubmitting(true)
    setError('')
    try {
      await createOrder(
        {
          customerId: selectedCustomer.id,
          productId: selectedProduct.id,
          quantity,
          deliveryTier: tier,
          notes: notes || undefined,
        },
        selectedProduct.pricePerUnit,
      )
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order.')
      setSubmitting(false)
    }
  }

  return (
    <div className="om-overlay" onClick={onClose}>
      <div
        className="om-modal om-modal--lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Create order"
      >
        <div className="om-modal__header">
          <h2 className="om-modal__title">Create Order</h2>
          <button
            className="om-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="om-modal__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="om-form-error">{error}</div>}

          {/* Customer typeahead */}
          <div className="om-field">
            <label className="om-field__label">Customer *</label>
            <div className="om-typeahead">
              <input
                ref={customerInputRef}
                className="om-typeahead__input"
                placeholder="Search by name or city…"
                value={selectedCustomer ? selectedCustomer.name : customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setSelectedCustomer(null)
                  setShowCustomerDropdown(true)
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() =>
                  setTimeout(() => setShowCustomerDropdown(false), 150)
                }
                autoComplete="off"
              />
              {selectedCustomer && (
                <button
                  type="button"
                  className="om-typeahead__clear"
                  onClick={() => {
                    setSelectedCustomer(null)
                    setCustomerSearch('')
                    customerInputRef.current?.focus()
                  }}
                >
                  ✕
                </button>
              )}
              {showCustomerDropdown && !selectedCustomer && (
                <div className="om-typeahead__dropdown">
                  {filteredCustomers.length === 0 && (
                    <div className="om-typeahead__empty">No customers found</div>
                  )}
                  {filteredCustomers.map((c) => (
                    <div
                      key={c.id}
                      className="om-typeahead__item"
                      onMouseDown={() => {
                        setSelectedCustomer(c)
                        setCustomerSearch('')
                        setShowCustomerDropdown(false)
                      }}
                    >
                      <div className="om-typeahead__item-name">{c.name}</div>
                      <div className="om-typeahead__item-meta">
                        {c.city}, {c.state}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="om-field__hint">
                {selectedCustomer.address}, {selectedCustomer.city},{' '}
                {selectedCustomer.state} {selectedCustomer.zip}
              </div>
            )}
          </div>

          {/* Product */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-product">
              Product *
            </label>
            <select
              id="create-product"
              className="om-select"
              value={selectedProduct?.id ?? ''}
              onChange={(e) => {
                const p = products.find((p) => p.id === e.target.value) ?? null
                setSelectedProduct(p)
              }}
              required
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {fmtCurrency(p.pricePerUnit)}/{p.unit}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="om-field">
            <Input
              label={`Quantity${selectedProduct ? ` (${selectedProduct.unit})` : ''} *`}
              id="create-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </div>

          {/* Delivery tier */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-tier">
              Delivery Tier *
            </label>
            <select
              id="create-tier"
              className="om-select"
              value={tier}
              onChange={(e) => setTier(e.target.value as DeliveryTier)}
            >
              <option value="standard">Standard</option>
              <option value="next-day">Next Day (+10%)</option>
              <option value="same-day">Same Day (+25%)</option>
            </select>
          </div>

          {/* Scheduled date */}
          <div className="om-field">
            <Input
              label="Scheduled Date"
              id="create-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* Notes */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-notes">
              Notes
            </label>
            <textarea
              id="create-notes"
              className="om-textarea"
              rows={3}
              placeholder="Special delivery instructions…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Pricing preview */}
          {pricing && (
            <div className="om-pricing-preview">
              <div className="om-pricing-preview__title">Price Preview</div>
              <div className="om-pricing-preview__row">
                <span>Subtotal</span>
                <span>{fmtCurrency(pricing.subtotal)}</span>
              </div>
              {pricing.upchargePercent > 0 && (
                <div className="om-pricing-preview__row om-pricing-preview__row--upcharge">
                  <span>
                    {TIER_LABELS[tier]} upcharge ({(pricing.upchargePercent * 100).toFixed(0)}%)
                  </span>
                  <span>
                    {fmtCurrency(
                      pricing.subtotal * pricing.upchargePercent /
                        (1 + pricing.upchargePercent),
                    )}
                  </span>
                </div>
              )}
              <div className="om-pricing-preview__row">
                <span>Delivery fee</span>
                <span>{fmtCurrency(pricing.deliveryFee)}</span>
              </div>
              <div className="om-pricing-preview__row om-pricing-preview__row--total">
                <span>Total</span>
                <span>{fmtCurrency(pricing.total)}</span>
              </div>
            </div>
          )}

          <div className="om-modal__footer">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Order'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Reschedule Modal ───────────────────────────────────────────────────────────

interface RescheduleModalProps {
  order: Order
  onClose: () => void
  onSaved: () => void
}

function RescheduleModal({ order, onClose, onSaved }: RescheduleModalProps) {
  const [date, setDate] = useState(
    order.scheduledAt?.toDate?.()?.toISOString().slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState(order.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setBusy(true)
    setError('')
    try {
      await updateOrder(order.id, {
        scheduledAt: date
          ? (new Date(date) as unknown as Order['scheduledAt'])
          : undefined,
        notes: notes || undefined,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update order.')
      setBusy(false)
    }
  }

  return (
    <div className="om-overlay" onClick={onClose}>
      <div
        className="om-modal om-modal--sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Reschedule order"
      >
        <div className="om-modal__header">
          <h2 className="om-modal__title">Reschedule Order</h2>
          <button className="om-modal__close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="om-modal__body">
          {error && <div className="om-form-error">{error}</div>}
          <div className="om-field">
            <Input
              label="New scheduled date"
              id="reschedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div className="om-field">
            <label className="om-field__label" htmlFor="reschedule-notes">
              Notes
            </label>
            <textarea
              id="reschedule-notes"
              className="om-textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="om-modal__footer">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  const opsBase  = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'
  const { isAdmin, isDispatch } = useAuth()

  // ── Data ──────────────────────────────────────────────────────────────────────
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, Customer>>({})
  const [productMap, setProductMap] = useState<Record<string, Product>>({})
  const [ordersLoading, setOrdersLoading] = useState(true)

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [tierFilter, setTierFilter] = useState<DeliveryTier | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rushOnly, setRushOnly] = useState(false)

  // ── Table state ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Panels / modals ───────────────────────────────────────────────────────────
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [rescheduleOrder, setRescheduleOrder] = useState<Order | null>(null)
  const [deliveryModalOrder, setDeliveryModalOrder] = useState<Order | null>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    setIsMobile(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (allOrders.length === 0) return
    const params = new URLSearchParams(location.search)
    const orderId = params.get('orderId')
    if (!orderId) return
    const order = allOrders.find((item) => item.id === orderId)
    if (order) setDetailOrder(order)
  }, [allOrders, location.search])

  // ── Subscribe to all orders ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      query(ordersCol, orderBy('requestedAt', 'desc')),
      (snap) => {
        setAllOrders(
          snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order),
        )
        setOrdersLoading(false)
      },
    )
    return unsub
  }, [])

  // ── Batch-load customer + product docs as new IDs appear ──────────────────────
  const loadedCustomerIds = useRef<Set<string>>(new Set())
  const loadedProductIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const customerIds = [
      ...new Set(allOrders.map((o) => o.customerId)),
    ].filter((id) => !loadedCustomerIds.current.has(id))

    const productIds = [
      ...new Set(allOrders.map((o) => o.productId)),
    ].filter((id) => !loadedProductIds.current.has(id))

    customerIds.forEach((id) => loadedCustomerIds.current.add(id))
    productIds.forEach((id) => loadedProductIds.current.add(id))

    if (customerIds.length) {
      Promise.all(
        customerIds.map((id) =>
          getDoc(doc(db, 'customers', id)).then((s) =>
            s.exists()
              ? ({ id: s.id, ...s.data() } as Customer)
              : null,
          ),
        ),
      ).then((docs) => {
        const map: Record<string, Customer> = {}
        docs.forEach((c) => {
          if (c) map[c.id] = c
        })
        setCustomerMap((prev) => ({ ...prev, ...map }))
      })
    }

    if (productIds.length) {
      Promise.all(
        productIds.map((id) =>
          getDoc(doc(db, 'products', id)).then((s) =>
            s.exists()
              ? ({ id: s.id, ...s.data() } as Product)
              : null,
          ),
        ),
      ).then((docs) => {
        const map: Record<string, Product> = {}
        docs.forEach((p) => {
          if (p) map[p.id] = p
        })
        setProductMap((prev) => ({ ...prev, ...map }))
      })
    }
  }, [allOrders])

  // ── Filtered + sorted orders ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = allOrders

    // Rush-first sort: put rush tiers at the top
    result = [...result].sort((a, b) => {
      const aRush = isRush(a) ? 0 : 1
      const bRush = isRush(b) ? 0 : 1
      if (aRush !== bRush) return aRush - bRush
      // Secondary: requestedAt desc
      return (b.requestedAt?.toDate?.()?.getTime() ?? 0) -
        (a.requestedAt?.toDate?.()?.getTime() ?? 0)
    })

    if (rushOnly) result = result.filter(isRush)

    if (statusFilter !== 'all')
      result = result.filter((o) => o.status === statusFilter)

    if (tierFilter !== 'all')
      result = result.filter((o) => o.deliveryTier === tierFilter)

    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter(
        (o) => (o.scheduledAt?.toDate?.()?.getTime() ?? 0) >= from.getTime(),
      )
    }

    if (dateTo) {
      const to = new Date(dateTo)
      to.setDate(to.getDate() + 1)
      result = result.filter(
        (o) => (o.scheduledAt?.toDate?.()?.getTime() ?? 0) < to.getTime(),
      )
    }

    // Hide archived orders unless explicitly filtered to archived
    if (statusFilter === 'all') result = result.filter((o) => o.status !== 'archived')

    if (search.trim()) {
      const lc = search.toLowerCase()
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(lc) ||
          customerMap[o.customerId]?.name.toLowerCase().includes(lc),
      )
    }

    return result
  }, [allOrders, search, statusFilter, tierFilter, dateFrom, dateTo, rushOnly, customerMap])

  const canManageDelivery = isAdmin || isDispatch

  function canCompleteDelivery(order: Order): boolean {
    return (
      canManageDelivery
      && (order.status === 'in-transit' || order.status === 'assigned')
      && !!order.runId
      && !!order.runStopId
    )
  }

  async function refreshOrderDetail(orderId: string) {
    const snap = await getDoc(doc(db, 'orders', orderId))
    if (!snap.exists()) return
    const fresh = { id: snap.id, ...snap.data() } as Order
    setDetailOrder(fresh)
  }

  // ── Bulk select ───────────────────────────────────────────────────────────────
  const selectableFiltered = filtered.filter((o) => o.status !== 'archived')
  const allSelectableSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((o) => selected.has(o.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelectableSelected) {
        selectableFiltered.forEach((o) => next.delete(o.id))
      } else {
        selectableFiltered.forEach((o) => next.add(o.id))
      }
      return next
    })
  }

  function toggleRow(id: string, status: OrderStatus) {
    if (status === 'archived') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  // ── Cancel order ──────────────────────────────────────────────────────────────
  async function handleCancel(id: string) {
    if (!confirm('Cancel this order? This cannot be undone.')) return
    try {
      await transitionOrderStatus(id, 'cancelled')
      if (detailOrder?.id === id) setDetailOrder(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel order.')
    }
  }

  async function handleMobileBillingStatus(orderId: string, status: 'invoice_sent' | 'paid') {
    const prompt = status === 'invoice_sent' ? 'Mark this order as Invoice Sent?' : 'Mark this order as Paid?'
    if (!confirm(prompt)) return
    try {
      await updateOrderBillingStatus(orderId, status)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update billing status.')
    }
  }

  // ── Build run from selection ───────────────────────────────────────────────────
  function handleBuildRun() {
    navigate(`${opsBase}/runs/new`, {
      state: { selectedOrderIds: [...selected] },
    })
  }

  // ── Bulk archive ──────────────────────────────────────────────────────────────
  async function handleBulkArchive() {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`Archive ${count} order${count !== 1 ? 's' : ''}? They will be hidden from the default view.`)) return
    try {
      await Promise.all([...selected].map((id) => archiveOrder(id)))
      setSelected(new Set())
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive orders.')
    }
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────────
  async function handleBulkDelete() {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`Permanently delete ${count} order${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    try {
      await Promise.all([...selected].map((id) => deleteOrder(id)))
      setSelected(new Set())
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete orders.')
    }
  }

  const selectedCount = selected.size

  return (
    <div className="om-page">
      <div className="om-mobile-sticky-shell">
        {/* ── Page header ── */}
        <div className="om-page-header">
          <div className="om-page-header__left">
            <h1 className="om-page-header__title">Orders</h1>
            {!ordersLoading && (
              <span className="om-page-header__count">
                {filtered.length} of {allOrders.length}
              </span>
            )}
          </div>
          <div className="om-page-header__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={selectedCount === 0}
              onClick={handleBulkArchive}
            >
              Archive{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={selectedCount === 0}
              onClick={handleBulkDelete}
            >
              Delete{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
            {selectedCount > 0 && (
              <Button variant="secondary" size="sm" onClick={handleBuildRun}>
                Add {selectedCount} to Run →
              </Button>
            )}
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + Create Order
            </Button>
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="om-filters">
          {/* Search */}
          <div className="om-filters__search">
            <svg
              className="om-filters__search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path
                d="M21 21l-4.35-4.35"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              className="om-filters__search-input"
              placeholder="Search customer or order #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="om-filters__search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status */}
          {isMobile ? (
            <div className="om-filters__chips" aria-label="Filter by status">
              <button
                type="button"
                className={`om-filters__chip${statusFilter === 'all' ? ' om-filters__chip--active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All
              </button>
              {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`om-filters__chip${statusFilter === s ? ' om-filters__chip--active' : ''}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          ) : (
            <select
              className="om-filters__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}

          {!isMobile && (
            <>
              {/* Tier */}
              <select
                className="om-filters__select"
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as DeliveryTier | 'all')}
                aria-label="Filter by delivery tier"
              >
                <option value="all">All Tiers</option>
                {(Object.keys(TIER_LABELS) as DeliveryTier[]).map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </select>

              {/* Date range */}
              <div className="om-filters__dates">
                <input
                  type="date"
                  className="om-filters__date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="From date"
                />
                <span className="om-filters__date-sep">–</span>
                <input
                  type="date"
                  className="om-filters__date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="To date"
                />
              </div>

              {/* Rush toggle */}
              <label className="om-filters__toggle">
                <input
                  type="checkbox"
                  className="om-filters__toggle-input"
                  checked={rushOnly}
                  onChange={(e) => setRushOnly(e.target.checked)}
                />
                <span className="om-filters__toggle-track" />
                <span className="om-filters__toggle-label">Rush only</span>
              </label>
            </>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="om-table-wrap">
        {ordersLoading ? (
          <div className="om-empty">Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div className="om-empty">No orders match the current filters.</div>
        ) : (
          <>
            <table className="om-table">
              <thead>
                <tr>
                  <th className="om-table__th om-table__th--check">
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      onChange={toggleAll}
                      title="Select all"
                      aria-label="Select all orders"
                      disabled={selectableFiltered.length === 0}
                    />
                  </th>
                  <th className="om-table__th">Order #</th>
                  <th className="om-table__th">Customer</th>
                  <th className="om-table__th">Product / Qty</th>
                  <th className="om-table__th">Tier</th>
                  <th className="om-table__th">Scheduled</th>
                  <th className="om-table__th">Status</th>
                  <th className="om-table__th om-table__th--right">Total</th>
                  <th className="om-table__th om-table__th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const rush = isRush(order)
                  const isCancelled = order.status === 'cancelled'
                  const canSel = order.status !== 'archived'
                  const cust = customerMap[order.customerId]
                  const prod = productMap[order.productId]
                  const isSelected = selected.has(order.id)

                  return (
                    <tr
                      key={order.id}
                      className={[
                        'om-table__row',
                        rush ? 'om-table__row--rush' : '',
                        isCancelled ? 'om-table__row--cancelled' : '',
                        isSelected ? 'om-table__row--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setDetailOrder(order)}
                    >
                      <td
                        className="om-table__td om-table__td--check"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(order.id, order.status)}
                          disabled={!canSel}
                          aria-label={`Select order ${order.id.slice(0, 8)}`}
                        />
                      </td>

                      <td className="om-table__td">
                        <span className="om-order-num">
                          {order.id.slice(0, 8).toUpperCase()}
                        </span>
                        {rush && !isCancelled && (
                          <span className="om-rush-pip" title="Rush order" />
                        )}
                      </td>

                      <td className="om-table__td">
                        <div className="om-customer-name">
                          {cust?.name ?? order.customerId.slice(0, 10) + '…'}
                        </div>
                        {cust && (
                          <div className="om-customer-city">
                            {cust.city}, {cust.state}
                          </div>
                        )}
                      </td>

                      <td className="om-table__td">
                        <div>{prod?.name ?? '—'}</div>
                        <div className="om-qty">
                          {order.quantity} {prod?.unit ?? 'gal'}
                        </div>
                      </td>

                      <td className="om-table__td">
                        <TierBadge tier={order.deliveryTier} />
                      </td>

                      <td className="om-table__td">
                        {fmtDate(order.scheduledAt)}
                      </td>

                      <td className="om-table__td">
                        <StatusBadge order={order} />
                      </td>

                      <td className="om-table__td om-table__td--right om-total">
                        {fmtCurrency(order.total)}
                      </td>

                      <td
                        className="om-table__td om-table__td--actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="om-action-btn"
                          title="View detail"
                          onClick={() => setDetailOrder(order)}
                          aria-label="View order detail"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                          </svg>
                        </button>

                        {(order.status === 'pending' ||
                          order.status === 'scheduled') && (
                          <button
                            className="om-action-btn"
                            title="Reschedule"
                            onClick={(e) => {
                              e.stopPropagation()
                              setRescheduleOrder(order)
                            }}
                            aria-label="Reschedule order"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <path
                                d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}

                        {order.status === 'pending' && (
                          <button
                            className="om-action-btn om-action-btn--danger"
                            title="Cancel order"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCancel(order.id)
                            }}
                            aria-label="Cancel order"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="2"
                              />
                              <path
                                d="M15 9l-6 6M9 9l6 6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="om-mobile-cards">
              {filtered.map((order) => {
                const cust = customerMap[order.customerId]
                const prod = productMap[order.productId]
                const isActiveDelivery = order.status === 'scheduled' || order.status === 'assigned' || order.status === 'in-transit'
                const isBillingStage = order.status === 'ready_to_invoice' || order.status === 'invoice_sent'
                const isClosed = order.status === 'paid' || order.status === 'invoiced' || order.status === 'archived'
                const canEditOrder = order.status === 'pending' || order.status === 'scheduled'
                const canCancelOrder = canTransition(order.status, 'cancelled')
                const canComplete = canCompleteDelivery(order)

                const primaryAction = isActiveDelivery
                  ? canComplete
                    ? {
                        label: 'Complete Delivery',
                        icon: Truck,
                        onClick: () => setDeliveryModalOrder(order),
                      }
                    : {
                        label: 'View Details',
                        icon: Eye,
                        onClick: () => setDetailOrder(order),
                      }
                  : isBillingStage
                    ? order.status === 'ready_to_invoice'
                      ? {
                          label: 'Mark Invoice Sent',
                          icon: Send,
                          onClick: () => { void handleMobileBillingStatus(order.id, 'invoice_sent') },
                        }
                      : {
                          label: 'Mark as Paid',
                          icon: CheckCircle,
                          onClick: () => { void handleMobileBillingStatus(order.id, 'paid') },
                        }
                    : {
                        label: 'View Details',
                        icon: Eye,
                        onClick: () => setDetailOrder(order),
                      }

                const secondaryActions = isClosed
                  ? []
                  : [
                      ...(canEditOrder
                        ? [{
                            label: 'Edit',
                            icon: Pencil,
                            onClick: () => setRescheduleOrder(order),
                          }]
                        : []),
                      {
                        label: 'View Details',
                        icon: Eye,
                        onClick: () => setDetailOrder(order),
                      },
                      ...(canCancelOrder
                        ? [{
                            label: 'Cancel',
                            icon: XCircle,
                            onClick: () => { void handleCancel(order.id) },
                            destructive: true,
                          }]
                        : []),
                    ]

                return (
                  <div
                    key={`mobile-${order.id}`}
                    className="om-mobile-card-wrap"
                  >
                    <MobileOrderCard
                      order={{
                        ...order,
                        customerName: cust?.name ?? 'Customer',
                        productName: prod?.name ?? 'Product',
                        productUnit: prod?.unit ?? 'gal',
                      } as Order}
                      primaryAction={primaryAction}
                      secondaryActions={secondaryActions}
                      expanded={!['delivered', 'ready_to_invoice', 'invoice_sent', 'paid'].includes(order.status)}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Order detail panel ── */}
      {detailOrder && !isMobile && (
        <OrderDetailPanel
          order={detailOrder}
          customer={customerMap[detailOrder.customerId]}
          product={productMap[detailOrder.productId]}
          onClose={() => setDetailOrder(null)}
          onCancelOrder={(id) => {
            handleCancel(id)
            setDetailOrder(null)
          }}
          onReschedule={(order) => {
            setDetailOrder(null)
            setRescheduleOrder(order)
          }}
          canCompleteDelivery={canCompleteDelivery(detailOrder)}
          onCompleteDelivery={(order) => setDeliveryModalOrder(order)}
          onBillingStatusUpdated={refreshOrderDetail}
        />
      )}

      {detailOrder && isMobile && (
        <OrderDetailSheet
          order={detailOrder}
          customer={customerMap[detailOrder.customerId]}
          product={productMap[detailOrder.productId]}
          onClose={() => setDetailOrder(null)}
          onCancelOrder={(id) => {
            handleCancel(id)
            setDetailOrder(null)
          }}
          onReschedule={(order) => {
            setDetailOrder(null)
            setRescheduleOrder(order)
          }}
          canCompleteDelivery={canCompleteDelivery(detailOrder)}
          onCompleteDelivery={(order) => setDeliveryModalOrder(order)}
          onBillingStatusUpdated={refreshOrderDetail}
        />
      )}

      {deliveryModalOrder && deliveryModalOrder.runId && deliveryModalOrder.runStopId && (
        <DeliveryCompleteModal
          order={deliveryModalOrder}
          runId={deliveryModalOrder.runId}
          stopId={deliveryModalOrder.runStopId}
          onClose={() => setDeliveryModalOrder(null)}
          onSuccess={() => {
            void refreshOrderDetail(deliveryModalOrder.id)
            setDeliveryModalOrder(null)
          }}
        />
      )}

      {/* ── Create order modal ── */}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {}}
        />
      )}

      {/* ── Reschedule modal ── */}
      {rescheduleOrder && (
        <RescheduleModal
          order={rescheduleOrder}
          onClose={() => setRescheduleOrder(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  )
}
