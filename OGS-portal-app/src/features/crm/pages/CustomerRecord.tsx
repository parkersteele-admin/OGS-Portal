/**
 * src/pages/crm/CustomerRecord.tsx
 *
 * Full customer record for sales/admin users.
 * Route: /crm/customers/:customerId
 *
 * Tabs:
 *   1. Overview    — tanks, balance, recent orders/invoices, quick actions
 *   2. History     — contact log timeline + "Log interaction" modal
 *   3. Notes       — free-form notes, credit limit, delivery/access notes, hold toggle
 *   4. Documents   — contracts, signed agreements, upload
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  Ban,
  CheckCircle,
  FileText,
  Handshake,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Paperclip,
  Phone,
  Send,
  StickyNote,
  Unlock,
  type LucideIcon,
} from 'lucide-react'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  collection,
  query as fsQuery,
  where,
  orderBy as fsOrderBy,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import {
  useCustomer,
  useCustomerOrders,
  useCustomerInvoices,
  queryKeys,
} from '../../../hooks/queries'
import { useCustomerTanks } from '../../../hooks/useCustomerTanks'
import { useAuth } from '../../../hooks/useAuth'
import { updateCustomer, archiveCustomer, deleteCustomer, restoreCustomer } from '../../../services/customerService'
import { getUsersByCompany, assignUserRole, deactivateUser, reactivateUser, sendPasswordReset } from '../../../services/userService'
import { getInvoice, getInvoices, createInvoice, saveDraftInvoiceEdits } from '../../../services/invoiceService'
import { getCompanySettings } from '../../../services/companySettingsService'
import { getProductDropdown, getVisibleProducts, type ProductDropdownItem } from '../../../services/productService'
import { setCustomerProductPrice, removeCustomerProductPrice } from '../../../services/customerPricingService'
import { useCustomerProductPricing } from '../../../hooks/useCustomerProductPricing'
import { getOrders, getRouteSchedule, updateRouteSchedule } from '../../../services/orderService'
import { getQuotes, duplicateQuote, convertQuoteToOrder, updateQuote, deleteQuote } from '../../../services/quoteService'
import type { Order, OrderStatus, RouteSchedule, RouteCadence } from '../../../types/order'
import { getFilesForEntity, uploadFile, deleteFile, getFileUrl } from '../../../services/fileService'
import { formatCurrency, formatDate, formatRelative } from '../../../utils/format'
import { formatAddress, getGoogleMapsUrl } from '../../../utils/addressUtils'
import { Card, CardHeader, CardBody } from '../../../components/ui/Card'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { Input } from '../../../components/ui/Input'
import { CreateUserModal } from '../../../components/ui/CreateUserModal'
import type { Customer, CustomerStatus } from '../../../types/customer'
import type { ContactLog, ContactMethod } from '../../../types/crm'
import type { Quote } from '../../../types/crm'
import type { AppFile } from '../../../types/file'
import type { AppUser } from '../../../types/user'
import type { UserRole } from '../../../types/user'
import type { Invoice } from '../../../types/billing'
import './CustomerRecord.css'

// ── Extended types for CRM-specific Firestore fields ─────────────────────────

interface CustomerRecord extends Customer {
  isPriority?:          boolean
  holdReason?:          string
  deliveryNotes?:       string
  accessInstructions?:  string
  // Company / onboarding fields stored in the same customers/{id} document
  companyName?:         string
  billingContactName?:  string
  billingEmail?:        string
  billingAddress?:      { street?: string; city?: string; state?: string; zip?: string } | null
  deliveryAddress?:     { street?: string; city?: string; state?: string; zip?: string } | null
}

interface ContactLogWithFollowUp extends ContactLog {
  followUpAt?: Timestamp | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'orderHistory' | 'history' | 'notes' | 'documents' | 'access' | 'productPricing' | 'standingOrder'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',       label: 'Overview' },
  { key: 'orderHistory',   label: 'Order History' },
  { key: 'history',        label: 'Contact History' },
  { key: 'notes',          label: 'Account Notes' },
  { key: 'documents',      label: 'Documents' },
  { key: 'access',         label: 'User Access' },
  { key: 'productPricing', label: 'Product Pricing' },
  { key: 'standingOrder',  label: 'Standing Order' },
]

const STATUS_BADGE: Record<CustomerStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' }> = {
  active:   { label: 'Active',   variant: 'success' },
  inactive: { label: 'Inactive', variant: 'neutral' },
  hold:     { label: 'On Hold',  variant: 'warning' },
  archived: { label: 'Archived', variant: 'neutral' },
  deleted:  { label: 'Deleted',  variant: 'danger'  },
}

const METHOD_ICONS: Record<ContactMethod, LucideIcon> = {
  call: Phone,
  email: Mail,
  text: MessageSquare,
  'in-person': Handshake,
  other: StickyNote,
}

const METHOD_LABELS: Record<ContactMethod, string> = {
  call:       'Phone call',
  email:      'Email',
  text:       'Text message',
  'in-person':'In person',
  other:      'Other',
}

const INVOICE_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'> = {
  paid:    'success',
  sent:    'info',
  overdue: 'danger',
  draft:   'neutral',
  void:    'neutral',
}

const ORDER_BADGE: Record<OrderStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'> = {
  pending:    'warning',
  scheduled:  'info',
  assigned:   'info',
  'in-transit':'brand',
  in_transit: 'brand',
  delivered:  'success',
  invoice_sent_pending: 'warning',
  ready_to_invoice: 'warning',
  invoice_sent: 'info',
  paid:       'success',
  cancelled:  'danger',
  archived:   'neutral',
}

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  invoice_sent_pending: 'Invoice Pending',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

const ORDER_STATUS_ICON: Record<OrderStatus, LucideIcon> = {
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

const ORDER_STATUS_ICON_COLOR: Record<OrderStatus, string> = {
  pending: '#92400e',
  scheduled: '#1e40af',
  assigned: '#3730a3',
  'in-transit': '#9d174d',
  in_transit: '#9d174d',
  delivered: '#065f46',
  invoice_sent_pending: '#FF6A00',
  ready_to_invoice: '#FF6A00',
  invoice_sent: '#0066FF',
  paid: '#065f46',
  cancelled: '#6b7280',
  archived: '#6b7280',
}

function getOrderStatusLabel(order: Order): string {
  if (order.status === 'delivered' && order.deliveryStatus === 'signed') {
    return 'Delivered / Signed'
  }
  return ORDER_STATUS_LABEL[order.status]
}

function renderOrderStatus(order: Order) {
  const Icon = ORDER_STATUS_ICON[order.status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={12} aria-hidden="true" style={{ color: ORDER_STATUS_ICON_COLOR[order.status] }} />
      <span>{getOrderStatusLabel(order)}</span>
    </span>
  )
}

function getFileDisplayName(file: AppFile): string {
  const kind = file.metadata?.documentKind
  if (kind === 'terms-acceptance') {
    return `Terms & Conditions — Accepted ${formatDate(file.createdAt)}`
  }
  if (kind === 'delivery-receipt') {
    return `Delivery Receipt — ${formatDate(file.createdAt)}`
  }
  return file.fileName
}

// ── Role meta ─────────────────────────────────────────────────────────────────

const CUSTOMER_ROLES: UserRole[] = ['owner', 'manager', 'billing', 'delivery', 'viewer']

const ROLE_LABELS: Record<UserRole, string> = {
  admin:    'Admin',
  dispatch: 'Dispatch',
  driver:   'Driver',
  sales:    'Sales',
  customer: 'Customer',
  owner:    'Owner',
  manager:  'Manager',
  billing:  'Billing',
  delivery: 'Delivery',
  viewer:   'Viewer',
}

const ROLE_DESCRIPTIONS: Partial<Record<UserRole, string>> = {
  owner:    'Full account control — can manage users, place orders, view invoices',
  manager:  'Can place orders and view all account activity',
  billing:  'Can view and pay invoices; no ordering access',
  delivery: 'Can view delivery schedules and tank levels',
  viewer:   'Read-only access to account info',
  customer: 'Legacy access level — consider upgrading to a specific role',
}

const ROLE_BADGE_CLASS: Partial<Record<UserRole, string>> = {
  owner:    'cr-access-role--owner',
  manager:  'cr-access-role--manager',
  billing:  'cr-access-role--billing',
  delivery: 'cr-access-role--delivery',
  viewer:   'cr-access-role--viewer',
  customer: 'cr-access-role--customer',
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Animated fill bar for tank level. */
const TankLevelBar: React.FC<{ pct: number | undefined; gasType: string; sizeLabel: string }> = ({
  pct,
  gasType,
  sizeLabel,
}) => {
  const level = pct ?? 0
  const isLow = level <= 20
  return (
    <div className="cr-tank-bar">
      <div className={`cr-tank-bar__fill cr-tank-bar__fill--${isLow ? 'low' : 'ok'}`} style={{ width: `${level}%` }} />
      <span className="cr-tank-bar__label">
        {pct !== undefined ? `${level}%` : '—'}
        {' · '}
        {gasType} · {sizeLabel}
      </span>
    </div>
  )
}

// ── Edit Customer Modal ───────────────────────────────────────────────────────

interface EditCustomerModalProps {
  customer: CustomerRecord
  onClose: () => void
  onSave: (data: Partial<CustomerRecord>) => Promise<void>
  saving: boolean
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  actionLoading: boolean
  actionError: string | null
}

const EditCustomerModal: React.FC<EditCustomerModalProps> = ({ customer, onClose, onSave, saving, onArchive, onDelete, onRestore, actionLoading, actionError }) => {
  const [form, setForm] = useState({
    name:        customer.name,
    email:       customer.email,
    phone:       customer.phone,
    address:     customer.address,
    city:        customer.city,
    state:       customer.state,
    zip:         customer.zip,
    status:      customer.status,
    creditLimit: String(customer.creditLimit ?? ''),
  })

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({
      name:        form.name.trim(),
      email:       form.email.trim(),
      phone:       form.phone.trim(),
      address:     form.address.trim(),
      city:        form.city.trim(),
      state:       form.state.trim(),
      zip:         form.zip.trim(),
      status:      form.status as CustomerStatus,
      creditLimit: Number(form.creditLimit) || 0,
    })
  }

  return (
    <Modal open onClose={onClose} title="Edit Customer" size="lg">
      <form className="cr-modal-form" onSubmit={handleSubmit}>
        <div className="cr-form-row">
          <Input label="Full name"  value={form.name}    onChange={set('name')}    required />
          <Input label="Email"      value={form.email}   onChange={set('email')}   type="email" required />
        </div>
        <div className="cr-form-row">
          <Input label="Phone"      value={form.phone}   onChange={set('phone')}   type="tel" required />
          <div className="ui-field">
            <label className="ui-field__label">Status</label>
            <select className="ui-input" value={form.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="hold">On Hold</option>
            </select>
          </div>
        </div>
        <Input label="Street address" value={form.address} onChange={set('address')} required />
        <div className="cr-form-row cr-form-row--three">
          <Input label="City"  value={form.city}  onChange={set('city')}  required />
          <Input label="State" value={form.state} onChange={set('state')} required />
          <Input label="ZIP"   value={form.zip}   onChange={set('zip')}   required />
        </div>
        <Input
          label="Credit limit ($)"
          value={form.creditLimit}
          onChange={set('creditLimit')}
          type="number"
          min="0"
          step="100"
        />
        <div className="cr-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving || actionLoading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={actionLoading}>
            Save changes
          </Button>
        </div>

        {/* ── Danger zone ── */}
        {customer.status !== 'deleted' && (
          <div className="cr-modal-danger">
            <p className="cr-modal-danger__label">Danger zone</p>
            <div className="cr-modal-danger__actions">
              {customer.status === 'archived' ? (
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  loading={actionLoading}
                  onClick={onRestore}
                >
                  Restore customer
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={actionLoading}
                  onClick={onArchive}
                >
                  Archive customer
                </Button>
              )}
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={actionLoading}
                onClick={onDelete}
              >
                Delete customer
              </Button>
            </div>
            {actionError && <p className="cr-form-error" style={{ marginTop: 6 }}>{actionError}</p>}
          </div>
        )}
      </form>
    </Modal>
  )
}

// ── Create Invoice Modal ──────────────────────────────────────────────────────

interface InvoiceLineRow {
  productId:   string   // '' = custom / manual
  description: string
  quantity:    string
  unitPrice:   string
  unit:        string
}

