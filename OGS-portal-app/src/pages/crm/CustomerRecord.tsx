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

import React, { useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
import { db } from '../../lib/firebase'
import {
  useCustomer,
  useCustomerOrders,
  useCustomerInvoices,
  queryKeys,
} from '../../hooks/queries'
import { useCustomerTanks } from '../../hooks/useCustomerTanks'
import { useAuth } from '../../hooks/useAuth'
import { updateCustomer } from '../../services/customerService'
import { getInvoices } from '../../services/invoiceService'
import { getFilesForEntity, uploadFile, deleteFile } from '../../services/fileService'
import { formatCurrency, formatDate, formatRelative } from '../../utils/format'
import { formatAddress, getGoogleMapsUrl } from '../../utils/addressUtils'
import { Card, CardHeader, CardBody } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import type { Customer, CustomerStatus } from '../../types/customer'
import type { ContactLog, ContactMethod } from '../../types/crm'
import type { AppFile } from '../../types/file'
import './CustomerRecord.css'

// ── Extended types for CRM-specific Firestore fields ─────────────────────────

interface CustomerRecord extends Customer {
  isPriority?: boolean
  holdReason?: string
  deliveryNotes?: string
  accessInstructions?: string
}

interface ContactLogWithFollowUp extends ContactLog {
  followUpAt?: Timestamp | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'history' | 'notes' | 'documents'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'history',   label: 'Contact History' },
  { key: 'notes',     label: 'Account Notes' },
  { key: 'documents', label: 'Documents' },
]

const STATUS_BADGE: Record<CustomerStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' }> = {
  active:   { label: 'Active',   variant: 'success' },
  inactive: { label: 'Inactive', variant: 'neutral' },
  hold:     { label: 'On Hold',  variant: 'warning' },
}

const METHOD_ICONS: Record<ContactMethod, string> = {
  call:       '📞',
  email:      '✉️',
  text:       '💬',
  'in-person':'🤝',
  other:      '📝',
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

const ORDER_BADGE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'> = {
  pending:    'warning',
  scheduled:  'info',
  assigned:   'info',
  'in-transit':'brand',
  delivered:  'success',
  invoiced:   'neutral',
  paid:       'success',
  cancelled:  'danger',
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
}

const EditCustomerModal: React.FC<EditCustomerModalProps> = ({ customer, onClose, onSave, saving }) => {
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
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save changes
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

// ── Main Component ────────────────────────────────────────────────────────────

const CustomerRecord: React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate       = useNavigate()
  const queryClient    = useQueryClient()
  const { user }       = useAuth()

  const [activeTab,     setActiveTab]     = useState<TabKey>('overview')
  const [showEdit,      setShowEdit]      = useState(false)
  const [showLogModal,  setShowLogModal]  = useState(false)

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

  // Recent invoices (last 5)
  const { data: invoicesPage } = useCustomerInvoices(customerId, 5)
  const recentInvoices = invoicesPage?.data ?? []

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

  // Customer files (fetched when documents tab active)
  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ['files', 'customer', customerId],
    queryFn: () => getFilesForEntity('customer', customerId!),
    enabled: !!customerId && activeTab === 'documents',
    staleTime: 60_000,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

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
        <Button variant="ghost" onClick={() => navigate('/crm/customers')}>
          ← Back to customers
        </Button>
      </div>
    )
  }

  const cr = customer as CustomerRecord
  const mapsUrl = cr.lat && cr.lng
    ? getGoogleMapsUrl(cr.lat, cr.lng, cr.name)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(cr))}`
  const statusCfg = STATUS_BADGE[cr.status]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="cr-page">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="cr-header">
        <div className="cr-header__back">
          <button className="cr-back-btn" onClick={() => navigate('/crm/customers')}>
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
            {cr.isPriority && (
              <span className="cr-flag cr-flag--priority" title="Priority account">
                ⭐ Priority
              </span>
            )}
            {cr.status === 'hold' && (
              <span className="cr-flag cr-flag--hold" title="Account on hold">
                🚫 Credit Hold
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
              <span className="cr-contact-item__icon">✉️</span>
              <a href={`mailto:${cr.email}`} className="cr-contact-item__value">{cr.email}</a>
            </div>
            <div className="cr-contact-item">
              <span className="cr-contact-item__icon">📞</span>
              <a href={`tel:${cr.phone}`} className="cr-contact-item__value">{cr.phone}</a>
            </div>
            <div className="cr-contact-item">
              <span className="cr-contact-item__icon">📍</span>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cr-contact-item__value"
              >
                {formatAddress(cr)}
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
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th>Status</th>
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
                          <Badge variant={ORDER_BADGE[order.status] ?? 'neutral'}>
                            {order.status}
                          </Badge>
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
                <table className="cr-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Status</th>
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
              onClick={() => navigate(`/ops/billing?new=1&customerId=${customerId}`)}
            >
              + New invoice
            </Button>
          </div>
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
                    {METHOD_ICONS[log.method] ?? '📝'}
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

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showEdit && (
        <EditCustomerModal
          customer={cr}
          onClose={() => setShowEdit(false)}
          onSave={handleEditSave}
          saving={saveMutation.isPending}
        />
      )}

      {showLogModal && (
        <LogInteractionModal
          onClose={() => setShowLogModal(false)}
          onSubmit={async (form) => { await logMutation.mutateAsync(form) }}
          saving={logMutation.isPending}
        />
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
  const docuSealStatus = file.metadata?.docuSealStatus as string | undefined
  const isContract = file.fileType === 'contract'
  const isSigned   = file.fileType === 'signature' || docuSealStatus === 'completed'

  return (
    <Card className="cr-file-row">
      <CardBody>
        <div className="cr-file-row__body">
          <div className="cr-file-row__icon" aria-hidden="true">
            {isContract ? '📄' : isSigned ? '✅' : '📎'}
          </div>
          <div className="cr-file-row__info">
            <span className="cr-file-row__name">{file.fileName}</span>
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
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--ghost ui-btn--sm"
            >
              Download
            </a>
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
