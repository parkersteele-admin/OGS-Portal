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
import { Check, CheckCircle, DollarSign, Eye, FileText, Pencil, Send, Truck, XCircle, type LucideIcon } from 'lucide-react'
import {
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
  where,
  collectionGroup,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { ordersCol, invoicesCol, orderRequestsCol } from '../../../lib/firestore'
import {
  createOrder,
  updateOrder,
  transitionOrderStatus,
  calculateOrderPricing,
  canTransition,
  archiveOrder,
  deleteOrder,
  updateOrderBillingStatus,
  markOrderReadyForInvoice,
} from '../../../services/orderService'
import { generateInvoiceForOrder, sendInvoiceEmailForOrder } from '../../../services/invoiceService'
import { subscribeToCustomers } from '../../../services/customerService'
import { getProductDropdown, type ProductDropdownItem } from '../../../services/productService'
import { updateQuote } from '../../../services/quoteService'
import { useAuth } from '../../../hooks/useAuth'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { InvoiceDetailDrawer } from '../components/InvoiceDetailDrawer'
import { DeliveryCompleteModal } from '../../../components/delivery/DeliveryCompleteModal'
import MobileOrderCard from '../../../components/orders/MobileOrderCard'
import { LineItemsEditor } from '../../shared/line-items/LineItemsEditor'
import {
  EMPTY_LINE_ITEM,
  calculateLineItemRollups,
  recalculateLineItem,
} from '../../shared/line-items/lineItemPricing'
import { getLineItemPricingPermissions } from '../../shared/line-items/lineItemPermissions'
import type { EditableLineItem } from '../../shared/line-items/types'
import type { Order, OrderStatus, DeliveryTier } from '../../../types/order'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import type { Invoice } from '../../../types/billing'
import type { QuoteItem } from '../../../types/crm'
import type { OrderRequest } from '../../../types/orderRequest'
import './OrderManagement.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:    'Pending',
  scheduled:  'Scheduled',
  assigned:   'Assigned',
  'in-transit': 'In Transit',
  in_transit: 'In Transit',
  delivered:  'Delivered',
  invoice_sent_pending: 'Invoice Pending',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  paid:       'Paid',
  cancelled:  'Cancelled',
  archived:   'Archived',
}

const STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  pending: FileText,
  scheduled: FileText,
  assigned: FileText,
  'in-transit': Send,
  in_transit: Send,
  delivered: CheckCircle,
  invoice_sent_pending: FileText,
  ready_to_invoice: FileText,
  invoice_sent: Send,
  paid: CheckCircle,
  cancelled: CheckCircle,
  archived: CheckCircle,
}

const STATUS_ICON_COLORS: Record<OrderStatus, string> = {
  pending: '#f59e0b',
  scheduled: '#64748b',
  assigned: '#3730a3',
  'in-transit': '#facc15',
  in_transit: '#facc15',
  delivered: '#065f46',
  invoice_sent_pending: '#f59e0b',
  ready_to_invoice: '#FF6A00',
  invoice_sent: '#7c3aed',
  paid: '#10b981',
  cancelled: '#6b7280',
  archived: '#6b7280',
}

type OrderLifecycleFilter = 'all' | 'pending' | 'scheduled' | 'in_transit' | 'delivered' | 'invoice_sent' | 'paid' | 'cancelled'