const EMPTY_ROW: InvoiceLineRow = { productId: '', description: '', quantity: '1', unitPrice: '', unit: '' }

interface CreateInvoiceModalProps {
  mode: 'create' | 'edit'
  initialInvoice?: Invoice | null
  onClose:  () => void
  onSubmit: (
    lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[],
    invoiceDate: string,
    dueDate:   string,
    serviceDate: string,
    notes:     string,
    terms:     string,
    applySalesTax: boolean,
    salesTaxRatePercent: number,
    paymentTermsDays?: number,
    customerContactName?: string,
    customerContactEmail?: string,
  ) => Promise<void>
  saving: boolean
}

const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  mode,
  initialInvoice,
  onClose,
  onSubmit,
  saving,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10)
  const fallbackDueDate = new Date()
  fallbackDueDate.setDate(fallbackDueDate.getDate() + 30)
  const invoiceDateDefault = initialInvoice?.issuedAt?.toDate?.().toISOString().slice(0, 10) ?? todayIso
  const dueDefault = initialInvoice?.dueAt?.toDate?.().toISOString().slice(0, 10)
    ?? fallbackDueDate.toISOString().slice(0, 10)
  const serviceDateDefault = initialInvoice?.serviceDate?.toDate?.().toISOString().slice(0, 10) ?? ''
  const initialRows = initialInvoice?.lineItems?.length
    ? initialInvoice.lineItems.map((item) => ({
        ...EMPTY_ROW,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      }))
    : [{ ...EMPTY_ROW }]

  const [rows, setRows]       = useState<InvoiceLineRow[]>(initialRows)
  const [invoiceDate, setInvoiceDate] = useState(invoiceDateDefault)
  const [dueDate, setDueDate] = useState(dueDefault)
  const [serviceDate, setServiceDate] = useState(serviceDateDefault)
  const [notes, setNotes]     = useState(initialInvoice?.notes ?? '')
  const [terms, setTerms]     = useState(initialInvoice?.terms ?? '')
  const [applySalesTax, setApplySalesTax] = useState(
    initialInvoice?.applySalesTax
      ?? ((initialInvoice?.salesTaxRate ?? initialInvoice?.taxRate ?? 0) > 0 || (initialInvoice?.salesTaxAmount ?? initialInvoice?.tax ?? 0) > 0),
  )
  const [salesTaxRatePercent, setSalesTaxRatePercent] = useState(
    String((((initialInvoice?.salesTaxRate ?? initialInvoice?.taxRate) ?? 0) * 100).toFixed(2)),
  )
  const [paymentTermsDays, setPaymentTermsDays] = useState(initialInvoice?.paymentTermsDays ? String(initialInvoice.paymentTermsDays) : '')
  const [customerContactName, setCustomerContactName] = useState(initialInvoice?.customerContactName ?? '')
  const [customerContactEmail, setCustomerContactEmail] = useState(initialInvoice?.customerContactEmail ?? '')
  const [formError, setFormError] = useState('')
  const [products, setProducts]   = useState<ProductDropdownItem[]>([])

  // Load product catalog once on mount
  React.useEffect(() => {
    getProductDropdown().then(setProducts).catch(() => {/* non-blocking */})
  }, [])

  React.useEffect(() => {
    if (initialInvoice) return
    let cancelled = false
    getCompanySettings()
      .then((settings) => {
        if (cancelled) return
        const configuredRate = Number(settings.defaultSalesTaxRate ?? 0)
        if (!Number.isFinite(configuredRate) || configuredRate <= 0) {
          setApplySalesTax(false)
          return
        }
        setApplySalesTax(true)
        setSalesTaxRatePercent(configuredRate.toFixed(2))
      })
      .catch(() => {
        // Non-blocking: leave UI defaults intact when settings fetch fails.
      })
    return () => { cancelled = true }
  }, [initialInvoice])

  // Group products by category for <optgroup>
  const productsByCategory = React.useMemo(() => {
    const map = new Map<string, ProductDropdownItem[]>()
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, [])
      map.get(p.category)!.push(p)
    }
    return map
  }, [products])

  // Add-ons: products from Fees / Rentals category
  const addOns = React.useMemo(
    () => products.filter(p => p.category === 'Fees' || p.category === 'Rentals'),
    [products],
  )

  const deliveryFeeProduct = React.useMemo(
    () => products.find((p) => p.category === 'Fees' && /delivery/i.test(p.name)),
    [products],
  )

  // Track which add-on IDs are already in the line items
  const addedAddOnIds = new Set(rows.map(r => r.productId))

  const handleProductSelect = (i: number, productId: string) => {
    if (!productId) {
      setRows(prev => prev.map((r, idx) => idx === i ? { ...EMPTY_ROW } : r))
      return
    }
    const product = products.find(p => p.id === productId)
    if (!product) return
    setRows(prev => prev.map((r, idx) =>
      idx === i
        ? {
            productId,
            description: product.name,
            quantity:    '1',
            unitPrice:   String(product.basePrice),
            unit:        product.unit,
          }
        : r,
    ))
  }

  const setRowField = (i: number, field: keyof Omit<InvoiceLineRow, 'productId'>) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: e.target.value } : r))

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }])
  const removeRow = (i: number) => setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)

  const addAddOn = (addOn: ProductDropdownItem) => {
    setRows(prev => [
      ...prev,
      {
        productId:   addOn.id,
        description: addOn.name,
        quantity:    '1',
        unitPrice:   String(addOn.basePrice),
        unit:        addOn.unit,
      },
    ])
  }

  const addDeliveryFee = () => {
    if (deliveryFeeProduct) {
      addAddOn(deliveryFeeProduct)
      return
    }
    setRows(prev => [
      ...prev,
      {
        productId: '',
        description: 'Delivery Fee',
        quantity: '1',
        unitPrice: '',
        unit: '',
      },
    ])
  }

  const lineItems = rows.map(r => {
    const qty   = parseFloat(r.quantity)  || 0
    const price = parseFloat(r.unitPrice) || 0
    return {
      description: r.description.trim(),
      quantity:    qty,
      unitPrice:   price,
      amount:      parseFloat((qty * price).toFixed(2)),
    }
  })
  const deliveryFeeTotal = lineItems.reduce(
    (sum, li) => /delivery\s*fee/i.test(li.description) ? sum + li.amount : sum,
    0,
  )
  const hasDeliveryFeeLine = lineItems.some((li) => /delivery\s*fee/i.test(li.description))
  const lineSubtotal = lineItems.reduce(
    (sum, li) => /delivery\s*fee/i.test(li.description) ? sum : sum + li.amount,
    0,
  )
  const subtotal = lineSubtotal + deliveryFeeTotal
  const parsedSalesTaxRatePercent = Number.parseFloat(salesTaxRatePercent)
  const safeSalesTaxRatePercent = Number.isFinite(parsedSalesTaxRatePercent) ? parsedSalesTaxRatePercent : 0
  const taxAmount = applySalesTax ? subtotal * (safeSalesTaxRatePercent / 100) : 0
  const total = subtotal + taxAmount

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (lineItems.some(li => !li.description)) { setFormError('All line items need a description.'); return }
    if (safeSalesTaxRatePercent < 0) { setFormError('Sales tax rate cannot be negative.'); return }
    if (!invoiceDate) { setFormError('Invoice date is required.'); return }
    if (!dueDate) { setFormError('Due date is required.'); return }
    const parsedTermsDays = paymentTermsDays.trim() ? Number.parseInt(paymentTermsDays, 10) : undefined
    if (parsedTermsDays !== undefined && (!Number.isFinite(parsedTermsDays) || parsedTermsDays < 0)) {
      setFormError('Payment terms must be a non-negative number of days.')
      return
    }
    await onSubmit(
      lineItems,
      invoiceDate,
      dueDate,
      serviceDate,
      notes,
      terms,
      applySalesTax,
      safeSalesTaxRatePercent,
      parsedTermsDays,
      customerContactName.trim() || undefined,
      customerContactEmail.trim() || undefined,
    )
  }

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? 'Edit draft invoice' : 'Create invoice'} size="lg">
      <form className="cr-modal-form" onSubmit={handleSubmit}>
        {formError && <p className="cr-form-error">{formError}</p>}

        {/* ── Line items ── */}
        <div className="cr-inv-header-row">
          <span className="cr-inv-col-product">Product</span>
          <span className="cr-inv-col-desc">Description</span>
          <span className="cr-inv-col-qty">Qty</span>
          <span className="cr-inv-col-price">Unit price</span>
          <span className="cr-inv-col-amount">Amount</span>
          <span style={{ width: 28 }} />
        </div>

        {rows.map((row, i) => {
          const rowTotal = (parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0)
          return (
            <div key={i} className="cr-inv-line-row">
              {/* Product picker */}
              <select
                className="ui-input cr-inv-col-product"
                value={row.productId}
                onChange={e => handleProductSelect(i, e.target.value)}
              >
                <option value="">— Custom —</option>
                {Array.from(productsByCategory.entries()).map(([cat, prods]) => (
                  <optgroup key={cat} label={cat}>
                    {prods.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit}) — ${p.basePrice.toFixed(2)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Description (editable even when product selected) */}
              <input
                className="ui-input cr-inv-col-desc"
                placeholder="Description"
                value={row.description}
                onChange={setRowField(i, 'description')}
                required
              />

              {/* Qty */}
              <input
                className="ui-input cr-inv-col-qty"
                type="number"
                min="0"
                step="0.01"
                placeholder="1"
                value={row.quantity}
                onChange={setRowField(i, 'quantity')}
                required
              />

              {/* Unit price */}
              <input
                className="ui-input cr-inv-col-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="$0.00"
                value={row.unitPrice}
                onChange={setRowField(i, 'unitPrice')}
                required
              />

              {/* Amount */}
              <span className="cr-inv-col-amount cr-inv-line-amount">
                ${rowTotal.toFixed(2)}
              </span>

              <button
                type="button"
                className="cr-inv-remove-btn"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                title="Remove line"
              >✕</button>
            </div>
          )
        })}

        <button type="button" className="cr-link cr-inv-add-line" onClick={addRow}>
          + Add line item
        </button>

        {/* ── Add-ons (fees & rentals) ── */}
        {addOns.length > 0 && (
          <div className="cr-inv-addons">
            <p className="cr-inv-addons__label">Quick add-ons:</p>
            <div className="cr-inv-addons__chips">
              <button
                type="button"
                className={`cr-inv-addon-chip${hasDeliveryFeeLine ? ' cr-inv-addon-chip--added' : ''}`}
                onClick={() => !hasDeliveryFeeLine && addDeliveryFee()}
                disabled={hasDeliveryFeeLine}
                title={deliveryFeeProduct ? `$${deliveryFeeProduct.basePrice.toFixed(2)} / ${deliveryFeeProduct.unit}` : 'Add custom delivery fee line item'}
              >
                {hasDeliveryFeeLine ? '✓ ' : '+ '}Delivery Fee
                {deliveryFeeProduct && (
                  <span className="cr-inv-addon-chip__price">${deliveryFeeProduct.basePrice.toFixed(2)}</span>
                )}
              </button>
              {addOns.map(a => (
                <button
                  key={a.id}
                  type="button"
                  className={`cr-inv-addon-chip${addedAddOnIds.has(a.id) ? ' cr-inv-addon-chip--added' : ''}`}
                  onClick={() => !addedAddOnIds.has(a.id) && addAddOn(a)}
                  disabled={addedAddOnIds.has(a.id)}
                  title={`$${a.basePrice.toFixed(2)} / ${a.unit}`}
                >
                  {addedAddOnIds.has(a.id) ? '✓ ' : '+ '}{a.name}
                  <span className="cr-inv-addon-chip__price">${a.basePrice.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Totals ── */}
        <div className="cr-inv-total-row">
          <strong>
            Line Subtotal: ${lineSubtotal.toFixed(2)} · Delivery Fee: ${deliveryFeeTotal.toFixed(2)} · {applySalesTax ? 'Sales Tax' : 'Sales Tax Omitted'}: ${(applySalesTax ? taxAmount : 0).toFixed(2)} · Total: ${total.toFixed(2)}
          </strong>
        </div>

        <div className="cr-form-row">
          <div className="ui-field">
            <label className="ui-field__label">Sales tax</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="sales-tax-choice"
                  checked={applySalesTax}
                  onChange={() => setApplySalesTax(true)}
                />
                Apply sales tax
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="sales-tax-choice"
                  checked={!applySalesTax}
                  onChange={() => setApplySalesTax(false)}
                />
                No sales tax
              </label>
            </div>
          </div>
        </div>

        <div className="cr-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="Sales tax rate (%)"
            type="number"
            min="0"
            step="0.01"
            value={salesTaxRatePercent}
            onChange={e => setSalesTaxRatePercent(e.target.value)}
            disabled={!applySalesTax}
          />
          <Input
            label="Payment terms (days)"
            type="number"
            min="0"
            step="1"
            value={paymentTermsDays}
            onChange={e => setPaymentTermsDays(e.target.value)}
            placeholder="e.g. 30"
          />
        </div>
        {!applySalesTax && (
          <p style={{ marginTop: -4, marginBottom: 4, color: 'var(--color-text-3)' }}>Sales tax omitted.</p>
        )}

        {/* ── Invoice dates ── */}
        <div className="cr-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Input label="Invoice date" type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} required />
          <Input label="Due date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
          <Input
            label="Service date (optional)"
            type="date"
            value={serviceDate}
            onChange={e => setServiceDate(e.target.value)}
          />
        </div>

        <div className="cr-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="Customer contact"
            value={customerContactName}
            onChange={e => setCustomerContactName(e.target.value)}
            placeholder="Optional"
          />
          <Input
            label="Contact email"
            type="email"
            value={customerContactEmail}
            onChange={e => setCustomerContactEmail(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div className="ui-field">
          <label className="ui-field__label">Terms (optional)</label>
          <textarea
            className="ui-input cr-textarea"
            rows={2}
            value={terms}
            onChange={e => setTerms(e.target.value)}
            placeholder="Net terms, late fees, or invoice conditions…"
          />
        </div>

        {/* ── Notes ── */}
        <div className="ui-field">
          <label className="ui-field__label">Notes (optional)</label>
          <textarea
            className="ui-input cr-textarea"
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Billing memo, service summary, or customer-facing notes…"
          />
        </div>

        <div className="cr-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {mode === 'edit' ? 'Save Draft Changes' : 'Create invoice'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Log Interaction Modal ─────────────────────────────────────────────────────

interface LogInteractionForm {
  method:       ContactMethod
  contactedAt:  string
  summary:      string
  followUpAt:   string
}

interface LogInteractionModalProps {
  onClose:  () => void
  onSubmit: (form: LogInteractionForm) => Promise<void>
  saving:   boolean
}

const LogInteractionModal: React.FC<LogInteractionModalProps> = ({ onClose, onSubmit, saving }) => {
  const todayIso = new Date().toISOString().slice(0, 16)
  const [form, setForm] = useState<LogInteractionForm>({
    method:      'call',
    contactedAt: todayIso,
    summary:     '',
    followUpAt:  '',
  })

  const set = (field: keyof LogInteractionForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(form)
  }

  return (
    <Modal open onClose={onClose} title="Log interaction" size="md">
      <form className="cr-modal-form" onSubmit={handleSubmit}>
        <div className="ui-field">
          <label className="ui-field__label">Contact type</label>
          <select className="ui-input" value={form.method} onChange={set('method')}>
            {(Object.keys(METHOD_LABELS) as ContactMethod[]).map(m => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <Input
          label="Date &amp; time"
          type="datetime-local"
          value={form.contactedAt}
          onChange={set('contactedAt')}
          required
        />
        <div className="ui-field">
          <label className="ui-field__label">Notes / summary</label>
          <textarea
            className="ui-input cr-textarea"
            rows={4}
            value={form.summary}
            onChange={set('summary')}
            placeholder="What was discussed?"
            required
          />
        </div>
        <Input
          label="Next follow-up (optional)"
          type="datetime-local"
          value={form.followUpAt}
          onChange={set('followUpAt')}
        />
        <div className="cr-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Log interaction
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── UserAccessTab ─────────────────────────────────────────────────────────────

interface UserAccessTabProps {
  companyId: string
  customer:  Customer
  users:     AppUser[]
  loading:   boolean
  onRefresh: () => void
}

const UserAccessTab: React.FC<UserAccessTabProps> = ({ customer, users, loading, onRefresh }) => {
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [pendingRole, setPendingRole] = useState<UserRole>('viewer')
  const [saving,      setSaving]      = useState(false)
  const [flash,       setFlash]       = useState<{ id: string; msg: string } | null>(null)
  const [addingUser,  setAddingUser]  = useState(false)

  const showFlash = (id: string, msg: string) => {
    setFlash({ id, msg })
    setTimeout(() => setFlash(null), 3000)
  }

  const handleEditRole = (user: AppUser) => {
    setEditingId(user.id)
    setPendingRole(user.role as UserRole)
  }

  const handleSaveRole = async (user: AppUser) => {
    setSaving(true)
    try {
      await assignUserRole(user.id, pendingRole)
      setEditingId(null)
      onRefresh()
      showFlash(user.id, 'Role updated')
    } catch (err: unknown) {
      showFlash(user.id, err instanceof Error ? err.message : 'Failed to update role')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (user: AppUser) => {
    setSaving(true)
    try {
      if (user.active) {
        await deactivateUser(user.id)
        showFlash(user.id, 'User deactivated')
      } else {
        await reactivateUser(user.id)
        showFlash(user.id, 'User reactivated')
      }
      onRefresh()
    } catch (err: unknown) {
      showFlash(user.id, err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordReset = async (user: AppUser) => {
    try {
      await sendPasswordReset(user.email)
      showFlash(user.id, 'Password reset email sent')
    } catch (err: unknown) {
      showFlash(user.id, err instanceof Error ? err.message : 'Failed to send reset email')
    }
  }

  if (loading) {
    return <div className="cr-skeleton cr-skeleton--list" />
  }

  return (
    <div className="cr-access">
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="cr-access__header">
        <p className="cr-access__header-title">Portal Users</p>
        <Button variant="primary" size="sm" onClick={() => setAddingUser(true)}>
          + Add User
        </Button>
      </div>

      <div className="cr-access__legend">
        {CUSTOMER_ROLES.map(r => (
          <div key={r} className="cr-access__legend-item">
            <span className={`cr-access-role cr-access-role--sm ${ROLE_BADGE_CLASS[r] ?? ''}`}>
              {ROLE_LABELS[r]}
            </span>
            <span className="cr-access__legend-desc">{ROLE_DESCRIPTIONS[r]}</span>
          </div>
        ))}
      </div>

      {users.length === 0 ? (
        <Card>
          <CardBody>
            <p className="cr-empty">No portal users linked to this account yet. Use "+ Add User" to grant access.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="cr-access__cards">
          {users.map(user => {
            const isEditing = editingId === user.id
            const flashMsg  = flash?.id === user.id ? flash.msg : null
            return (
              <div
                key={user.id}
                className={`cr-access-card${!user.active ? ' cr-access-card--inactive' : ''}`}
              >
                <div className="cr-access-card__avatar">
                  {(user.name || user.email || '?').charAt(0).toUpperCase()}
                </div>

                <div className="cr-access-card__body">
                  <div className="cr-access-card__name-row">
                    <span className="cr-access-card__name">{user.name || '—'}</span>
                    {!user.active && (
                      <span className="cr-access-card__inactive-tag">Inactive</span>
                    )}
                    {flashMsg && (
                      <span className="cr-access-card__flash">{flashMsg}</span>
                    )}
                  </div>
                  <span className="cr-access-card__email">{user.email}</span>

                  <div className="cr-access-card__role-row">
                    {isEditing ? (
                      <>
                        <select
                          className="ui-input cr-access-card__role-select"
                          value={pendingRole}
                          onChange={e => setPendingRole(e.target.value as UserRole)}
                          disabled={saving}
                        >
                          {CUSTOMER_ROLES.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                        <button
                          className="cr-access-card__action cr-access-card__action--primary"
                          onClick={() => void handleSaveRole(user)}
                          disabled={saving}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="cr-access-card__action"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={`cr-access-role ${ROLE_BADGE_CLASS[user.role as UserRole] ?? 'cr-access-role--viewer'}`}>
                          {ROLE_LABELS[user.role as UserRole] ?? user.role}
                        </span>
                        {ROLE_DESCRIPTIONS[user.role as UserRole] && (
                          <span className="cr-access-card__role-desc">
                            {ROLE_DESCRIPTIONS[user.role as UserRole]}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {!isEditing && (
                  <div className="cr-access-card__actions">
                    <button
                      className="cr-access-card__action"
                      onClick={() => handleEditRole(user)}
                      title="Change role"
                    >
                      Change role
                    </button>
                    <button
                      className="cr-access-card__action"
                      onClick={() => void handlePasswordReset(user)}
                      title="Send password reset email"
                    >
                      Reset password
                    </button>
                    <button
                      className={`cr-access-card__action${user.active ? ' cr-access-card__action--warn' : ' cr-access-card__action--primary'}`}
                      onClick={() => void handleToggleActive(user)}
                      disabled={saving}
                      title={user.active ? 'Deactivate this user' : 'Reactivate this user'}
                    >
                      {user.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add user modal */}
      {addingUser && (
        <CreateUserModal
          allowedRoles={CUSTOMER_ROLES}
          preselectedCustomer={customer}
          onClose={() => setAddingUser(false)}
          onCreated={() => { setAddingUser(false); onRefresh() }}
        />
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const CustomerRecord: React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate       = useNavigate()
  const location       = useLocation()
  const crmBase        = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'
  const queryClient    = useQueryClient()
  const { user }       = useAuth()

  const [activeTab,     setActiveTab]     = useState<TabKey>('overview')
  const [showEdit,          setShowEdit]          = useState(false)
  const [showLogModal,      setShowLogModal]      = useState(false)
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [editingDraftInvoice, setEditingDraftInvoice] = useState<Invoice | null>(null)
  const [invoiceError,      setInvoiceError]      = useState<string | null>(null)
  const [invoiceSuccess,    setInvoiceSuccess]    = useState<string | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(false)
  const [custActionLoading,  setCustActionLoading]  = useState(false)
  const [custActionError,    setCustActionError]    = useState<string | null>(null)

  // Notes tab local state (mirrors customer doc, saved on blur)
  const [notes,             setNotes]             = useState('')
  const [deliveryNotes,     setDeliveryNotes]     = useState('')
  const [accessInstructions,setAccessInstructions]= useState('')
  const [creditLimit,       setCreditLimit]       = useState('')
  const [holdReason,        setHoldReason]        = useState('')
  const [onHold,            setOnHold]            = useState(false)
  const [notesSaved,        setNotesSaved]        = useState(false)
  const notesInitialised = useRef(false)

  // File upload progress
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Product Pricing tab — inline editing state (productId → input string)
  const [pricingEditMap, setPricingEditMap] = useState<Map<string, string>>(new Map())

  // Standing Order tab — local form state
  const CADENCE_OPTS: { value: RouteCadence; label: string }[] = [
    { value: 'weekly',   label: 'Weekly'   },
    { value: 'biweekly', label: 'Biweekly' },
    { value: 'monthly',  label: 'Monthly'  },
    { value: 'custom',   label: 'Custom'   },
  ]
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

  type SOLineItem = { productId: string; qty: number; unitPrice: number }
  const [soForm, setSoForm] = useState<{
    isActive: boolean
    cadence: RouteCadence
    customIntervalDays: number
    dayOfWeek: number
    nextDeliveryDate: string
    lineItems: SOLineItem[]
    notes: string
  }>({
    isActive: true,
    cadence: 'weekly',
    customIntervalDays: 7,
    dayOfWeek: 1,
    nextDeliveryDate: '',
    lineItems: [],
    notes: '',
  })
  const [soInitialised, setSoInitialised] = useState(false)
  const [soSaved, setSoSaved] = useState(false)
  const [soError, setSoError] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const {
    data: customer,
    isLoading: customerLoading,
    error: customerError,
  } = useCustomer(customerId, {
    select: (c) => c as CustomerRecord,
  })

  // Sync local notes state once on first load
  React.useEffect(() => {
    if (!customer || notesInitialised.current) return
    notesInitialised.current = true
    const cr = customer as CustomerRecord
    setNotes(cr.notes ?? '')
    setDeliveryNotes(cr.deliveryNotes ?? '')
    setAccessInstructions(cr.accessInstructions ?? '')
    setCreditLimit(String(cr.creditLimit ?? ''))
    setHoldReason(cr.holdReason ?? '')
    setOnHold(cr.status === 'hold')
  }, [customer])

  // Real-time tanks (live level updates)
  const { tanks, loading: tanksLoading } = useCustomerTanks(customerId)
  const activeTanks = tanks.filter(t => t.status === 'deployed')

  // Recent orders (last 5)
  const { data: ordersPage } = useCustomerOrders(customerId, 5)
  const recentOrders = ordersPage?.data ?? []
  const recentOrderIds = useMemo(
    () => new Set(recentOrders.map((order) => order.id)),
    [recentOrders],
  )

  // Recent invoices (last 5)
  const { data: invoicesPage } = useCustomerInvoices(customerId, 5)
  const recentInvoices: Invoice[] = useMemo(
    () => (invoicesPage?.data ?? [])
      .filter((inv) => inv.status !== 'void' && !!inv.orderId && recentOrderIds.has(inv.orderId))
      .slice(0, 5),
    [invoicesPage?.data, recentOrderIds],
  )

  const { data: quotesPage } = useQuery({
    queryKey: ['quotes', 'customer', customerId],
    queryFn: () => getQuotes({ customerId: customerId! }, { pageSize: 100 }),
    enabled: !!customerId && (activeTab === 'overview' || activeTab === 'orderHistory'),
    staleTime: 60_000,
  })
  const recentQuotes: Quote[] = useMemo(
    () => (quotesPage?.data ?? [])
      .filter((quote) => {
        const linkedOrderIds = [
          quote.convertedOrderId,
          ...(quote.convertedOrderIds ?? []),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0)
        return linkedOrderIds.some((id) => recentOrderIds.has(id))
      })
      .slice(0, 5),
    [quotesPage?.data, recentOrderIds],
  )

  // Outstanding balance — fetch all sent + overdue
  const { data: outstandingInvoices } = useQuery({
    queryKey: ['invoices', 'outstanding', customerId],
    queryFn: async () => {
      const [sent, overdue] = await Promise.all([
        getInvoices({ customerId: customerId!, status: 'sent'   }, { pageSize: 200 }),
        getInvoices({ customerId: customerId!, status: 'overdue' }, { pageSize: 200 }),
      ])
      return [...(sent.data ?? []), ...(overdue.data ?? [])]
    },
    enabled: !!customerId,
    staleTime: 60_000,
  })
  const outstandingBalance = outstandingInvoices?.reduce((s, inv) => s + inv.total, 0) ?? 0

  // Contact logs (fetched when history tab active)
  const { data: contactLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['contactLogs', customerId],
    queryFn: async () => {
      const snap = await getDocs(
        fsQuery(
          collection(db, 'contactLogs'),
          where('entityType', '==', 'customer'),
          where('entityId',   '==', customerId),
          fsOrderBy('contactedAt', 'desc'),
        ),
      )
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContactLogWithFollowUp)
    },
    enabled: !!customerId && activeTab === 'history',
    staleTime: 60_000,
  })

  const { data: orderHistoryPage } = useQuery({
    queryKey: ['orders', 'history', customerId],
    queryFn: () => getOrders({ customerId: customerId! }, { pageSize: 100 }),
    enabled: !!customerId && activeTab === 'orderHistory',
    staleTime: 60_000,
  })
  const orderHistoryOrders = orderHistoryPage?.data ?? []
  const orderHistoryOrderIds = useMemo(
    () => new Set(orderHistoryOrders.map((order) => order.id)),
    [orderHistoryOrders],
  )
  const orderHistoryQuotes: Quote[] = useMemo(
    () => (quotesPage?.data ?? []).filter((quote) => {
      const linkedOrderIds = [
        quote.convertedOrderId,
        ...(quote.convertedOrderIds ?? []),
      ].filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (linkedOrderIds.length === 0) return false
      return linkedOrderIds.some((id) => orderHistoryOrderIds.has(id))
    }),
    [quotesPage?.data, orderHistoryOrderIds],
  )
  const canManageQuotes = user?.role === 'admin' || user?.role === 'sales'

  const { data: invoiceHistoryPage } = useQuery({
    queryKey: ['invoices', 'history', customerId],
    queryFn: () => getInvoices({ customerId: customerId! }, { pageSize: 100 }),
    enabled: !!customerId && activeTab === 'orderHistory',
    staleTime: 60_000,
  })
  const orderHistoryInvoices: Invoice[] = useMemo(
    () => (invoiceHistoryPage?.data ?? [])
      .filter((invoice) => invoice.status !== 'void' && !!invoice.orderId && orderHistoryOrderIds.has(invoice.orderId)),
    [invoiceHistoryPage?.data, orderHistoryOrderIds],
  )

  const openDraftEditor = useCallback((invoice: Invoice) => {
    if (invoice.status !== 'draft') return
    setInvoiceError(null)
    setInvoiceSuccess(null)
    setEditingDraftInvoice(invoice)
    setShowCreateInvoice(true)
  }, [])

  React.useEffect(() => {
    const params = new URLSearchParams(location.search)
    const editDraftId = params.get('editDraft')
    const tabParam = params.get('tab')
    if (tabParam && TABS.some((t) => t.key === tabParam)) {
      setActiveTab(tabParam as TabKey)
    }
    if (!editDraftId || !customerId) return

    let cancelled = false
    void getInvoice(editDraftId)
      .then((invoice) => {
        if (cancelled) return
        if (invoice.customerId !== customerId || invoice.status !== 'draft') {
          setInvoiceError('Draft invoice not found for this customer.')
          return
        }
        openDraftEditor(invoice)
      })
      .catch(() => {
        if (!cancelled) setInvoiceError('Unable to load draft invoice for editing.')
      })
      .finally(() => {
        if (cancelled) return
        params.delete('editDraft')
        navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true })
      })

    return () => { cancelled = true }
  }, [customerId, location.pathname, location.search, navigate, openDraftEditor])

  // Customer files (fetched when documents tab active)
  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ['files', 'customer', customerId],
    queryFn: () => getFilesForEntity('customer', customerId!),
    enabled: !!customerId && (activeTab === 'documents' || activeTab === 'orderHistory'),
    staleTime: 60_000,
  })

  // Company users (fetched when access tab active)
  const { data: companyUsers = [], isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['users', 'company', customerId],
    queryFn: () => getUsersByCompany(customerId!),
    enabled: !!customerId && activeTab === 'access',
    staleTime: 30_000,
  })

  // Customer product pricing (fetched when pricing tab active)
  const {
    entries: customerPricingEntries,
    isLoading: pricingLoading,
  } = useCustomerProductPricing(activeTab === 'productPricing' ? customerId : null)

  // All visible products for pricing tab
  const { data: allProducts = [], isLoading: allProductsLoading } = useQuery({
    queryKey: ['visible-products'],
    queryFn: getVisibleProducts,
    enabled: activeTab === 'productPricing',
    staleTime: 10 * 60_000,
  })

  // Route schedule (fetched when standing order tab active)
  const { data: routeSchedule, isLoading: scheduleLoading } = useQuery<RouteSchedule | null>({
    queryKey: ['route-schedule', customerId],
    queryFn: () => getRouteSchedule(customerId!),
    enabled: !!customerId && activeTab === 'standingOrder',
    staleTime: 30_000,
  })

  // Products for standing order tab (all non-Fee products)
  const { data: soProducts = [], isLoading: soProductsLoading } = useQuery({
    queryKey: ['visible-products'],
    queryFn: getVisibleProducts,
    enabled: activeTab === 'standingOrder',
    staleTime: 10 * 60_000,
  })

  // Customer pricing for pre-filling unit prices in standing order
  const { entries: soPricingEntries } = useCustomerProductPricing(
    activeTab === 'standingOrder' ? customerId : null,
  )

  // Initialise standing order form once schedule loads
  React.useEffect(() => {
    if (soInitialised || scheduleLoading) return
    if (routeSchedule) {
      setSoInitialised(true)
      const nd = routeSchedule.nextDeliveryDate as unknown as { toDate?: () => Date }
      const ndDate = typeof nd?.toDate === 'function' ? nd.toDate() : new Date()
      setSoForm({
        isActive:           routeSchedule.isActive,
        cadence:            routeSchedule.cadence,
        customIntervalDays: routeSchedule.customIntervalDays ?? 7,
        dayOfWeek:          routeSchedule.dayOfWeek ?? 1,
        nextDeliveryDate:   ndDate.toISOString().slice(0, 10),
        lineItems:          routeSchedule.lineItems.map((li) => ({ productId: li.productId, qty: li.qty, unitPrice: li.unitPrice })),
        notes:              routeSchedule.notes ?? '',
      })
    } else if (!scheduleLoading && activeTab === 'standingOrder') {
      setSoInitialised(true)
    }
  }, [routeSchedule, scheduleLoading, soInitialised, activeTab])

  // ── Mutations ────────────────────────────────────────────────────────────────

  const setPriceMutation = useMutation({
    mutationFn: ({ productId, price }: { productId: string; price: number }) =>
      setCustomerProductPrice(customerId!, productId, price, user!.id, { source: 'manual' }),
    onSuccess: (_data, { productId }) => {
      setPricingEditMap((prev) => { const next = new Map(prev); next.delete(productId); return next })
    },
  })

  const removePriceMutation = useMutation({
    mutationFn: (productId: string) => removeCustomerProductPrice(customerId!, productId),
  })

  const saveMutation = useMutation({
    mutationFn: (data: Partial<CustomerRecord>) =>
      updateCustomer(customerId!, data as Partial<Omit<Customer, 'id' | 'createdAt'>>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId!) })
    },
  })

  const logMutation = useMutation({
    mutationFn: async (form: LogInteractionForm) => {
      await addDoc(collection(db, 'contactLogs'), {
        entityType:  'customer',
        entityId:    customerId,
        method:      form.method,
        summary:     form.summary.trim(),
        loggedBy:    user!.id,
        contactedAt: Timestamp.fromDate(new Date(form.contactedAt)),
        followUpAt:  form.followUpAt
          ? Timestamp.fromDate(new Date(form.followUpAt))
          : null,
        createdAt: serverTimestamp(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contactLogs', customerId] })
      setShowLogModal(false)
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      uploadFile(file, {
        entityType: 'customer',
        entityId:   customerId!,
        fileType:   'contract',
        onProgress: setUploadProgress,
      }),
    onSuccess: () => {
      setUploadProgress(null)
      queryClient.invalidateQueries({ queryKey: ['files', 'customer', customerId] })
    },
    onError: () => setUploadProgress(null),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['files', 'customer', customerId] }),
  })

  const saveScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!customerId || !user) throw new Error('Missing context')
      if (!soForm.nextDeliveryDate) throw new Error('Next delivery date is required.')
      if (soForm.lineItems.length === 0) throw new Error('Add at least one line item.')
      const schedule: Partial<RouteSchedule> = {
        isActive:            soForm.isActive,
        cadence:             soForm.cadence,
        customIntervalDays:  soForm.cadence === 'custom' ? soForm.customIntervalDays : undefined,
        dayOfWeek:           soForm.dayOfWeek,
        nextDeliveryDate:    Timestamp.fromDate(new Date(soForm.nextDeliveryDate)) as unknown as import('firebase/firestore').Timestamp,
        lineItems:           soForm.lineItems.filter((li) => li.productId && li.qty > 0),
        routeId:             '',
        notes:               soForm.notes,
        updatedBy:           user.id,
        updatedAt:           Timestamp.now() as unknown as import('firebase/firestore').Timestamp,
      }
      await updateRouteSchedule(customerId, schedule, user.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['route-schedule', customerId] })
      setSoSaved(true)
      setSoError(null)
      setTimeout(() => setSoSaved(false), 3000)
    },
    onError: (e: Error) => setSoError(e.message),
  })

  const createInvoiceMutation = useMutation({
    mutationFn: async ({
      lineItems,
      invoiceDate,
      dueDate,
      serviceDate,
      notes: invNotes,
      terms,
      applySalesTax,
      salesTaxRatePercent,
      paymentTermsDays,
      customerContactName,
      customerContactEmail,
    }: {
      lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[]
      invoiceDate: string
      dueDate:   string
      serviceDate: string
      notes:     string
      terms:     string
      applySalesTax: boolean
      salesTaxRatePercent: number
      paymentTermsDays?: number
      customerContactName?: string
      customerContactEmail?: string
    }) => createInvoice({
      customerId: customerId!,
      lineItems,
      issuedAt: new Date(invoiceDate),
      dueAt: new Date(dueDate),
      ...(serviceDate ? { serviceDate: new Date(serviceDate) } : {}),
      ...(invNotes ? { notes: invNotes } : {}),
      ...(terms ? { terms } : {}),
      ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
      ...(customerContactName ? { customerContactName } : {}),
      ...(customerContactEmail ? { customerContactEmail } : {}),
      applySalesTax,
      salesTaxRate: applySalesTax ? (salesTaxRatePercent / 100) : 0,
      salesTaxAmount: undefined,
      taxRate: applySalesTax ? (salesTaxRatePercent / 100) : 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', customerId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', 'outstanding', customerId] })
      setShowCreateInvoice(false)
      setEditingDraftInvoice(null)
      setInvoiceError(null)
      setInvoiceSuccess('Draft invoice saved.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const createInvoiceFromOrderMutation = useMutation({
    mutationFn: async (order: Order) => {
      const orderLineItems = (order.quotedLineItems?.length
        ? order.quotedLineItems
        : [{
            productId: order.productId,
            description: order.productId,
            quantity: order.quantity,
            unitPrice: order.unitPrice,
            amount: parseFloat((order.quantity * order.unitPrice).toFixed(2)),
          }]
      ).map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: li.amount,
      }))

      const addOnItems = (order.addOns ?? []).map((a) => ({
        description: a.productName,
        quantity: a.qty,
        unitPrice: a.unitPrice ?? 0,
        amount: parseFloat((a.qty * (a.unitPrice ?? 0)).toFixed(2)),
      }))

      const lineItems = [...orderLineItems, ...addOnItems]

      if (order.deliveryFee > 0 && !lineItems.some((li) => /delivery\s*fee/i.test(li.description))) {
        lineItems.push({
          description: 'Delivery Fee',
          quantity: 1,
          unitPrice: order.deliveryFee,
          amount: parseFloat(order.deliveryFee.toFixed(2)),
        })
      }

      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 30)

      return createInvoice({
        customerId: customerId!,
        orderId: order.id,
        quoteId: order.quoteId,
        quoteNumber: order.quoteNumber,
        lineItems,
        issuedAt: new Date(),
        dueAt: dueDate,
        serviceDate: order.deliveredAt?.toDate?.() ?? undefined,
        notes: order.notes,
        salesRepId: order.salesRepId,
        salesRepName: order.salesRepName,
        salesRepEmail: order.salesRepEmail,
        salesRepPhone: order.salesRepPhone,
        applySalesTax: order.applySalesTax ?? ((order.salesTaxRate ?? order.taxRate ?? 0) > 0 || (order.salesTaxAmount ?? 0) > 0),
        salesTaxRate: order.salesTaxRate ?? order.taxRate ?? 0,
        taxRate: order.salesTaxRate ?? order.taxRate ?? 0,
      } as Parameters<typeof createInvoice>[0])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', customerId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', 'history', customerId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', 'outstanding', customerId] })
      setInvoiceError(null)
      setInvoiceSuccess('Invoice created from order.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const duplicateQuoteMutation = useMutation({
    mutationFn: async (quote: Quote) => {
      if (!user?.id) throw new Error('You must be signed in to duplicate a quote.')
      return duplicateQuote(quote.id, user.id)
    },
    onSuccess: (newQuoteId) => {
      setInvoiceError(null)
      setInvoiceSuccess('Quote duplicated.')
      navigate(`${crmBase}/quotes/${newQuoteId}`)
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const convertQuoteMutation = useMutation({
    mutationFn: async (quote: Quote) => {
      if (!customerId) throw new Error('Missing customer context.')
      const firstPriced = quote.lineItems.find((li) => li.unitPrice > 0)
      if (!firstPriced) throw new Error('Quote has no priced line items.')
      return convertQuoteToOrder(quote.id, customerId, firstPriced.unitPrice, user?.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes', 'customer', customerId] })
      queryClient.invalidateQueries({ queryKey: ['orders', 'history', customerId] })
      setInvoiceError(null)
      setInvoiceSuccess('Quote converted to order.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const archiveQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => updateQuote(quoteId, { status: 'expired' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes', 'customer', customerId] })
      setInvoiceError(null)
      setInvoiceSuccess('Quote archived.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const deleteQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => deleteQuote(quoteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes', 'customer', customerId] })
      setInvoiceError(null)
      setInvoiceSuccess('Quote deleted.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  const editDraftInvoiceMutation = useMutation({
    mutationFn: async ({
      invoiceId,
      lineItems,
      invoiceDate,
      dueDate,
      serviceDate,
      notes: invNotes,
      terms,
      applySalesTax,
      salesTaxRatePercent,
      paymentTermsDays,
      customerContactName,
      customerContactEmail,
    }: {
      invoiceId: string
      lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[]
      invoiceDate: string
      dueDate:   string
      serviceDate: string
      notes:     string
      terms:     string
      applySalesTax: boolean
      salesTaxRatePercent: number
      paymentTermsDays?: number
      customerContactName?: string
      customerContactEmail?: string
    }) => saveDraftInvoiceEdits(invoiceId, {
      customerId: customerId!,
      lineItems,
      issuedAt: new Date(invoiceDate),
      dueAt: new Date(dueDate),
      ...(serviceDate ? { serviceDate: new Date(serviceDate) } : {}),
      ...(invNotes ? { notes: invNotes } : {}),
      ...(terms ? { terms } : {}),
      ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
      ...(customerContactName ? { customerContactName } : {}),
      ...(customerContactEmail ? { customerContactEmail } : {}),
      applySalesTax,
      salesTaxRate: applySalesTax ? (salesTaxRatePercent / 100) : 0,
      salesTaxAmount: undefined,
      taxRate: applySalesTax ? (salesTaxRatePercent / 100) : 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', customerId] })
      queryClient.invalidateQueries({ queryKey: ['invoices', 'history', customerId] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      setShowCreateInvoice(false)
      setEditingDraftInvoice(null)
      setInvoiceError(null)
      setInvoiceSuccess('Draft invoice updated.')
    },
    onError: (e: Error) => {
      setInvoiceSuccess(null)
      setInvoiceError(e.message)
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleEditSave = useCallback(async (data: Partial<CustomerRecord>) => {
    await saveMutation.mutateAsync(data)
    setShowEdit(false)
  }, [saveMutation])

  const handleNotesBlur = useCallback(() => {
    saveMutation.mutate({ notes }, {
      onSuccess: () => {
        setNotesSaved(true)
        setTimeout(() => setNotesSaved(false), 2000)
      },
    })
  }, [notes, saveMutation])

  const handleSaveAccountFields = useCallback(() => {
    const newStatus: CustomerStatus = onHold ? 'hold' : (customer?.status === 'hold' ? 'active' : customer?.status ?? 'active')
    saveMutation.mutate(
      {
        notes,
        creditLimit: Number(creditLimit) || 0,
        status: newStatus,
        // Extra CRM fields saved directly to Firestore doc
      } as Partial<CustomerRecord>,
      {
        onSuccess: async () => {
          // Save extra fields that aren't in the typed Customer interface
          await updateDoc(doc(db, 'customers', customerId!), {
            deliveryNotes:      deliveryNotes.trim(),
            accessInstructions: accessInstructions.trim(),
            holdReason:         holdReason.trim(),
            updatedAt:          serverTimestamp(),
          })
          queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId!) })
          setNotesSaved(true)
          setTimeout(() => setNotesSaved(false), 2000)
        },
      },
    )
  }, [onHold, customer, notes, creditLimit, deliveryNotes, accessInstructions, holdReason, saveMutation, customerId, queryClient])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    // Reset input so same file can be re-uploaded if needed
    e.target.value = ''
  }, [uploadMutation])

  const handleTogglePriority = useCallback(() => {
    if (!customer) return
    const cr = customer as CustomerRecord
    updateDoc(doc(db, 'customers', customerId!), {
      isPriority: !cr.isPriority,
      updatedAt: serverTimestamp(),
    }).then(() =>
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId!) }),
    )
  }, [customer, customerId, queryClient])

  const handleArchive = useCallback(async () => {
    if (!customerId) return
    setCustActionLoading(true)
    setCustActionError(null)
    try {
      await archiveCustomer(customerId)
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) })
      setShowArchiveConfirm(false)
    } catch (e: unknown) {
      setCustActionError(e instanceof Error ? e.message : 'Failed to archive customer')
    } finally {
      setCustActionLoading(false)
    }
  }, [customerId, queryClient])

  const handleDelete = useCallback(async () => {
    if (!customerId) return
    setCustActionLoading(true)
    setCustActionError(null)
    try {
      await deleteCustomer(customerId)
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) })
      setShowDeleteConfirm(false)
      navigate(`${crmBase}/customers`)
    } catch (e: unknown) {
      setCustActionError(e instanceof Error ? e.message : 'Failed to delete customer')
    } finally {
      setCustActionLoading(false)
    }
  }, [customerId, queryClient, navigate, crmBase])

  const handleRestore = useCallback(async () => {
    if (!customerId) return
    setCustActionLoading(true)
    setCustActionError(null)
    try {
      await restoreCustomer(customerId)
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId) })
    } catch (e: unknown) {
      setCustActionError(e instanceof Error ? e.message : 'Failed to restore customer')
    } finally {
      setCustActionLoading(false)
    }
  }, [customerId, queryClient])

  const handleTogglePricing = useCallback(() => {
    if (!customer) return
    const cr = customer as CustomerRecord
    updateDoc(doc(db, 'customers', customerId!), {
      pricingUnlocked: !(cr as unknown as { pricingUnlocked?: boolean }).pricingUnlocked,
      updatedAt: serverTimestamp(),
    }).then(() =>
      queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail(customerId!) }),
    )
  }, [customer, customerId, queryClient])

  // ── Render guards ─────────────────────────────────────────────────────────────

  if (customerLoading) {
    return (
      <div className="cr-page">
        <div className="cr-skeleton cr-skeleton--header" />
        <div className="cr-skeleton cr-skeleton--body" />
      </div>
    )
  }

  if (customerError || !customer) {
    return (
      <div className="cr-page cr-page--error">
        <p>Customer not found.</p>
        <Button variant="ghost" onClick={() => navigate(`${crmBase}/customers`)}>
          ← Back to customers
        </Button>
      </div>
    )
  }

  const cr = customer as CustomerRecord

  // ── Helpers to resolve contact/address from either flat or Company fields ──
  function resolveEmail(r: CustomerRecord)  { return r.email   || r.billingEmail || '' }
  function resolvePhone(r: CustomerRecord)  { return r.phone   || '' }
  function resolveAddress(r: CustomerRecord): string {
    if (r.address) return formatAddress(r)
    const addr = r.deliveryAddress ?? r.billingAddress
    if (!addr) return ''
    return formatAddress({ address: addr.street || '', city: addr.city || '', state: addr.state || '', zip: addr.zip || '' })
  }

  const mapsUrl = cr.lat && cr.lng
    ? getGoogleMapsUrl(cr.lat, cr.lng, cr.name)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(resolveAddress(cr))}`
  const statusCfg = STATUS_BADGE[cr.status]
  const orderHistoryDocs = files.filter((file) =>
    ['invoice', 'receipt', 'signature'].includes(file.fileType)
    || file.metadata?.documentKind === 'delivery-receipt'
    || file.metadata?.documentKind === 'terms-acceptance',
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="cr-page">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="cr-header">
        <div className="cr-header__back">
          <button className="cr-back-btn" onClick={() => navigate(`${crmBase}/customers`)}>
            ← Customers
          </button>
        </div>

        <div className="cr-header__main">
          <div className="cr-header__title">
            <h1 className="cr-header__name">{cr.name}</h1>
            {cr.email && <p className="cr-header__company">{cr.email}</p>}
          </div>

          <div className="cr-header__badges">
            <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
            {!(cr as unknown as { pricingUnlocked?: boolean }).pricingUnlocked && (
              <span className="cr-flag cr-flag--locked" title="Pricing not yet unlocked for this account">
                <Lock size={14} aria-hidden="true" /> Pricing Locked
              </span>
            )}
            {cr.isPriority && (
              <span className="cr-flag cr-flag--priority" title="Priority account">
                ⭐ Priority
              </span>
            )}
            {cr.status === 'hold' && (
              <span className="cr-flag cr-flag--hold" title="Account on hold">
                <Ban size={14} aria-hidden="true" /> Credit Hold
              </span>
            )}
          </div>
        </div>

        <div className="cr-header__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePriority}
            title={cr.isPriority ? 'Remove priority' : 'Mark as priority'}
          >
            {cr.isPriority ? '★ Priority' : '☆ Priority'}
          </Button>
          <Button
            variant={(cr as unknown as { pricingUnlocked?: boolean }).pricingUnlocked ? 'success' : 'ghost'}
            size="sm"
            onClick={handleTogglePricing}
            title={(cr as unknown as { pricingUnlocked?: boolean }).pricingUnlocked
              ? 'Pricing is unlocked — click to lock'
              : 'Pricing is locked — click to unlock for this company'}
          >
            {(cr as unknown as { pricingUnlocked?: boolean }).pricingUnlocked ? (
              <><Unlock size={14} aria-hidden="true" /> Pricing</>
            ) : (
              <><Lock size={14} aria-hidden="true" /> Pricing</>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
            Edit
          </Button>
        </div>
      </header>

      {/* ── Contact info card ──────────────────────────────────────────────── */}
      <Card className="cr-contact-card">
        <CardBody>
          <div className="cr-contact-grid">
            <div className="cr-contact-item">
              <span className="cr-contact-item__icon"><Mail size={14} aria-hidden="true" /></span>
              <a href={`mailto:${resolveEmail(cr)}`} className="cr-contact-item__value">{resolveEmail(cr) || <span style={{color:'#bbb'}}>No email on file</span>}</a>
            </div>
            <div className="cr-contact-item">
              <span className="cr-contact-item__icon"><Phone size={14} aria-hidden="true" /></span>
              <a href={`tel:${resolvePhone(cr)}`} className="cr-contact-item__value">{resolvePhone(cr) || <span style={{color:'#bbb'}}>No phone on file</span>}</a>
            </div>
            <div className="cr-contact-item">
              <span className="cr-contact-item__icon"><MapPin size={14} aria-hidden="true" /></span>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cr-contact-item__value"
              >
                {resolveAddress(cr) || <span style={{color:'#bbb'}}>No address on file</span>}
              </a>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="cr-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`cr-tab${activeTab === t.key ? ' cr-tab--active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ──────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="cr-tab-panel" role="tabpanel">

          {/* Tanks */}
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">
                Active tanks
                {tanksLoading && <span className="cr-spinner" />}
              </h3>
            </CardHeader>
            <CardBody>
              {activeTanks.length === 0 ? (
                <p className="cr-empty">No active tanks for this customer.</p>
              ) : (
                <ul className="cr-tanks-list">
                  {activeTanks.map(tank => (
                    <li key={tank.id} className="cr-tank-item">
                      <div className="cr-tank-item__header">
                        <span className="cr-tank-item__serial">{tank.serialNumber}</span>
                        {tank.currentLevelPct !== undefined && tank.currentLevelPct <= 20 && (
                          <Badge variant="danger">Low</Badge>
                        )}
                      </div>
                      <TankLevelBar
                        pct={tank.currentLevelPct}
                        gasType={tank.gasType}
                        sizeLabel={tank.sizeLabel}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Financial summary */}
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Account balance</h3>
            </CardHeader>
            <CardBody>
              <div className="cr-balance-row">
                <div className="cr-balance-item">
                  <span className="cr-balance-item__label">Outstanding balance</span>
                  <span className={`cr-balance-item__value${outstandingBalance > 0 ? ' cr-balance-item__value--owed' : ''}`}>
                    {formatCurrency(outstandingBalance)}
                  </span>
                </div>
                <div className="cr-balance-item">
                  <span className="cr-balance-item__label">Autopay</span>
                  <Badge variant={cr.autopayEnabled ? 'success' : 'neutral'}>
                    {cr.autopayEnabled ? 'Enabled' : 'Off'}
                  </Badge>
                </div>
                <div className="cr-balance-item">
                  <span className="cr-balance-item__label">Credit limit</span>
                  <span className="cr-balance-item__value">{formatCurrency(cr.creditLimit)}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Recent orders */}
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Recent orders</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/ops/orders?customerId=${customerId}`)}
              >
                View all
              </Button>
            </CardHeader>
            <CardBody>
              {recentOrders.length === 0 ? (
                <p className="cr-empty">No orders yet.</p>
              ) : (
                <table className="cr-table cr-table--quotes">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map(order => (
                      <tr key={order.id}>
                        <td>{order.requestedAt ? formatDate(order.requestedAt) : '—'}</td>
                        <td>{order.productId}</td>
                        <td>{order.quantity}</td>
                        <td>{formatCurrency(order.total)}</td>
                        <td>
                          <Badge variant={ORDER_BADGE[order.status]}>
                            {renderOrderStatus(order)}
                          </Badge>
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={createInvoiceFromOrderMutation.isPending && (createInvoiceFromOrderMutation.variables as Order | undefined)?.id === order.id}
                            onClick={() => createInvoiceFromOrderMutation.mutate(order)}
                            disabled={order.status === 'cancelled' || order.status === 'archived' || order.status === 'paid'}
                          >
                            Create Invoice
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          {/* Recent quotes */}
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Recent quotes</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`${crmBase}/quotes`)}
              >
                View all
              </Button>
            </CardHeader>
            <CardBody>
              {recentQuotes.length === 0 ? (
                <p className="cr-empty">No quotes yet.</p>
              ) : (
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Quote #</th>
                      <th>Rep</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentQuotes.map((quote) => (
                      <tr key={quote.id}>
                        <td className="cr-table__mono" data-label="Quote #">{quote.quoteNumber}</td>
                        <td data-label="Rep">{quote.salesRepName ?? '—'}</td>
                        <td data-label="Status">
                          <Badge variant={
                            quote.status === 'accepted' ? 'success' :
                            quote.status === 'sent' ? 'info' :
                            quote.status === 'declined' ? 'danger' : 'neutral'
                          }>
                            {quote.status}
                          </Badge>
                        </td>
                        <td data-label="Total">{formatCurrency(quote.total)}</td>
                        <td data-label="Actions">
                          <div className="cr-table__actions">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`${crmBase}/quotes/${quote.id}`)}>
                              Open
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={duplicateQuoteMutation.isPending && (duplicateQuoteMutation.variables as Quote | undefined)?.id === quote.id}
                              onClick={() => duplicateQuoteMutation.mutate(quote)}
                            >
                              Duplicate
                            </Button>
                            {canManageQuotes && quote.status !== 'expired' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={archiveQuoteMutation.isPending && archiveQuoteMutation.variables === quote.id}
                                onClick={() => {
                                  if (!window.confirm('Archive this quote? It will be marked as expired.')) return
                                  archiveQuoteMutation.mutate(quote.id)
                                }}
                              >
                                Archive
                              </Button>
                            )}
                            {canManageQuotes && (quote.status === 'draft' || quote.status === 'declined' || quote.status === 'expired') && (
                              <Button
                                variant="danger"
                                size="sm"
                                loading={deleteQuoteMutation.isPending && deleteQuoteMutation.variables === quote.id}
                                onClick={() => {
                                  if (!window.confirm(`Delete quote ${quote.quoteNumber ?? quote.id}? This cannot be undone.`)) return
                                  deleteQuoteMutation.mutate(quote.id)
                                }}
                              >
                                Delete
                              </Button>
                            )}
                            {quote.status === 'accepted' && (
                              <Button
                                variant="primary"
                                size="sm"
                                loading={convertQuoteMutation.isPending && (convertQuoteMutation.variables as Quote | undefined)?.id === quote.id}
                                onClick={() => convertQuoteMutation.mutate(quote)}
                              >
                                Convert to Order
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          {/* Recent invoices */}
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Recent invoices</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/ops/billing?customerId=${customerId}`)}
              >
                View all
              </Button>
            </CardHeader>
            <CardBody>
              {recentInvoices.length === 0 ? (
                <p className="cr-empty">No invoices yet.</p>
              ) : (
                <table className="cr-table cr-table--quotes">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="cr-table__mono">{inv.invoiceNumber}</td>
                        <td>{formatDate(inv.issuedAt)}</td>
                        <td>{formatDate(inv.dueAt)}</td>
                        <td>{formatCurrency(inv.total)}</td>
                        <td>
                          <Badge variant={INVOICE_BADGE[inv.status] ?? 'neutral'}>
                            {inv.status}
                          </Badge>
                        </td>
                        <td>
                          {inv.status === 'draft' ? (
                            <Button variant="secondary" size="sm" onClick={() => openDraftEditor(inv)}>
                              Edit Draft
                            </Button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          {/* Quick actions */}
          <div className="cr-quick-actions">
            <Button
              variant="primary"
              onClick={() => navigate(`/ops/orders?new=1&customerId=${customerId}`)}
            >
              + New order
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setInvoiceError(null)
                setInvoiceSuccess(null)
                setEditingDraftInvoice(null)
                setShowCreateInvoice(true)
              }}
            >
              + New invoice
            </Button>
          </div>
          {invoiceError && (
            <p className="cr-form-error" style={{ marginTop: 8 }}>{invoiceError}</p>
          )}
          {invoiceSuccess && (
            <p style={{ marginTop: 8, color: 'var(--color-success-700, #166534)' }}>{invoiceSuccess}</p>
          )}
        </div>
      )}

      {/* ── Tab: Order History ────────────────────────────────────────────── */}
      {activeTab === 'orderHistory' && (
        <div className="cr-tab-panel" role="tabpanel">
          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Quotes</h3>
            </CardHeader>
            <CardBody>
              {orderHistoryQuotes.length === 0 ? (
                <p className="cr-empty">No quotes found for this customer.</p>
              ) : (
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Quote #</th>
                      <th>Rep</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistoryQuotes.map((quote) => (
                      <tr key={quote.id}>
                        <td className="cr-table__mono" data-label="Quote #">{quote.quoteNumber || quote.id}</td>
                        <td data-label="Rep">{quote.salesRepName ?? '—'}</td>
                        <td data-label="Status">
                          <Badge variant={
                            quote.status === 'accepted' ? 'success' :
                            quote.status === 'sent' ? 'info' :
                            quote.status === 'declined' ? 'danger' : 'neutral'
                          }>
                            {quote.status}
                          </Badge>
                        </td>
                        <td data-label="Total">{formatCurrency(quote.total)}</td>
                        <td data-label="Actions">
                          <div className="cr-table__actions">
                            <Button variant="ghost" size="sm" onClick={() => navigate(`${crmBase}/quotes/${quote.id}`)}>
                              Open
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={duplicateQuoteMutation.isPending && (duplicateQuoteMutation.variables as Quote | undefined)?.id === quote.id}
                              onClick={() => duplicateQuoteMutation.mutate(quote)}
                            >
                              Duplicate
                            </Button>
                            {canManageQuotes && quote.status !== 'expired' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={archiveQuoteMutation.isPending && archiveQuoteMutation.variables === quote.id}
                                onClick={() => {
                                  if (!window.confirm('Archive this quote? It will be marked as expired.')) return
                                  archiveQuoteMutation.mutate(quote.id)
                                }}
                              >
                                Archive
                              </Button>
                            )}
                            {canManageQuotes && (quote.status === 'draft' || quote.status === 'declined' || quote.status === 'expired') && (
                              <Button
                                variant="danger"
                                size="sm"
                                loading={deleteQuoteMutation.isPending && deleteQuoteMutation.variables === quote.id}
                                onClick={() => {
                                  if (!window.confirm(`Delete quote ${quote.quoteNumber ?? quote.id}? This cannot be undone.`)) return
                                  deleteQuoteMutation.mutate(quote.id)
                                }}
                              >
                                Delete
                              </Button>
                            )}
                            {quote.status === 'accepted' && (
                              <Button
                                variant="primary"
                                size="sm"
                                loading={convertQuoteMutation.isPending && (convertQuoteMutation.variables as Quote | undefined)?.id === quote.id}
                                onClick={() => convertQuoteMutation.mutate(quote)}
                              >
                                Convert to Order
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Orders</h3>
            </CardHeader>
            <CardBody>
              {orderHistoryOrders.length === 0 ? (
                <p className="cr-empty">No orders found for this customer.</p>
              ) : (
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Requested</th>
                      <th>Quote Ref</th>
                      <th>Status</th>
                      <th>Quantity</th>
                      <th>Total</th>
                      <th>Docs</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistoryOrders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.requestedAt ? formatDate(order.requestedAt) : '—'}</td>
                        <td className="cr-table__mono">{order.quoteNumber || order.quoteId || '—'}</td>
                        <td>
                          <Badge variant={ORDER_BADGE[order.status]}>
                            {renderOrderStatus(order)}
                          </Badge>
                        </td>
                        <td>{order.quantity}</td>
                        <td>{formatCurrency(order.total)}</td>
                        <td>
                          <div className="cr-table__links">
                            {order.billOfLadingUrl && (
                              <a href={order.billOfLadingUrl} target="_blank" rel="noopener noreferrer">Receipt</a>
                            )}
                            {order.invoicePdfUrl && (
                              <a href={order.invoicePdfUrl} target="_blank" rel="noopener noreferrer">Invoice</a>
                            )}
                            {order.signatureUrl && (
                              <a href={order.signatureUrl} target="_blank" rel="noopener noreferrer">Signature</a>
                            )}
                            {!order.billOfLadingUrl && !order.invoicePdfUrl && !order.signatureUrl && '—'}
                          </div>
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={createInvoiceFromOrderMutation.isPending && (createInvoiceFromOrderMutation.variables as Order | undefined)?.id === order.id}
                            onClick={() => createInvoiceFromOrderMutation.mutate(order)}
                            disabled={order.status === 'cancelled' || order.status === 'archived' || order.status === 'paid'}
                          >
                            Create Invoice
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Invoices</h3>
            </CardHeader>
            <CardBody>
              {orderHistoryInvoices.length === 0 ? (
                <p className="cr-empty">No invoices found for this customer.</p>
              ) : (
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Issued</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>PDF</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistoryInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="cr-table__mono">{invoice.invoiceNumber || invoice.id}</td>
                        <td>{invoice.issuedAt ? formatDate(invoice.issuedAt) : '—'}</td>
                        <td>
                          <Badge variant={INVOICE_BADGE[invoice.status] ?? 'neutral'}>
                            {invoice.status}
                          </Badge>
                        </td>
                        <td>{formatCurrency(invoice.total)}</td>
                        <td>
                          {invoice.pdfUrl ? (
                            <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">Download</a>
                          ) : '—'}
                        </td>
                        <td>
                          {invoice.status === 'draft' ? (
                            <Button variant="secondary" size="sm" onClick={() => openDraftEditor(invoice)}>
                              Edit Draft
                            </Button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Delivery & Acceptance Documents</h3>
            </CardHeader>
            <CardBody>
              {orderHistoryDocs.length === 0 ? (
                <p className="cr-empty">No delivery or acceptance documents found yet.</p>
              ) : (
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistoryDocs.map((file) => (
                      <tr key={file.id}>
                        <td>{getFileDisplayName(file)}</td>
                        <td>{file.metadata?.documentKind === 'terms-acceptance' ? 'Acceptance' : file.fileType}</td>
                        <td>{formatDate(file.createdAt)}</td>
                        <td>
                          <a href={file.url} target="_blank" rel="noopener noreferrer">
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Tab: Contact History ───────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="cr-tab-panel" role="tabpanel">
          <div className="cr-panel-header">
            <h3 className="cr-section-title">Contact history</h3>
            <Button variant="primary" size="sm" onClick={() => setShowLogModal(true)}>
              + Log interaction
            </Button>
          </div>

          {logsLoading ? (
            <div className="cr-skeleton cr-skeleton--list" />
          ) : contactLogs.length === 0 ? (
            <Card>
              <CardBody>
                <p className="cr-empty">
                  No interactions logged yet.{' '}
                  <button className="cr-link" onClick={() => setShowLogModal(true)}>
                    Log the first one →
                  </button>
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="cr-timeline">
              {contactLogs.map(log => (
                <div key={log.id} className="cr-timeline-item">
                  <div className="cr-timeline-item__icon" aria-hidden="true">
                    {(() => {
                      const MethodIcon = METHOD_ICONS[log.method] ?? StickyNote
                      return <MethodIcon size={14} aria-hidden="true" />
                    })()}
                  </div>
                  <div className="cr-timeline-item__content">
                    <div className="cr-timeline-item__meta">
                      <span className="cr-timeline-item__method">
                        {METHOD_LABELS[log.method]}
                      </span>
                      <span className="cr-timeline-item__date">
                        {formatDate(log.contactedAt)} · {formatRelative(log.contactedAt)}
                      </span>
                    </div>
                    <p className="cr-timeline-item__summary">{log.summary}</p>
                    {log.followUpAt && (
                      <p className="cr-timeline-item__followup">
                        Follow-up: {formatDate(log.followUpAt)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Account Notes ────────────────────────────────────────────── */}
      {activeTab === 'notes' && (
        <div className="cr-tab-panel" role="tabpanel">

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Account notes</h3>
              {notesSaved && <span className="cr-saved-indicator">✓ Saved</span>}
            </CardHeader>
            <CardBody>
              <div className="ui-field">
                <label className="ui-field__label">General notes</label>
                <textarea
                  className="ui-input cr-textarea cr-textarea--tall"
                  rows={6}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={handleNotesBlur}
                  placeholder="Free-form account notes…"
                />
                <span className="ui-field__hint">Auto-saved when you leave this field.</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Delivery &amp; access</h3>
            </CardHeader>
            <CardBody>
              <div className="ui-field">
                <label className="ui-field__label">Delivery notes</label>
                <textarea
                  className="ui-input cr-textarea"
                  rows={3}
                  value={deliveryNotes}
                  onChange={e => setDeliveryNotes(e.target.value)}
                  placeholder="Special delivery instructions for drivers…"
                />
              </div>
              <div className="ui-field cr-field-spacer">
                <label className="ui-field__label">Access instructions</label>
                <textarea
                  className="ui-input cr-textarea"
                  rows={3}
                  value={accessInstructions}
                  onChange={e => setAccessInstructions(e.target.value)}
                  placeholder="Gate codes, key locations, access restrictions…"
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="cr-section-title">Account flags</h3>
            </CardHeader>
            <CardBody>
              <div className="cr-flags-grid">
                <Input
                  label="Credit limit ($)"
                  type="number"
                  min="0"
                  step="100"
                  value={creditLimit}
                  onChange={e => setCreditLimit(e.target.value)}
                />
                <div className="cr-toggle-field">
                  <span className="ui-field__label">Account hold</span>
                  <label className="cr-toggle">
                    <input
                      type="checkbox"
                      checked={onHold}
                      onChange={e => setOnHold(e.target.checked)}
                    />
                    <span className="cr-toggle__track" />
                    <span className="cr-toggle__label">
                      {onHold ? 'On hold' : 'Active'}
                    </span>
                  </label>
                </div>
              </div>

              {onHold && (
                <div className="ui-field cr-field-spacer">
                  <label className="ui-field__label">Hold reason</label>
                  <textarea
                    className="ui-input cr-textarea"
                    rows={2}
                    value={holdReason}
                    onChange={e => setHoldReason(e.target.value)}
                    placeholder="Why is this account on hold?"
                  />
                </div>
              )}
            </CardBody>
          </Card>

          <div className="cr-notes-save">
            <Button
              variant="primary"
              onClick={handleSaveAccountFields}
              loading={saveMutation.isPending}
            >
              Save account settings
            </Button>
          </div>
        </div>
      )}

      {/* ── Tab: Documents ─────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <div className="cr-tab-panel" role="tabpanel">
          <div className="cr-panel-header">
            <h3 className="cr-section-title">Documents</h3>
            <div className="cr-doc-actions">
              {uploadProgress !== null && (
                <div className="cr-upload-progress">
                  <div
                    className="cr-upload-progress__bar"
                    style={{ width: `${uploadProgress}%` }}
                  />
                  <span className="cr-upload-progress__label">{uploadProgress}%</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={handleFileInput}
                style={{ display: 'none' }}
              />
              <Button
                variant="primary"
                size="sm"
                loading={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload document
              </Button>
            </div>
          </div>

          {filesLoading ? (
            <div className="cr-skeleton cr-skeleton--list" />
          ) : files.length === 0 ? (
            <Card>
              <CardBody>
                <p className="cr-empty">No documents uploaded yet.</p>
              </CardBody>
            </Card>
          ) : (
            <div className="cr-files-list">
              {files.map(file => (
                <FileRow
                  key={file.id}
                  file={file}
                  onDelete={id => deleteMutation.mutate(id)}
                  deleting={deleteMutation.isPending && deleteMutation.variables === file.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: User Access ─────────────────────────────────────────────── */}
      {activeTab === 'access' && (
        <div className="cr-tab-panel" role="tabpanel">
          <UserAccessTab
            companyId={customerId!}
            customer={customer as Customer}
            users={companyUsers}
            loading={usersLoading}
            onRefresh={() => void refetchUsers()}
          />
        </div>
      )}

      {/* ── Tab: Product Pricing ──────────────────────────────────────────── */}
      {activeTab === 'productPricing' && (() => {
        const pricingMap = new Map(customerPricingEntries.map((p) => [p.productId, p]))
        const pricingProducts = allProducts.filter((p) => p.category !== 'Fees')
        const isLoadingTab = pricingLoading || allProductsLoading

        const startEdit = (productId: string, currentPrice?: number) => {
          setPricingEditMap((prev) => {
            const next = new Map(prev)
            next.set(productId, currentPrice !== undefined ? String(currentPrice) : '')
            return next
          })
        }

        const cancelEdit = (productId: string) => {
          setPricingEditMap((prev) => { const next = new Map(prev); next.delete(productId); return next })
        }

        const savePrice = (productId: string) => {
          const raw = pricingEditMap.get(productId) ?? ''
          const price = parseFloat(raw)
          if (!Number.isFinite(price) || price < 0) return
          setPriceMutation.mutate({ productId, price })
        }

        return (
          <div className="cr-tab-panel" role="tabpanel">
            <div className="cr-panel-header">
              <h3 className="cr-section-title">Product pricing</h3>
              <p className="cr-section-desc">Custom prices for this customer. Leave blank to use list price.</p>
            </div>

            {isLoadingTab ? (
              <div className="cr-skeleton cr-skeleton--list" />
            ) : pricingProducts.length === 0 ? (
              <Card><CardBody><p className="cr-empty">No products found.</p></CardBody></Card>
            ) : (
              <Card>
                <CardBody>
                  <table className="cr-table cr-table--pricing">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th>Custom Price</th>
                        <th>Source</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pricingProducts.map((product) => {
                        const pricing = pricingMap.get(product.id)
                        const isEditing = pricingEditMap.has(product.id)
                        const editVal = pricingEditMap.get(product.id) ?? ''
                        const isSaving = setPriceMutation.isPending && (setPriceMutation.variables as { productId: string } | undefined)?.productId === product.id
                        const isRemoving = removePriceMutation.isPending && removePriceMutation.variables === product.id

                        return (
                          <tr key={product.id} className={pricing ? 'cr-pricing-row--set' : ''}>
                            <td className="cr-pricing-row__name">{product.name}</td>
                            <td className="cr-pricing-row__cat">{product.category}</td>
                            <td className="cr-pricing-row__price">
                              {isEditing ? (
                                <div className="cr-pricing-edit">
                                  <span className="cr-pricing-edit__prefix">$</span>
                                  <input
                                    className="ui-input cr-pricing-edit__input"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editVal}
                                    onChange={(e) => {
                                      setPricingEditMap((prev) => { const next = new Map(prev); next.set(product.id, e.target.value); return next })
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') savePrice(product.id); if (e.key === 'Escape') cancelEdit(product.id) }}
                                    autoFocus
                                    aria-label={`Price for ${product.name}`}
                                  />
                                </div>
                              ) : pricing ? (
                                <span className="cr-pricing-row__val">
                                  {formatCurrency(pricing.price)}
                                  <span className="cr-pricing-row__unit"> / {product.unit}</span>
                                </span>
                              ) : (
                                <span className="cr-pricing-row__none">—</span>
                              )}
                            </td>
                            <td className="cr-pricing-row__source">
                              {pricing ? (
                                <Badge variant={pricing.source === 'quote' ? 'brand' : 'neutral'}>
                                  {pricing.source === 'quote' ? 'From quote' : 'Manual'}
                                </Badge>
                              ) : null}
                            </td>
                            <td className="cr-pricing-row__actions">
                              {isEditing ? (
                                <>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    loading={isSaving}
                                    onClick={() => savePrice(product.id)}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => cancelEdit(product.id)}
                                    disabled={isSaving}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => startEdit(product.id, pricing?.price)}
                                  >
                                    {pricing ? 'Edit' : 'Set price'}
                                  </Button>
                                  {pricing && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      loading={isRemoving}
                                      onClick={() => removePriceMutation.mutate(product.id)}
                                    >
                                      Remove
                                    </Button>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            )}
          </div>
        )
      })()}

      {/* ── Standing Order tab ────────────────────────────────────────────── */}
      {activeTab === 'standingOrder' && (() => {
        const soPricingMap = new Map(soPricingEntries.map((p) => [p.productId, p.price]))
        const availableProducts = soProducts.filter((p) => p.category !== 'Fees')
        const isLoading = scheduleLoading || soProductsLoading

        const addLineItem = () => {
          setSoForm((prev) => ({
            ...prev,
            lineItems: [...prev.lineItems, { productId: '', qty: 1, unitPrice: 0 }],
          }))
        }

        const removeLineItem = (i: number) => {
          setSoForm((prev) => ({ ...prev, lineItems: prev.lineItems.filter((_, idx) => idx !== i) }))
        }

        const updateLineItem = (i: number, field: 'productId' | 'qty' | 'unitPrice', value: string | number) => {
          setSoForm((prev) => {
            const items = prev.lineItems.map((li, idx) => {
              if (idx !== i) return li
              if (field === 'productId') {
                const productId = value as string
                const customPrice = soPricingMap.get(productId)
                const product     = availableProducts.find((p) => p.id === productId)
                const unitPrice   = customPrice ?? product?.basePrice ?? 0
                return { ...li, productId, unitPrice }
              }
              return { ...li, [field]: field === 'qty' ? Math.max(1, Number(value)) : Number(value) }
            })
            return { ...prev, lineItems: items }
          })
        }

        return (
          <div className="cr-tab-panel" role="tabpanel">
            <div className="cr-panel-header">
              <h3 className="cr-section-title">Standing delivery order</h3>
              <p className="cr-section-desc">
                Set up a recurring schedule for this customer. Line item prices are pre-filled from
                their custom pricing. The scheduler will auto-create orders ahead of each delivery.
              </p>
            </div>

            {isLoading ? (
              <div className="cr-skeleton cr-skeleton--list" />
            ) : (
              <Card>
                <CardBody>
                  {/* ── Active toggle ── */}
                  <div className="cr-so-row cr-so-row--toggle">
                    <label className="cr-so-toggle-wrap">
                      <input
                        type="checkbox"
                        checked={soForm.isActive}
                        onChange={(e) => setSoForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                        className="cr-so-toggle-check"
                      />
                      <span className="cr-so-toggle-label">
                        {soForm.isActive ? 'Active — scheduler will create orders' : 'Paused — no orders will be created'}
                      </span>
                    </label>
                  </div>

                  {/* ── Cadence ── */}
                  <div className="cr-so-field">
                    <label className="cr-so-label">Delivery cadence</label>
                    <div className="cr-so-cadence-grid">
                      {CADENCE_OPTS.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`cr-so-cadence-btn${soForm.cadence === value ? ' cr-so-cadence-btn--active' : ''}`}
                          onClick={() => setSoForm((prev) => ({ ...prev, cadence: value }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {soForm.cadence === 'custom' && (
                      <div className="cr-so-inline-field">
                        <label className="cr-so-label">Interval (days)</label>
                        <input
                          type="number"
                          min={1}
                          className="ui-input cr-so-narrow-input"
                          value={soForm.customIntervalDays}
                          onChange={(e) => setSoForm((prev) => ({ ...prev, customIntervalDays: parseInt(e.target.value, 10) || 1 }))}
                        />
                      </div>
                    )}
                  </div>

                  {/* ── Day of week ── */}
                  <div className="cr-so-field">
                    <label className="cr-so-label">Preferred delivery day</label>
                    <div className="cr-so-day-grid">
                      {DAY_NAMES.map((day, i) => (
                        <button
                          key={day}
                          type="button"
                          className={`cr-so-day-btn${soForm.dayOfWeek === i ? ' cr-so-day-btn--active' : ''}`}
                          onClick={() => setSoForm((prev) => ({ ...prev, dayOfWeek: i }))}
                        >
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Next delivery date ── */}
                  <div className="cr-so-field">
                    <label className="cr-so-label">Next delivery date</label>
                    <input
                      type="date"
                      className="ui-input cr-so-date-input"
                      value={soForm.nextDeliveryDate}
                      onChange={(e) => setSoForm((prev) => ({ ...prev, nextDeliveryDate: e.target.value }))}
                    />
                  </div>

                  {/* ── Line items ── */}
                  <div className="cr-so-field">
                    <label className="cr-so-label">Products per delivery</label>
                    {soForm.lineItems.length > 0 && (
                      <div className="cr-so-items">
                        <div className="cr-so-items-header">
                          <span>Product</span>
                          <span>Qty</span>
                          <span>Unit price</span>
                          <span>Total</span>
                          <span />
                        </div>
                        {soForm.lineItems.map((li, i) => {
                          const product = availableProducts.find((p) => p.id === li.productId)
                          const lineTotal = li.qty * li.unitPrice
                          return (
                            <div key={i} className="cr-so-item-row">
                              <select
                                className="ui-input cr-so-product-select"
                                value={li.productId}
                                onChange={(e) => updateLineItem(i, 'productId', e.target.value)}
                              >
                                <option value="">— Select product —</option>
                                {availableProducts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}{soPricingMap.has(p.id) ? ' ★' : ''}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={1}
                                className="ui-input cr-so-qty-input"
                                value={li.qty}
                                onChange={(e) => updateLineItem(i, 'qty', e.target.value)}
                              />
                              <div className="cr-so-price-wrap">
                                <span className="cr-so-price-prefix">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="ui-input cr-so-price-input"
                                  value={li.unitPrice}
                                  onChange={(e) => updateLineItem(i, 'unitPrice', e.target.value)}
                                />
                                {product && <span className="cr-so-unit">/ {product.unit}</span>}
                              </div>
                              <span className="cr-so-line-total">{formatCurrency(lineTotal)}</span>
                              <button
                                type="button"
                                className="cr-so-remove-btn"
                                onClick={() => removeLineItem(i)}
                                title="Remove"
                              >✕</button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <button type="button" className="cr-link cr-so-add-item" onClick={addLineItem}>
                      + Add product
                    </button>
                  </div>

                  {/* ── Notes ── */}
                  <div className="cr-so-field">
                    <label className="cr-so-label">Delivery notes <span className="cr-optional">(optional)</span></label>
                    <textarea
                      className="ui-input cr-textarea"
                      rows={2}
                      placeholder="Access instructions, timing preferences…"
                      value={soForm.notes}
                      onChange={(e) => setSoForm((prev) => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>

                  {soError && <p className="cr-form-error">{soError}</p>}
                  {soSaved && <p className="cr-save-confirm">✓ Standing order saved</p>}

                  <div className="cr-modal-actions cr-modal-actions--left">
                    <Button
                      variant="primary"
                      loading={saveScheduleMutation.isPending}
                      onClick={() => { setSoError(null); void saveScheduleMutation.mutateAsync() }}
                    >
                      Save standing order
                    </Button>
                    {routeSchedule && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSoInitialised(false)
                          queryClient.invalidateQueries({ queryKey: ['route-schedule', customerId] })
                        }}
                      >
                        Discard changes
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        )
      })()}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showEdit && (
        <EditCustomerModal
          customer={cr}
          onClose={() => setShowEdit(false)}
          onSave={handleEditSave}
          saving={saveMutation.isPending}
          onArchive={() => setShowArchiveConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
          onRestore={() => void handleRestore()}
          actionLoading={custActionLoading}
          actionError={custActionError}
        />
      )}

      {showLogModal && (
        <LogInteractionModal
          onClose={() => setShowLogModal(false)}
          onSubmit={async (form) => { await logMutation.mutateAsync(form) }}
          saving={logMutation.isPending}
        />
      )}

      {showCreateInvoice && (
        <CreateInvoiceModal
          mode={editingDraftInvoice ? 'edit' : 'create'}
          initialInvoice={editingDraftInvoice}
          onClose={() => {
            setShowCreateInvoice(false)
            setEditingDraftInvoice(null)
          }}
          onSubmit={async (
            lineItems,
            invoiceDate,
            dueDate,
            serviceDate,
            notes,
            terms,
            applySalesTax, 
            salesTaxRatePercent,
            paymentTermsDays,
            customerContactName,
            customerContactEmail,
          ) => {
            if (editingDraftInvoice?.id) {
              await editDraftInvoiceMutation.mutateAsync({
                invoiceId: editingDraftInvoice.id,
                lineItems,
                invoiceDate,
                dueDate,
                serviceDate,
                notes,
                terms,
                applySalesTax,
                salesTaxRatePercent,
                paymentTermsDays,
                customerContactName,
                customerContactEmail,
              })
              return
            }
            await createInvoiceMutation.mutateAsync({
              lineItems,
              invoiceDate,
              dueDate,
              serviceDate,
              notes,
              terms,
              applySalesTax,
              salesTaxRatePercent,
              paymentTermsDays,
              customerContactName,
              customerContactEmail,
            })
          }}
          saving={createInvoiceMutation.isPending || editDraftInvoiceMutation.isPending}
        />
      )}

      {/* ── Archive confirmation ────────────────────────────────────────── */}
      {showArchiveConfirm && (
        <Modal open onClose={() => setShowArchiveConfirm(false)} title="Archive customer" size="sm">
          <div className="cr-confirm-body">
            <p>Archive <strong>{cr.name}</strong>? The customer will be hidden from active lists but can be restored at any time.</p>
            {custActionError && <p className="cr-form-error">{custActionError}</p>}
          </div>
          <div className="cr-modal-actions">
            <Button variant="ghost" onClick={() => setShowArchiveConfirm(false)} disabled={custActionLoading}>
              Cancel
            </Button>
            <Button variant="secondary" loading={custActionLoading} onClick={() => void handleArchive()}>
              Archive
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Delete confirmation ─────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(false)} title="Delete customer" size="sm">
          <div className="cr-confirm-body">
            <p>
              Delete <strong>{cr.name}</strong>? The record will be soft-deleted and permanently
              removed after 30 days. You can restore the customer within that window.
            </p>
            {custActionError && <p className="cr-form-error">{custActionError}</p>}
          </div>
          <div className="cr-modal-actions">
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)} disabled={custActionLoading}>
              Cancel
            </Button>
            <Button variant="danger" loading={custActionLoading} onClick={() => void handleDelete()}>
              Delete customer
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── FileRow ───────────────────────────────────────────────────────────────────

function FileRow({
  file,
  onDelete,
  deleting,
}: {
  file: AppFile
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string>(
    file.url || (file.metadata?.pdfUrl as string | undefined) || (file.metadata?.downloadUrl as string | undefined) || '',
  )

  useEffect(() => {
    let cancelled = false
    if (resolvedUrl || !file.storagePath) return () => { cancelled = true }

    void getFileUrl(file.storagePath)
      .then((url) => {
        if (!cancelled) setResolvedUrl(url)
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl('')
      })

    return () => { cancelled = true }
  }, [resolvedUrl, file.storagePath])

  const docuSealStatus = file.metadata?.docuSealStatus as string | undefined
  const isContract = ['contract', 'quote', 'invoice', 'receipt'].includes(file.fileType)
  const isSigned   = file.fileType === 'signature' || docuSealStatus === 'completed'
  const FileKindIcon = isContract ? FileText : isSigned ? CheckCircle : Paperclip

  return (
    <Card className="cr-file-row">
      <CardBody>
        <div className="cr-file-row__body">
          <div className="cr-file-row__icon" aria-hidden="true">
            <FileKindIcon size={16} aria-hidden="true" />
          </div>
          <div className="cr-file-row__info">
            <span className="cr-file-row__name">{getFileDisplayName(file)}</span>
            <span className="cr-file-row__meta">
              {(file.sizeBytes / 1024).toFixed(0)} KB · {formatDate(file.createdAt)}
              {docuSealStatus && (
                <>
                  {' · '}
                  <span className={`cr-esign-badge cr-esign-badge--${docuSealStatus}`}>
                    eSign: {docuSealStatus}
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="cr-file-row__actions">
            {resolvedUrl ? (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--ghost ui-btn--sm"
              >
                View
              </a>
            ) : (
              <span className="ui-btn ui-btn--ghost ui-btn--sm" aria-disabled="true">
                Unavailable
              </span>
            )}
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={() => onDelete(file.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

export default CustomerRecord