const ORDER_STATUS_FILTERS: Array<{ value: OrderLifecycleFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoice_sent', label: 'Invoice Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

const ORDER_LIFECYCLE_STEPS = [
  { key: 'pending', label: 'Order Created' },
  { key: 'scheduled', label: 'Run Scheduled' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'invoice_sent', label: 'Invoice Sent' },
  { key: 'paid', label: 'Paid' },
] as const

type ManualLifecycleStatus = 'pending' | 'scheduled' | 'in_transit' | 'delivered' | 'invoice_sent' | 'paid'
type AdminOverrideStatus = ManualLifecycleStatus | 'cancelled'

const MANUAL_LIFECYCLE_SEQUENCE: ManualLifecycleStatus[] = [
  'pending',
  'scheduled',
  'in_transit',
  'delivered',
  'invoice_sent',
  'paid',
]

const ADMIN_OVERRIDE_STATUS_OPTIONS: Array<{ value: AdminOverrideStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoice_sent', label: 'Invoice Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

function getAdminStatusOptions(status: OrderStatus): Array<{ value: AdminOverrideStatus; label: string }> {
  const current = normalizeManualStatus(status)
  const next = getNextLifecycleStatus(status)

  const options = ADMIN_OVERRIDE_STATUS_OPTIONS
    .filter((option) => option.value !== current)
    .map((option) => ({
      ...option,
      label: option.value === next ? `Next: ${option.label}` : option.label,
    }))

  options.sort((a, b) => {
    if (a.value === next) return -1
    if (b.value === next) return 1
    return 0
  })

  return options
}

const TIER_LABELS: Record<DeliveryTier, string> = {
  standard:  'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const RUSH_TIERS: DeliveryTier[] = ['next-day', 'same-day']

const ORDER_REQUEST_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  converted: 'Converted',
  archived: 'Archived',
}

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

function normalizeLifecycleStatus(status: OrderStatus): OrderStatus {
  if (status === 'in-transit') return 'in_transit'
  if (status === 'ready_to_invoice') return 'invoice_sent_pending'
  return status
}

function normalizeManualStatus(status: OrderStatus): ManualLifecycleStatus | 'cancelled' | null {
  const normalized = normalizeLifecycleStatus(status)
  if (normalized === 'assigned') return 'in_transit'
  if (normalized === 'invoice_sent_pending') return 'invoice_sent'
  if (normalized === 'pending' || normalized === 'scheduled' || normalized === 'in_transit' || normalized === 'delivered' || normalized === 'invoice_sent' || normalized === 'paid' || normalized === 'cancelled') {
    return normalized
  }
  return null
}

function getNextLifecycleStatus(status: OrderStatus): ManualLifecycleStatus | null {
  const normalized = normalizeManualStatus(status)
  if (!normalized || normalized === 'cancelled') return null
  const idx = MANUAL_LIFECYCLE_SEQUENCE.indexOf(normalized)
  if (idx < 0 || idx >= MANUAL_LIFECYCLE_SEQUENCE.length - 1) return null
  return MANUAL_LIFECYCLE_SEQUENCE[idx + 1]
}

function lifecycleStepIndex(status: OrderStatus): number {
  const normalized = normalizeLifecycleStatus(status)
  if (normalized === 'assigned') return 2
  if (normalized === 'invoice_sent_pending') return 3
  const idx = ORDER_LIFECYCLE_STEPS.findIndex((step) => step.key === normalized)
  return idx >= 0 ? idx : 0
}

function toDateInputValue(ts: { toDate?: () => Date } | string | null | undefined): string {
  if (!ts) return new Date().toISOString().slice(0, 10)
  const parsed = typeof ts === 'string'
    ? new Date(ts)
    : ts.toDate?.() ?? new Date()

  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ order }: { order: Order }) {
  const normalizedStatus = normalizeLifecycleStatus(order.status)
  const StatusIcon = STATUS_ICONS[normalizedStatus]
  return (
    <span className={`om-badge om-badge--${normalizedStatus}`}>
      <StatusIcon size={12} aria-hidden="true" style={{ color: STATUS_ICON_COLORS[normalizedStatus] }} />
      <span>{getOrderStatusLabel(order)}</span>
    </span>
  )
}

function OrderStatusProgression({ status }: { status: OrderStatus }) {
  const current = lifecycleStepIndex(status)
  return (
    <section className="om-progress-wrap" aria-label="Order lifecycle progression">
      <div className="om-progress">
        {ORDER_LIFECYCLE_STEPS.map((step, index) => {
          const state = index < current ? 'complete' : index === current ? 'current' : 'future'
          return (
            <div key={step.key} className={`om-progress__step om-progress__step--${state}`}>
              <div className="om-progress__node-row" aria-hidden="true">
                <span className="om-progress__dot">
                  {state === 'complete' && <Check size={10} strokeWidth={3} />}
                </span>
                {index < ORDER_LIFECYCLE_STEPS.length - 1 && <span className="om-progress__line" />}
              </div>
              <span className="om-progress__label">{step.label}</span>
            </div>
          )
        })}
      </div>
    </section>
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
  onBillingStatusUpdated,
}: OrderDetailSheetProps) {
  const { isAdmin, user, realUser } = useAuth()
  const canCancel = canTransition(order.status, 'cancelled')
  const canEdit = isAdmin || order.status === 'pending' || order.status === 'scheduled'
  const [billingBusy, setBillingBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [sendingEstimate, setSendingEstimate] = useState(false)
  const [overrideStatus, setOverrideStatus] = useState<AdminOverrideStatus | ''>('')
  const [billingToast, setBillingToast] = useState<string | null>(null)
  // Invoice Sent form state
  const [qbInvoiceNumber, setQbInvoiceNumber] = useState(order.qbInvoiceNumber ?? '')
  // Paid form state
  const [paidAmountStr, setPaidAmountStr] = useState(() =>
    (order.paidAmount ?? order.invoiceAmount) != null
      ? Number(order.paidAmount ?? order.invoiceAmount).toFixed(2)
      : '',
  )
  const [paidAtStr, setPaidAtStr] = useState(() => toDateInputValue(order.paidAt))

  const normalizedStatus = normalizeLifecycleStatus(order.status)
  const adminStatusOptions = useMemo(() => getAdminStatusOptions(order.status), [order.status])
  const canSendEstimate =
    order.status === 'pending' || order.status === 'scheduled' || order.status === 'assigned' || order.status === 'in-transit'
  const actingUserId = realUser?.id ?? user?.id
  const showBillingPanel = isAdmin && (normalizedStatus === 'invoice_sent_pending' || normalizedStatus === 'invoice_sent' || normalizedStatus === 'paid')

  useEffect(() => {
    setQbInvoiceNumber(order.qbInvoiceNumber ?? '')
    setPaidAmountStr(
      (order.paidAmount ?? order.invoiceAmount) != null
        ? Number(order.paidAmount ?? order.invoiceAmount).toFixed(2)
        : '',
    )
    setPaidAtStr(toDateInputValue(order.paidAt))
  }, [order.id, order.qbInvoiceNumber, order.paidAmount, order.invoiceAmount, order.paidAt])

  async function handleManualStatusChange(next: AdminOverrideStatus) {
    let qbInvoiceNumber: string | undefined

    if (next === 'invoice_sent') {
      const value = window.prompt('Enter QB Invoice # to mark this order as Invoice Sent:', order.qbInvoiceNumber ?? '')
      if (value === null) return
      qbInvoiceNumber = value.trim()
      if (!qbInvoiceNumber) {
        alert('QB Invoice # is required to mark an order as Invoice Sent.')
        return
      }
      if (!confirm(`Mark this order as Invoice Sent with QB Invoice # ${qbInvoiceNumber}?`)) return
    }

    if ((next === 'delivered' || next === 'paid') && !confirm(`Mark this order as ${STATUS_LABELS[next]}? This action is irreversible.`)) {
      return
    }

    setStatusBusy(true)
    try {
      await transitionOrderStatus(order.id, next, {
        changedBy: actingUserId,
        qbInvoiceNumber,
        force: true,
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast(`Order status updated to ${STATUS_LABELS[next]}.`)
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update order status.')
    } finally {
      setStatusBusy(false)
      setOverrideStatus('')
    }
  }

  async function handleMarkReadyForInvoice() {
    setBillingBusy(true)
    try {
      await markOrderReadyForInvoice(order.id)
      await onBillingStatusUpdated(order.id)
      setBillingToast('Order marked ready for invoice.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to mark order ready for invoice.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleMarkInvoiceSent() {
    const invNum = qbInvoiceNumber.trim()
    if (!invNum) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'invoice_sent', {
        qbInvoiceNumber: invNum,
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

  async function handleSaveInvoiceNumber() {
    const invNum = qbInvoiceNumber.trim()
    if (!invNum) return
    setBillingBusy(true)
    try {
      await updateOrder(order.id, { qbInvoiceNumber: invNum })
      await onBillingStatusUpdated(order.id)
      setBillingToast('QB invoice number updated.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update invoice number.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleSendEstimate() {
    setSendingEstimate(true)
    try {
      const { httpsCallable } = await import('firebase/functions')
      const { functions } = await import('../../../lib/firebase')
      const fn = httpsCallable<{ orderId: string }, { success: boolean }>(
        functions,
        'sendOrderEstimate',
      )
      await fn({ orderId: order.id })
      alert(`Order estimate email sent to ${customer?.email || 'customer'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send estimate email.'
      alert(message)
    } finally {
      setSendingEstimate(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Order ${order.id.slice(0, 8).toUpperCase()}`} size="lg">
      <div className="om-sheet">
        <OrderStatusProgression status={order.status} />
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

        {isAdmin && normalizedStatus === 'delivered' && (
          <button
            className="om-billing-btn om-billing-btn--ready"
            onClick={() => { void handleMarkReadyForInvoice() }}
            disabled={billingBusy}
          >
            {billingBusy ? 'Saving…' : 'Mark Ready for Invoice'}
          </button>
        )}

        {showBillingPanel && (
          <section className="om-billing-panel">
            <div className="om-billing-panel__header">
              <span className="om-billing-panel__title"><DollarSign size={14} /> QuickBooks Billing</span>
            </div>
            <div className="om-billing-panel__body">
              <span className={`om-billing-badge om-billing-badge--${order.status}`}>
                {normalizedStatus === 'invoice_sent_pending' ? 'Invoice Pending' : 'Invoice Sent'}
              </span>
              <p className="om-billing-copy">
                {normalizedStatus === 'invoice_sent_pending'
                  ? 'Enter the QuickBooks invoice number, then confirm invoice sent.'
                  : 'Once payment is received, mark this order as paid.'}
              </p>
              {normalizedStatus === 'invoice_sent_pending' ? (
                <QBInvoiceSentForm
                  qbInvoiceNumber={qbInvoiceNumber}
                  busy={billingBusy}
                  onChangeInvoiceNumber={setQbInvoiceNumber}
                  onSubmit={handleMarkInvoiceSent}
                />
              ) : (
                <QBPaidForm
                  qbInvoiceNumber={qbInvoiceNumber}
                  paidAmountStr={paidAmountStr}
                  paidAtStr={paidAtStr}
                  busy={billingBusy}
                  onChangeInvoiceNumber={setQbInvoiceNumber}
                  onChangePaidAmount={setPaidAmountStr}
                  onChangePaidAt={setPaidAtStr}
                  onSubmitInvoiceNumber={handleSaveInvoiceNumber}
                  onSubmit={handleMarkPaid}
                />
              )}
              {billingToast && <p className="om-billing-toast">{billingToast}</p>}
            </div>
          </section>
        )}

        <div className="om-sheet__actions">
          <div className="om-action-row om-action-row--secondary">
            {canSendEstimate && (
              <button
                type="button"
                className="om-panel-btn om-panel-btn--secondary"
                onClick={() => { void handleSendEstimate() }}
                disabled={sendingEstimate}
              >
                {sendingEstimate ? 'Sending...' : 'Send Estimate'}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="om-panel-btn om-panel-btn--secondary"
                onClick={() => onReschedule(order)}
              >
                Reschedule
              </button>
            )}
          </div>

          <div className="om-action-row om-action-row--tertiary">
            {isAdmin && (
              <div className="om-manual-status__inline om-manual-status__inline--action">
                <div className="om-manual-status__select-wrap">
                  <select
                    id={`sheet-override-status-${order.id}`}
                    className="om-manual-status__select om-manual-status__select--inline"
                    value={overrideStatus}
                    onChange={(e) => {
                      setOverrideStatus(e.target.value as AdminOverrideStatus | '')
                    }}
                    disabled={statusBusy}
                  >
                    <option value="">Select status change</option>
                    {adminStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="om-manual-status__caret" aria-hidden="true">▾</span>
                </div>
                <button
                  type="button"
                  className="om-panel-btn om-panel-btn--secondary om-panel-btn--status-apply"
                  onClick={() => {
                    if (overrideStatus) {
                      void handleManualStatusChange(overrideStatus)
                    }
                  }}
                  disabled={!overrideStatus || statusBusy}
                >
                  {statusBusy ? 'Saving…' : 'Update Status'}
                </button>
              </div>
            )}
            {canCancel && (
              <button
                type="button"
                className="om-panel-btn om-panel-btn--danger"
                onClick={() => onCancelOrder(order.id)}
              >
                Cancel Order
              </button>
            )}
          </div>
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
  onBillingStatusUpdated,
}: OrderDetailPanelProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, user, realUser } = useAuth()
  const opsBase  = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'
  const isAdminView = location.pathname.startsWith('/admin')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [showInvoiceDetail, setShowInvoiceDetail] = useState(false)
  const [generatingInvoice, setGeneratingInvoice] = useState(false)
  const [sendingInvoiceEmail, setSendingInvoiceEmail] = useState(false)
  const [sendingEstimate, setSendingEstimate] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [overrideStatus, setOverrideStatus] = useState<AdminOverrideStatus | ''>('')
  const [billingToast, setBillingToast] = useState<string | null>(null)
  // Invoice Sent form state
  const [qbInvoiceNumber, setQbInvoiceNumber] = useState(order.qbInvoiceNumber ?? '')
  // Paid form state
  const [paidAmountStr, setPaidAmountStr] = useState(() =>
    (order.paidAmount ?? order.invoiceAmount) != null
      ? Number(order.paidAmount ?? order.invoiceAmount).toFixed(2)
      : '',
  )
  const [paidAtStr, setPaidAtStr] = useState(() => toDateInputValue(order.paidAt))
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
    order.status === 'in_transit' ||
    order.status === 'delivered'
  ) {
    timeline.push({ label: STATUS_LABELS[order.status], time: 'Today' })
  }

  const canCancel = canTransition(order.status, 'cancelled')
  const canEdit = isAdmin || order.status === 'pending' || order.status === 'scheduled'
  const normalizedStatus = normalizeLifecycleStatus(order.status)
  const canSendEstimate =
    order.status === 'pending' || order.status === 'scheduled' || order.status === 'assigned' || order.status === 'in-transit'
  const actingUserId = realUser?.id ?? user?.id
  const showBillingPanel = isAdmin && (normalizedStatus === 'invoice_sent_pending' || normalizedStatus === 'invoice_sent')
  const adminStatusOptions = useMemo(() => getAdminStatusOptions(order.status), [order.status])

  useEffect(() => {
    setQbInvoiceNumber(order.qbInvoiceNumber ?? '')
    setPaidAmountStr(
      (order.paidAmount ?? order.invoiceAmount) != null
        ? Number(order.paidAmount ?? order.invoiceAmount).toFixed(2)
        : '',
    )
    setPaidAtStr(toDateInputValue(order.paidAt))
  }, [order.id, order.qbInvoiceNumber, order.paidAmount, order.invoiceAmount, order.paidAt])

  async function handleManualStatusChange(next: AdminOverrideStatus) {
    let qbInvoiceNumber: string | undefined

    if (next === 'invoice_sent') {
      const value = window.prompt('Enter QB Invoice # to mark this order as Invoice Sent:', order.qbInvoiceNumber ?? '')
      if (value === null) return
      qbInvoiceNumber = value.trim()
      if (!qbInvoiceNumber) {
        alert('QB Invoice # is required to mark an order as Invoice Sent.')
        return
      }
      if (!confirm(`Mark this order as Invoice Sent with QB Invoice # ${qbInvoiceNumber}?`)) return
    }

    if ((next === 'delivered' || next === 'paid') && !confirm(`Mark this order as ${STATUS_LABELS[next]}? This action is irreversible.`)) {
      return
    }

    setStatusBusy(true)
    try {
      await transitionOrderStatus(order.id, next, {
        changedBy: actingUserId,
        qbInvoiceNumber,
        force: true,
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast(`Order status updated to ${STATUS_LABELS[next]}.`)
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update order status.')
    } finally {
      setStatusBusy(false)
      setOverrideStatus('')
    }
  }

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
    if (!invNum) return
    setBillingBusy(true)
    try {
      await updateOrderBillingStatus(order.id, 'invoice_sent', {
        qbInvoiceNumber: invNum,
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

  async function handleSaveInvoiceNumber() {
    const invNum = qbInvoiceNumber.trim()
    if (!invNum) return
    setBillingBusy(true)
    try {
      await transitionOrderStatus(order.id, 'invoice_sent', {
        changedBy: actingUserId,
        qbInvoiceNumber: invNum,
        force: true,
      })
      await onBillingStatusUpdated(order.id)
      setBillingToast('QB invoice number updated.')
      setTimeout(() => setBillingToast(null), 2500)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update invoice number.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleSendEstimate() {
    setSendingEstimate(true)
    try {
      const { httpsCallable } = await import('firebase/functions')
      const { functions } = await import('../../../lib/firebase')
      const fn = httpsCallable<{ orderId: string }, { success: boolean }>(
        functions,
        'sendOrderEstimate',
      )
      await fn({ orderId: order.id })
      alert(`Order estimate email sent to ${customer?.email || 'customer'}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send estimate email.'
      alert(message)
    } finally {
      setSendingEstimate(false)
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
          <div className="om-panel__header-copy">
            <div className="om-panel__order-num">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </div>
            <div className="om-panel__customer-name">{customer?.name ?? 'Unknown customer'}</div>
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
          <OrderStatusProgression status={order.status} />
          {/* Customer info */}
          <section className="om-panel__section">
            <div className="om-panel__section-title">Customer Info</div>
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
          </section>

          {/* Product + pricing */}
          <section className="om-panel__section om-panel__section--pricing">
            <div className="om-panel__section-title">Product & Pricing</div>
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
            {order.qbInvoiceNumber && (
              <div className="om-panel__row">
                <span className="om-panel__label">QB Invoice #</span>
                <span className="om-panel__val">{order.qbInvoiceNumber}</span>
              </div>
            )}
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
                    <FileText size={14} aria-hidden="true" /> View PDF
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
                  {normalizedStatus === 'invoice_sent_pending' ? 'Invoice Pending' : 'Invoice Sent'}
                </span>
                <p className="om-billing-copy">
                  {normalizedStatus === 'invoice_sent_pending'
                    ? 'Enter the QuickBooks invoice number, then confirm invoice sent.'
                    : normalizedStatus === 'invoice_sent'
                      ? 'Once payment is received, mark this order as paid or update the QB invoice number.'
                      : 'Update the QB invoice number if needed.'}
                </p>
                {normalizedStatus === 'invoice_sent_pending' ? (
                  <QBInvoiceSentForm
                    qbInvoiceNumber={qbInvoiceNumber}
                    busy={billingBusy}
                    onChangeInvoiceNumber={setQbInvoiceNumber}
                    onSubmit={handleMarkInvoiceSent}
                  />
                ) : normalizedStatus === 'invoice_sent' ? (
                  <QBPaidForm
                    qbInvoiceNumber={qbInvoiceNumber}
                    paidAmountStr={paidAmountStr}
                    paidAtStr={paidAtStr}
                    busy={billingBusy}
                    onChangeInvoiceNumber={setQbInvoiceNumber}
                    onChangePaidAmount={setPaidAmountStr}
                    onChangePaidAt={setPaidAtStr}
                    onSubmitInvoiceNumber={handleSaveInvoiceNumber}
                    onSubmit={handleMarkPaid}
                  />
                ) : (
                  <QBInvoiceNumberForm
                    qbInvoiceNumber={qbInvoiceNumber}
                    busy={billingBusy}
                    onChangeInvoiceNumber={setQbInvoiceNumber}
                    onSubmit={handleSaveInvoiceNumber}
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
          <div className="om-action-stack">
            <div className="om-action-row om-action-row--secondary">
              {canSendEstimate && (
                <button
                  type="button"
                  className="om-panel-btn om-panel-btn--secondary"
                  onClick={() => { void handleSendEstimate() }}
                  disabled={sendingEstimate}
                >
                  {sendingEstimate ? 'Sending...' : 'Send Estimate'}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="om-panel-btn om-panel-btn--secondary"
                  onClick={() => onReschedule(order)}
                >
                  Reschedule
                </button>
              )}
            </div>

            <div className="om-action-row om-action-row--tertiary">
              {isAdmin && (
                <div className="om-manual-status__inline om-manual-status__inline--action">
                  <div className="om-manual-status__select-wrap">
                    <select
                      id={`override-status-${order.id}`}
                      aria-label="Override status"
                      className="om-manual-status__select om-manual-status__select--inline"
                      value={overrideStatus}
                      onChange={(e) => {
                        setOverrideStatus(e.target.value as AdminOverrideStatus | '')
                      }}
                      disabled={statusBusy}
                    >
                      <option value="">Select status change</option>
                      {adminStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="om-manual-status__caret" aria-hidden="true">▾</span>
                  </div>
                  <button
                    type="button"
                    className="om-panel-btn om-panel-btn--secondary om-panel-btn--status-apply"
                    onClick={() => {
                      if (overrideStatus) {
                        void handleManualStatusChange(overrideStatus)
                      }
                    }}
                    disabled={!overrideStatus || statusBusy}
                  >
                    {statusBusy ? 'Saving…' : 'Update Status'}
                  </button>
                </div>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="om-panel-btn om-panel-btn--danger"
                  onClick={() => onCancelOrder(order.id)}
                >
                  Cancel Order
                </button>
              )}
            </div>
          </div>
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
  busy: boolean
  onChangeInvoiceNumber: (v: string) => void
  onSubmit: () => void
}

function QBInvoiceSentForm({
  qbInvoiceNumber,
  busy,
  onChangeInvoiceNumber,
  onSubmit,
}: QBInvoiceSentFormProps) {
  const canSubmit = qbInvoiceNumber.trim() !== '' && !busy
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
      <button
        className="om-billing-btn"
        onClick={onSubmit}
        disabled={!canSubmit}
      >
        {busy ? 'Saving…' : 'Confirm Invoice Sent'}
      </button>
    </div>
  )
}

interface QBPaidFormProps {
  qbInvoiceNumber: string
  paidAmountStr: string
  paidAtStr: string
  busy: boolean
  onChangeInvoiceNumber: (v: string) => void
  onChangePaidAmount: (v: string) => void
  onChangePaidAt: (v: string) => void
  onSubmitInvoiceNumber: () => void
  onSubmit: () => void
}

function QBPaidForm({
  qbInvoiceNumber,
  paidAmountStr,
  paidAtStr,
  busy,
  onChangeInvoiceNumber,
  onChangePaidAmount,
  onChangePaidAt,
  onSubmitInvoiceNumber,
  onSubmit,
}: QBPaidFormProps) {
  const pAmt = parseFloat(paidAmountStr)
  const canSaveInvoice = qbInvoiceNumber.trim() !== '' && !busy
  const canSubmit = !isNaN(pAmt) && pAmt > 0 && !busy
  return (
    <div className="om-qb-form">
      <div className="om-qb-form__field om-qb-form__field--row">
        <div className="om-qb-form__field-grow">
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
        <button
          className="om-billing-btn om-billing-btn--secondary"
          onClick={onSubmitInvoiceNumber}
          disabled={!canSaveInvoice}
        >
          {busy ? 'Saving…' : 'Save #'}
        </button>
      </div>
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

interface QBInvoiceNumberFormProps {
  qbInvoiceNumber: string
  busy: boolean
  onChangeInvoiceNumber: (v: string) => void
  onSubmit: () => void
}

function QBInvoiceNumberForm({
  qbInvoiceNumber,
  busy,
  onChangeInvoiceNumber,
  onSubmit,
}: QBInvoiceNumberFormProps) {
  const canSave = qbInvoiceNumber.trim() !== '' && !busy

  return (
    <div className="om-qb-form">
      <div className="om-qb-form__field om-qb-form__field--row">
        <div className="om-qb-form__field-grow">
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
        <button
          className="om-billing-btn om-billing-btn--secondary"
          onClick={onSubmit}
          disabled={!canSave}
        >
          {busy ? 'Saving…' : 'Save #'}
        </button>
      </div>
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
  initialCustomerId?: string | null
  initialLineItems?: EditableLineItem[] | null
  convertingQuoteId?: string | null
  onClose: () => void
  onCreated: () => void
}

function CreateOrderModal({ initialCustomerId, initialLineItems, convertingQuoteId, onClose, onCreated }: CreateOrderModalProps) {
  const { role } = useAuth()
  const pricingPermissions = useMemo(() => getLineItemPricingPermissions(role), [role])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<ProductDropdownItem[]>([])
  const [lineItems, setLineItems] = useState<EditableLineItem[]>(initialLineItems ?? [EMPTY_LINE_ITEM()])
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [tier, setTier] = useState<DeliveryTier>('standard')
  const [notes, setNotes] = useState('')
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [applySalesTax, setApplySalesTax] = useState(false)
  const [salesTaxRatePercent, setSalesTaxRatePercent] = useState('0.00')
  const customerInputRef = useRef<HTMLInputElement>(null)

  // Load products on mount
  useEffect(() => {
    getProductDropdown()
      .then((items) => setProducts(items.filter((item) => item.id !== 'delivery')))
      .catch(() => setProducts([]))
  }, [])

  // Load customers (subscribe for typeahead)
  useEffect(() => {
    const unsub = subscribeToCustomers(
      { status: 'active' },
      (data) => setCustomers(data),
    )
    return unsub
  }, [])

  // Pre-fill customer if initialCustomerId is provided
  useEffect(() => {
    if (initialCustomerId && customers.length > 0 && !selectedCustomer) {
      const customer = customers.find((c) => c.id === initialCustomerId)
      if (customer) {
        setSelectedCustomer(customer)
        setCustomerSearch('')
        setShowCustomerDropdown(false)
      }
    }
  }, [initialCustomerId, customers, selectedCustomer])

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

  const pricedLineItems = useMemo(
    () => lineItems.filter((item) => item.productId && item.quantity > 0 && item.unitPrice >= 0),
    [lineItems],
  )

  const revenueProducts = useMemo(
    () => parseFloat(pricedLineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2)),
    [pricedLineItems],
  )

  const totalCost = useMemo(
    () => parseFloat(pricedLineItems.reduce((sum, item) => sum + (item.cost * item.quantity), 0).toFixed(2)),
    [pricedLineItems],
  )

  const lineProfit = useMemo(
    () => parseFloat(pricedLineItems.reduce((sum, item) => sum + item.profit, 0).toFixed(2)),
    [pricedLineItems],
  )

  const tierPricing = useMemo(() => calculateOrderPricing(1, 1, tier), [tier])
  const upchargePercent = tierPricing.upchargePercent
  const deliveryFee = tierPricing.deliveryFee
  const upchargeAmount = parseFloat((revenueProducts * upchargePercent).toFixed(2))

  const safeTaxRate = applySalesTax ? Math.max(0, parseFloat(salesTaxRatePercent) || 0) : 0
  const rollups = useMemo(
    () => calculateLineItemRollups({
      revenueProducts,
      totalCost,
      lineProfit,
      extraRevenue: upchargeAmount + deliveryFee,
      applySalesTax,
      salesTaxRate: safeTaxRate / 100,
    }),
    [revenueProducts, totalCost, lineProfit, upchargeAmount, deliveryFee, applySalesTax, safeTaxRate],
  )

  const quoteLineItems = useMemo<QuoteItem[]>(
    () => pricedLineItems.map((item) => ({
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
    })),
    [pricedLineItems],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!selectedCustomer) return setError('Please select a customer.')

    const eligibleItems = quoteLineItems.filter(
      (item) => item.productId && item.quantity > 0 && item.productId !== 'delivery' && item.productId !== 'rental',
    )
    if (eligibleItems.length === 0) {
      return setError('Add at least one valid line item.')
    }

    const [primary, ...rest] = eligibleItems
    if (!primary) return setError('Add at least one valid line item.')

    setSubmitting(true)
    setError('')
    try {
      if (convertingQuoteId) {
        const quoteSnap = await getDoc(doc(db, 'quotes', convertingQuoteId))
        if (quoteSnap.exists()) {
          const quoteData = quoteSnap.data() as {
            convertedOrderId?: string
            convertedOrderIds?: string[]
          }
          const existingConvertedIds = [
            quoteData.convertedOrderId,
            ...(quoteData.convertedOrderIds ?? []),
          ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)

          if (existingConvertedIds.length > 0) {
            const shortId = existingConvertedIds[0].slice(0, 8).toUpperCase()
            throw new Error(`This quote is already linked to order ${shortId}.`)
          }
        }
      }

      const orderId = await createOrder(
        {
          customerId: selectedCustomer.id,
          productId: primary.productId,
          quantity: primary.quantity,
          deliveryTier: tier,
          notes: notes || undefined,
        },
        primary.unitPrice,
      )

      const addOnAddedAt = new Date().toISOString()
      await updateOrder(orderId, {
        productId: primary.productId,
        quantity: primary.quantity,
        unitPrice: primary.unitPrice,
        upchargePercent,
        subtotal: parseFloat((revenueProducts + upchargeAmount).toFixed(2)),
        deliveryFee,
        total: rollups.totalRevenue,
        applySalesTax,
        salesTaxRate: applySalesTax ? safeTaxRate / 100 : 0,
        salesTaxAmount: applySalesTax ? rollups.salesTaxAmount : 0,
        taxRate: applySalesTax ? safeTaxRate / 100 : 0,
        quotedLineItems: eligibleItems,
        addOns: rest.map((item) => ({
          productId: item.productId,
          productName: item.description,
          qty: item.quantity,
          unitPrice: item.unitPrice,
          addedBy: 'manual_create',
          addedAt: addOnAddedAt,
        })),
        notes: notes || undefined,
        scheduledAt: scheduledDate
          ? (new Date(scheduledDate) as unknown as Order['scheduledAt'])
          : undefined,
      })

      // Mark quote as accepted if converting from a quote
      if (convertingQuoteId) {
        await updateQuote(convertingQuoteId, {
          status: 'accepted',
          convertedOrderId: orderId,
          convertedOrderIds: [orderId],
          needsOrderSetup: false,
        })
      }

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

          {/* Sales Tax */}
          <div className="om-field">
            <label className="om-field__label">Sales Tax</label>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="create-sales-tax"
                  checked={!applySalesTax}
                  onChange={() => setApplySalesTax(false)}
                />
                No tax
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="create-sales-tax"
                  checked={applySalesTax}
                  onChange={() => setApplySalesTax(true)}
                />
                Apply sales tax
              </label>
            </div>
            {applySalesTax && (
              <Input
                label="Sales Tax Rate (%)"
                id="create-tax-rate"
                type="number"
                min="0"
                step="0.01"
                value={salesTaxRatePercent}
                onChange={(e) => setSalesTaxRatePercent(e.target.value)}
              />
            )}
          </div>

          <div className="om-field">
            <label className="om-field__label">Line Items</label>
            <LineItemsEditor
              items={lineItems}
              products={products}
              disabled={submitting}
              canViewInternalPricing={pricingPermissions.canViewInternalPricing}
              canEditInternalPricing={pricingPermissions.canEditInternalPricing}
              enforceMarginFloor={pricingPermissions.enforceMarginFloor}
              onChange={(items) => setLineItems(items.map((item) => recalculateLineItem(item, 'other', pricingPermissions.enforceMarginFloor)))}
            />
          </div>

          {/* Summary */}
          {quoteLineItems.length > 0 && (
            <div className="om-pricing-preview">
              <div className="om-pricing-preview__title">Summary</div>
              <div className="om-pricing-preview__row">
                <span>Revenue (products)</span>
                <span>{fmtCurrency(rollups.revenueProducts)}</span>
              </div>
              <div className="om-pricing-preview__row">
                <span>Total cost</span>
                <span>{fmtCurrency(rollups.totalCost)}</span>
              </div>
              <div className="om-pricing-preview__row">
                <span>Line profit</span>
                <span>{fmtCurrency(rollups.lineProfit)}</span>
              </div>
              {upchargePercent > 0 && (
                <div className="om-pricing-preview__row om-pricing-preview__row--upcharge">
                  <span>
                    {TIER_LABELS[tier]} upcharge ({(upchargePercent * 100).toFixed(0)}%)
                  </span>
                  <span>{fmtCurrency(upchargeAmount)}</span>
                </div>
              )}
              <div className="om-pricing-preview__row">
                <span>Pre-tax total</span>
                <span>{fmtCurrency(rollups.preTaxTotal)}</span>
              </div>
              <div className="om-pricing-preview__row">
                <span>Sales tax{applySalesTax && safeTaxRate > 0 ? ` (${safeTaxRate}%)` : ''}</span>
                <span>{fmtCurrency(rollups.salesTaxAmount)}</span>
              </div>
              <div className="om-pricing-preview__row om-pricing-preview__row--total">
                <span>Total revenue</span>
                <span>{fmtCurrency(rollups.totalRevenue)}</span>
              </div>
              <div className="om-pricing-preview__row">
                <span>Total profit</span>
                <span>{fmtCurrency(rollups.totalProfit)}</span>
              </div>
              <div className="om-pricing-preview__row">
                <span>Overall margin %</span>
                <span>{(rollups.overallMarginPercent * 100).toFixed(1)}%</span>
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
  const { isAdmin, isDispatch, user, realUser } = useAuth()

  // ── Data ──────────────────────────────────────────────────────────────────────
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, Customer>>({})
  const [productMap, setProductMap] = useState<Record<string, Product>>({})
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [orderRequests, setOrderRequests] = useState<OrderRequest[]>([])
  const [orderRequestsLoading, setOrderRequestsLoading] = useState(true)
  const [reviewingRequestIds, setReviewingRequestIds] = useState<Set<string>>(new Set())

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderLifecycleFilter>('all')
  const [tierFilter, setTierFilter] = useState<DeliveryTier | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rushOnly, setRushOnly] = useState(false)

  // ── Table state ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Panels / modals ───────────────────────────────────────────────────────────
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [initialCreateCustomerId, setInitialCreateCustomerId] = useState<string | null>(null)
  const [initialCreateLineItems, setInitialCreateLineItems] = useState<EditableLineItem[] | null>(null)
  const [convertingQuoteId, setConvertingQuoteId] = useState<string | null>(null)
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

  // Handle query params for opening create modal with pre-filled customer
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const newParam = params.get('new')
    const customerId = params.get('customerId')
    const convertQuoteId = params.get('convertQuoteId')
    
    if (newParam === '1') {
      setShowCreate(true)
      if (customerId) {
        setInitialCreateCustomerId(customerId)
      }
      // Clean up URL params
      window.history.replaceState({}, '', location.pathname)
    } else if (convertQuoteId) {
      // Handle quote-to-order conversion
      const loadQuote = async () => {
        try {
          const quoteSnap = await getDoc(doc(db, 'quotes', convertQuoteId))
          if (quoteSnap.exists()) {
            const quoteData = { ...quoteSnap.data() } as any
            setInitialCreateCustomerId(quoteData.customerId || '')
            setConvertingQuoteId(convertQuoteId)
            
            // Convert quote line items to EditableLineItem format
            const editableItems: EditableLineItem[] = (quoteData.lineItems || [])
              .filter((item: QuoteItem) => item.productId && item.productId !== 'delivery' && item.productId !== 'rental')
              .map((item: QuoteItem) => ({
                _id: crypto.randomUUID(),
                productId: item.productId,
                productName: item.description,
                skuLabel: '',
                description: item.description,
                quantity: item.quantity,
                basePrice: item.unitPrice,
                cost: 0, // Cost not available from quote
                minMarginPercent: 0.2,
                minPrice: 0,
                marginPercent: 0,
                profit: 0,
                unitPrice: item.unitPrice,
                amount: item.amount,
              }))
            
            if (editableItems.length > 0) {
              setInitialCreateLineItems(editableItems)
            }
            setShowCreate(true)
          }
        } catch (err) {
          console.error('Failed to load quote for conversion:', err)
        }
      }
      
      loadQuote()
      // Clean up URL params
      window.history.replaceState({}, '', location.pathname)
    }
  }, [location])

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

  useEffect(() => {
    const unsub = onSnapshot(
      query(orderRequestsCol, orderBy('createdAt', 'desc'), limit(20)),
      (snap) => {
        setOrderRequests(
          snap.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id })),
        )
        setOrderRequestsLoading(false)
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

    if (statusFilter !== 'all') {
      result = result.filter((o) => normalizeLifecycleStatus(o.status) === statusFilter)
    }

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
      && (order.status === 'in-transit' || order.status === 'in_transit' || order.status === 'assigned')
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
      await transitionOrderStatus(id, 'cancelled', {
        changedBy: realUser?.id ?? user?.id,
        force: true,
      })
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

  async function handleMarkRequestReviewed(requestId: string) {
    if (!requestId) return
    setReviewingRequestIds((prev) => new Set(prev).add(requestId))
    try {
      await updateDoc(doc(db, 'orderRequests', requestId), {
        status: 'reviewed',
        reviewedAt: serverTimestamp(),
        reviewedBy: realUser?.id ?? user?.id ?? null,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update order request.')
    } finally {
      setReviewingRequestIds((prev) => {
        const next = new Set(prev)
        next.delete(requestId)
        return next
      })
    }
  }

  const selectedCount = selected.size
  const newOrderRequestCount = orderRequests.filter((request) => request.status === 'new').length

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
              {ORDER_STATUS_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`om-filters__chip${statusFilter === item.value ? ' om-filters__chip--active' : ''}`}
                  onClick={() => setStatusFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <select
              className="om-filters__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as OrderLifecycleFilter)}
              aria-label="Filter by status"
            >
              {ORDER_STATUS_FILTERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
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

      <section className="om-requests" aria-label="Order requests">
        <div className="om-requests__head">
          <div>
            <h2>Order Requests</h2>
            <p>
              Captured from the public request form at /order-request. New: {newOrderRequestCount}
            </p>
          </div>
          <a
            className="om-requests__embed-link"
            href="/order-request?embed=1"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open embed form
          </a>
        </div>

        {orderRequestsLoading ? (
          <div className="om-empty">Loading order requests…</div>
        ) : orderRequests.length === 0 ? (
          <div className="om-empty">No requests yet.</div>
        ) : (
          <div className="om-requests__list">
            {orderRequests.map((request) => {
              const statusLabel = ORDER_REQUEST_STATUS_LABELS[request.status] ?? request.status
              const reviewing = reviewingRequestIds.has(request.id)
              return (
                <article key={request.id} className="om-request-card">
                  <div className="om-request-card__row">
                    <strong>{request.name}</strong>
                    <span className={`om-request-card__status om-request-card__status--${request.status}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="om-request-card__row om-request-card__row--meta">
                    <span>{request.phone}</span>
                    <span>{request.email}</span>
                    <span>{fmtDateTime(request.createdAt)}</span>
                  </div>
                  {request.company && <p className="om-request-card__line">Company: {request.company}</p>}
                  {request.deliveryAddress && <p className="om-request-card__line">Address: {request.deliveryAddress}</p>}
                  {request.preferredDeliveryDate && <p className="om-request-card__line">Preferred date: {request.preferredDeliveryDate}</p>}
                  {(request.requestedItems ?? []).length > 0 && (
                    <p className="om-request-card__line">Items: {(request.requestedItems ?? []).join(', ')}</p>
                  )}
                  {request.requestDetails && <p className="om-request-card__notes">{request.requestDetails}</p>}

                  <div className="om-request-card__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowCreate(true)}
                    >
                      + Create Order
                    </Button>
                    {request.status === 'new' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={reviewing}
                        onClick={() => {
                          void handleMarkRequestReviewed(request.id)
                        }}
                      >
                        {reviewing ? 'Saving…' : 'Mark Reviewed'}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

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
                        <div>{fmtCurrency(order.total)}</div>
                        {order.qbInvoiceNumber && (
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>QB #{order.qbInvoiceNumber}</div>
                        )}
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
                const normalizedStatus = normalizeLifecycleStatus(order.status)
                const isActiveDelivery = normalizedStatus === 'scheduled' || normalizedStatus === 'assigned' || normalizedStatus === 'in_transit'
                const isBillingStage = normalizedStatus === 'invoice_sent_pending' || normalizedStatus === 'invoice_sent'
                const isClosed = order.status === 'paid' || order.status === 'archived'
                const canEditOrder = isAdmin || order.status === 'pending' || order.status === 'scheduled'
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
                    ? normalizedStatus === 'invoice_sent_pending'
                      ? {
                          label: 'View Details',
                          icon: Eye,
                          onClick: () => setDetailOrder(order),
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
                        status: normalizeLifecycleStatus(order.status),
                        customerName: cust?.name ?? 'Customer',
                        productName: prod?.name ?? 'Product',
                        productUnit: prod?.unit ?? 'gal',
                      } as Order}
                      primaryAction={primaryAction}
                      secondaryActions={secondaryActions}
                      expanded={!['delivered', 'ready_to_invoice', 'invoice_sent_pending', 'invoice_sent', 'paid'].includes(normalizedStatus)}
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
          initialCustomerId={initialCreateCustomerId}
          initialLineItems={initialCreateLineItems}
          convertingQuoteId={convertingQuoteId}
          onClose={() => {
            setShowCreate(false)
            setInitialCreateCustomerId(null)
            setInitialCreateLineItems(null)
            setConvertingQuoteId(null)
          }}
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
