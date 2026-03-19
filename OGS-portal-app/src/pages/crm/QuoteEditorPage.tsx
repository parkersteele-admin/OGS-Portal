/**
 * src/pages/crm/QuoteEditorPage.tsx
 *
 * Full-page quote builder/editor.
 * Routes:
 *   /crm/quotes/new       → new blank quote
 *   /crm/quotes/:quoteId  → edit existing quote
 *
 * Features:
 *  - Customer dropdown (all active customers + leads loaded up front)
 *  - Auto-fill email / phone / address when customer selected
 *  - Product combobox per line item (auto-fills description + price)
 *  - Delivery fee, tank rental add-ons
 *  - Save draft, Preview PDF, Send to customer, Convert to order
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getQuote,
  createQuote,
  updateQuote,
  generateQuotePdf,
  sendQuote,
  convertQuoteToOrder,
} from '../../services/quoteService'
import { subscribeToCustomers } from '../../services/customerService'
import { getLeads } from '../../services/leadService'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatDate } from '../../utils/format'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { ProductCombobox } from '../../components/ui/ProductCombobox'
import { getProductDropdown, type ProductDropdownItem } from '../../services/productService'
import type { Quote, QuoteItem, QuoteStatus } from '../../types/crm'
import type { Customer } from '../../types/customer'
import type { Lead } from '../../types/crm'
import type { ProductCategory } from '../../types/product'
import './QuoteEditorPage.css'

// ── Types ─────────────────────────────────────────────────────────────────────

const PRODUCT_CATEGORIES: ProductCategory[] = ['CO₂ Cylinders', 'Nitrogen', 'Beer Gas', 'Propane', 'Rentals', 'Fees']

interface DraftLineItem {
  _id:         string
  productId:   string
  productName: string
  skuLabel:    string
  description: string
  quantity:    number
  basePrice:   number
  cost:        number
  minMarginPercent: number
  minPrice:    number
  marginPercent: number
  profit:      number
  unitPrice:   number
  amount:      number
}

interface RecipientOption {
  type:    'customer' | 'lead'
  id:      string
  label:   string   // company / display name
  email:   string
  phone:   string
  address: string   // formatted for display
}

const STATUS_BADGE: Record<QuoteStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' }> = {
  draft:    { label: 'Draft',    variant: 'neutral'  },
  sent:     { label: 'Sent',     variant: 'info'     },
  accepted: { label: 'Accepted', variant: 'success'  },
  declined: { label: 'Declined', variant: 'danger'   },
  expired:  { label: 'Expired',  variant: 'warning'  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_ROW = (): DraftLineItem => ({
  _id:         crypto.randomUUID(),
  productId:   '',
  productName: '',
  skuLabel:    '',
  description: '',
  quantity:    1,
  basePrice:   0,
  cost:        0,
  minMarginPercent: 0.2,
  minPrice:    0,
  marginPercent: 0,
  profit:      0,
  unitPrice:   0,
  amount:      0,
})

function normalizeMarginInput(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value > 1 ? value / 100 : value
  return Math.min(Math.max(normalized, 0), 0.95)
}

function calcMinPrice(cost: number, minMarginPercent: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(cost, 0) : 0
  const safeMargin = Math.min(Math.max(minMarginPercent, 0), 0.95)
  return parseFloat((safeCost / (1 - safeMargin)).toFixed(2))
}

function calcMarginPercent(price: number, cost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  return (price - cost) / price
}

function recalcRow(row: DraftLineItem): DraftLineItem {
  const quantity = Number.isFinite(row.quantity) ? Math.max(row.quantity, 0) : 0
  const cost = Number.isFinite(row.cost) ? Math.max(row.cost, 0) : 0
  const minMarginPercent = normalizeMarginInput(row.minMarginPercent)
  const minPrice = calcMinPrice(cost, minMarginPercent)

  const marginPercent = normalizeMarginInput(row.marginPercent)
  const calculatedUnitPrice = parseFloat((cost / (1 - marginPercent)).toFixed(2))
  const unitPrice = Number.isFinite(calculatedUnitPrice)
    ? calculatedUnitPrice
    : parseFloat((row.unitPrice || 0).toFixed(2))

  const amount = parseFloat((quantity * unitPrice).toFixed(2))
  const profit = parseFloat(((unitPrice - cost) * quantity).toFixed(2))

  return {
    ...row,
    quantity,
    cost,
    minMarginPercent,
    minPrice,
    marginPercent,
    unitPrice,
    amount,
    profit,
  }
}

function toQuoteItem(r: DraftLineItem): QuoteItem {
  return { productId: r.productId, description: r.description, quantity: r.quantity, unitPrice: r.unitPrice, amount: r.amount }
}

// ── Line item row ─────────────────────────────────────────────────────────────

interface LineItemRowProps {
  row:             DraftLineItem
  index:           number
  onChange:        (id: string, field: keyof DraftLineItem, val: string | number) => void
  onProductSelect: (id: string, p: ProductDropdownItem | null) => void
  onRemove:        (id: string) => void
  hasMarginViolation: boolean
  products?:       ProductDropdownItem[]
  disabled?:       boolean
}

const LineItemRow: React.FC<LineItemRowProps> = ({
  row,
  index,
  onChange,
  onProductSelect,
  onRemove,
  hasMarginViolation,
  products,
  disabled,
}) => {
  const handleNum = (field: 'quantity' | 'marginPercent') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(row._id, field, parseFloat(e.target.value) || 0)

  return (
    <div className={`qep-row${hasMarginViolation ? ' qep-row--warn' : ''}`}>
      <span className="qep-row__num">{index + 1}</span>

      <div className="qep-row__product">
        <ProductCombobox
          value={row.productId}
          onSelect={(p) => onProductSelect(row._id, p)}
          label=""
          placeholder="Select product…"
          products={products}
          disabled={disabled}
        />
        <input
          className="ui-input qep-row__desc"
          placeholder="Description (auto-filled or custom)"
          value={row.description}
          onChange={e => onChange(row._id, 'description', e.target.value)}
          disabled={disabled}
        />
      </div>

      <input className="ui-input qep-row__qty" type="number" min="0" step="0.01"
        placeholder="Qty" value={row.quantity || ''} onChange={handleNum('quantity')} disabled={disabled} />

      <span className="qep-row__metric">{formatCurrency(row.cost)}</span>

      <span className="qep-row__metric">{formatCurrency(row.basePrice)}</span>

      <div className="qep-row__margin-control">
        <input
          className="qep-row__margin-slider"
          type="range"
          min={Math.round(row.minMarginPercent * 100)}
          max={Math.max(90, Math.round(row.minMarginPercent * 100) + 40)}
          step={0.5}
          value={parseFloat((row.marginPercent * 100).toFixed(2))}
          onChange={handleNum('marginPercent')}
          disabled={disabled || !row.productId}
        />
        <input
          className="ui-input qep-row__margin-input"
          type="number"
          min={0}
          max={95}
          step={0.1}
          placeholder="Margin %"
          value={parseFloat((row.marginPercent * 100).toFixed(2)) || ''}
          onChange={handleNum('marginPercent')}
          disabled={disabled || !row.productId}
        />
      </div>

      <span className="qep-row__metric">{formatCurrency(row.unitPrice)}</span>

      <span className={`qep-row__metric${row.profit < 0 ? ' qep-row__metric--danger' : ''}`}>{formatCurrency(row.profit)}</span>

      <span className={`qep-row__metric${hasMarginViolation ? ' qep-row__metric--danger' : ''}`}>
        {(row.marginPercent * 100).toFixed(1)}%
      </span>

      <span className="qep-row__amount">{formatCurrency(row.amount)}</span>

      {hasMarginViolation && (
        <span className="qep-row__warning">
          Min {Math.round(row.minMarginPercent * 1000) / 10}% ({formatCurrency(row.minPrice)})
        </span>
      )}

      <button className="qep-row__remove" onClick={() => onRemove(row._id)} disabled={disabled}
        aria-label="Remove" title="Remove">✕</button>
    </div>
  )
}

// ── PDF preview modal ─────────────────────────────────────────────────────────

const PdfPreviewModal: React.FC<{ url: string; onClose: () => void }> = ({ url, onClose }) => (
  <Modal open onClose={onClose} title="Quote preview" size="lg">
    <div className="qep-pdf">
      <iframe src={url} className="qep-pdf__frame" title="Quote PDF" />
      <div className="qep-pdf__actions">
        <a href={url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--secondary ui-btn--sm">
          Open in new tab
        </a>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  </Modal>
)

// ── Main page ─────────────────────────────────────────────────────────────────

const QuoteEditorPage: React.FC = () => {
  const navigate      = useNavigate()
  const { quoteId }   = useParams<{ quoteId: string }>()
  const [searchParams] = useSearchParams()
  const isNew         = !quoteId || quoteId === 'new'
  const prefillLeadId = isNew ? (searchParams.get('leadId') ?? '') : ''
  const { user }      = useAuth()
  const queryClient   = useQueryClient()

  // ── Load recipients (customers + leads) ───────────────────────────────────

  const [recipients, setRecipients] = useState<RecipientOption[]>([])
  const [productMap, setProductMap] = useState<Record<string, ProductDropdownItem>>({})

  useEffect(() => {
    let mounted = true
    // Load customers real-time
    const unsub = subscribeToCustomers({ status: 'active' }, (customers) => {
      if (!mounted) return
      const customerOpts: RecipientOption[] = customers.map((c: Customer) => ({
        type:    'customer',
        id:      c.id,
        label:   c.name,
        email:   c.email ?? '',
        phone:   c.phone ?? '',
        address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
      }))
      // Merge leads once
      getLeads({}, { pageSize: 200 }).then((page) => {
        if (!mounted) return
        const leadOpts: RecipientOption[] = (page.data ?? []).map((l: Lead) => ({
          type:    'lead',
          id:      l.id,
          label:   l.company ?? l.name,
          email:   l.email ?? '',
          phone:   l.phone ?? '',
          address: '',
        }))
        setRecipients([...customerOpts, ...leadOpts])
      })
    })
    return () => { mounted = false; unsub() }
  }, [])

  const [productLoadError, setProductLoadError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | 'All'>('All')

  useEffect(() => {
    let mounted = true
    getProductDropdown()
      .then((items) => {
        if (!mounted) return
        setProductMap(Object.fromEntries(items.map((item) => [item.id, item])))
        setProductLoadError('')
      })
      .catch((err) => {
        if (!mounted) return
        setProductMap({})
        setProductLoadError(err instanceof Error ? err.message : 'Failed to load products')
      })
    return () => { mounted = false }
  }, [])

  // ── Load existing quote ───────────────────────────────────────────────────

  const [loadingQuote, setLoadingQuote] = useState(!isNew)
  const [loadError,    setLoadError]    = useState('')

  // ── Form state ────────────────────────────────────────────────────────────

  const [recipientId,    setRecipientId]    = useState(prefillLeadId)
  const [validUntil,     setValidUntil]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [reference,      setReference]      = useState('')
  const [rows,           setRows]           = useState<DraftLineItem[]>([EMPTY_ROW()])
  const [deliveryFee,    setDeliveryFee]    = useState(0)
  const [includeDelivery,setIncludeDelivery]= useState(false)
  const [rentalMonths,   setRentalMonths]   = useState(0)
  const [rentalRate,     setRentalRate]     = useState(0)
  const [includeRental,  setIncludeRental]  = useState(false)
  const [notes,          setNotes]          = useState('')
  const [pdfUrl,         setPdfUrl]         = useState<string | null>(null)
  const [pdfLoading,     setPdfLoading]     = useState(false)
  const [savedId,        setSavedId]        = useState<string | null>(isNew ? null : quoteId!)
  const [status,         setStatus]         = useState<QuoteStatus>('draft')
  const [error,          setError]          = useState<string | null>(null)

  // Load existing quote into form
  useEffect(() => {
    if (isNew) return
    setLoadingQuote(true)
    getQuote(quoteId!).then((q) => {
      // Try to match recipient from loaded list; fallback to raw id
      const rid = q.customerId ?? q.leadId ?? ''
      setRecipientId(rid)
      setRows(q.lineItems.map(item => ({
        _id:         crypto.randomUUID(),
        productId:   item.productId,
        productName: '',
        skuLabel:    '',
        description: item.description,
        quantity:    item.quantity,
        basePrice:   item.unitPrice,
        cost:        0,
        minMarginPercent: 0.2,
        minPrice:    0,
        marginPercent: 0,
        profit:      0,
        unitPrice:   item.unitPrice,
        amount:      item.amount,
      })).map(recalcRow))
      setNotes(q.notes ?? '')
      setStatus(q.status)
      if (q.validUntil) {
        setValidUntil((q.validUntil as { toDate(): Date }).toDate().toISOString().slice(0, 10))
      }
      setLoadingQuote(false)
    }).catch((e) => {
      setLoadError(e.message)
      setLoadingQuote(false)
    })
  }, [quoteId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selected recipient details (for auto-fill display) ───────────────────

  const selectedRecipient = useMemo(
    () => recipients.find(r => r.id === recipientId) ?? null,
    [recipients, recipientId],
  )

  // ── Computed totals ───────────────────────────────────────────────────────

  const subtotal = useMemo(
    () => parseFloat(rows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
    [rows],
  )
  const totalCost = useMemo(
    () => parseFloat(rows.reduce((s, r) => s + (r.cost * r.quantity), 0).toFixed(2)),
    [rows],
  )
  const totalLineProfit = useMemo(
    () => parseFloat(rows.reduce((s, r) => s + r.profit, 0).toFixed(2)),
    [rows],
  )
  const rentalTotal = useMemo(
    () => includeRental ? parseFloat((rentalRate * rentalMonths).toFixed(2)) : 0,
    [includeRental, rentalRate, rentalMonths],
  )
  const effectiveDelivery = includeDelivery ? deliveryFee : 0
  const total = parseFloat((subtotal + effectiveDelivery + rentalTotal).toFixed(2))
  const totalProfit = parseFloat((totalLineProfit + effectiveDelivery + rentalTotal).toFixed(2))
  const overallMarginPercent = total > 0 ? totalProfit / total : 0
  const marginViolations = useMemo(
    () => rows.filter((r) => r.productId && r.marginPercent + 0.0001 < r.minMarginPercent),
    [rows],
  )

  // ── Row helpers ───────────────────────────────────────────────────────────

  const handleRowChange = useCallback((id: string, field: keyof DraftLineItem, value: string | number) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r
      const nextValue = field === 'marginPercent'
        ? normalizeMarginInput(Number(value))
        : value
      return recalcRow({ ...r, [field]: nextValue })
    }))
  }, [])

  const handleProductSelect = useCallback((id: string, product: ProductDropdownItem | null) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r
      if (!product) {
        return recalcRow({
          ...r,
          productId: '',
          productName: '',
          skuLabel: '',
          cost: 0,
          basePrice: 0,
          minMarginPercent: 0.2,
          minPrice: 0,
          marginPercent: 0,
          unitPrice: 0,
        })
      }

      const baseMargin = calcMarginPercent(product.basePrice, product.cost)
      const marginPercent = Math.max(baseMargin, product.minMarginPercent)

      const updated: DraftLineItem = {
        ...r,
        productId:   product.id,
        productName: product.name,
        skuLabel:    product.sku,
        description: `${product.name}${product.unit ? ` (${product.unit})` : ''}`,
        basePrice:   product.basePrice,
        cost:        product.cost,
        minMarginPercent: product.minMarginPercent,
        minPrice:    product.minPrice,
        marginPercent,
      }
      return recalcRow(updated)
    }))
  }, [])

  const addRow  = () => setRows(prev => [...prev, EMPTY_ROW()])
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r._id !== id))

  useEffect(() => {
    if (Object.keys(productMap).length === 0) return
    setRows((prev) => prev.map((row) => {
      if (!row.productId) return row
      const product = productMap[row.productId]
      if (!product) return row
      const marginPercent = calcMarginPercent(row.unitPrice, product.cost)
      return recalcRow({
        ...row,
        productName: product.name,
        basePrice: product.basePrice,
        cost: product.cost,
        minMarginPercent: product.minMarginPercent,
        minPrice: product.minPrice,
        marginPercent,
      })
    }))
  }, [productMap])

  // Compute filtered products based on selected category
  const filteredProducts = useMemo(() => {
    const products = Object.values(productMap)
    if (selectedCategory === 'All') return products
    return products.filter((p) => p.category === selectedCategory)
  }, [productMap, selectedCategory])

  // ── Build payload ─────────────────────────────────────────────────────────

  const buildLineItems = (): QuoteItem[] => {
    const items: QuoteItem[] = rows
      .filter(r => r.description.trim() || r.amount > 0)
      .map(toQuoteItem)

    if (includeDelivery && deliveryFee > 0)
      items.push({ productId: 'delivery', description: 'Delivery fee', quantity: 1, unitPrice: deliveryFee, amount: deliveryFee })
    if (includeRental && rentalRate > 0 && rentalMonths > 0)
      items.push({ productId: 'rental', description: `Tank rental (${rentalMonths} mo.)`, quantity: rentalMonths, unitPrice: rentalRate, amount: rentalTotal })
    return items
  }

  const validate = (): string | null => {
    if (!recipientId) return 'Please select a customer or lead.'
    if (rows.every(r => !r.description.trim() && r.amount === 0)) return 'Add at least one line item.'
    if (marginViolations.length > 0) {
      return `Margin is below minimum on ${marginViolations.length} line item${marginViolations.length === 1 ? '' : 's'}.`
    }
    if (!validUntil) return 'Please set a valid-until date.'
    return null
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const err = validate(); if (err) throw new Error(err)
      const rec = selectedRecipient
      const lineItems = buildLineItems()
      const payload = {
        lineItems,
        validUntil: new Date(validUntil),
        notes:      notes.trim() || undefined,
        createdBy:  user!.id,
        customerId: rec?.type === 'customer' ? rec.id : undefined,
        leadId:     rec?.type === 'lead'     ? rec.id : undefined,
      }
      if (savedId) {
        await updateQuote(savedId, { ...payload, status } as unknown as Partial<Omit<Quote, 'id' | 'createdAt'>>)
        return savedId
      }
      return createQuote(payload)
    },
    onSuccess: (id) => {
      setSavedId(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      if (isNew) navigate(`/crm/quotes/${id}`, { replace: true })
    },
    onError: (e: Error) => setError(e.message),
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      let id = savedId
      if (!id) id = await saveMutation.mutateAsync()
      setPdfLoading(true)
      try { const url = await generateQuotePdf(id!); setPdfUrl(url) }
      finally { setPdfLoading(false) }
    },
    onError: (e: Error) => { setError(e.message); setPdfLoading(false) },
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      let id = savedId; if (!id) id = await saveMutation.mutateAsync()
      await sendQuote(id!)
      // Generate PDF + email to customer — best-effort so network issues don't block the status update
      await generateQuotePdf(id!).catch((err) => console.warn('PDF/email step failed:', err))
      setStatus('sent')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const convertMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      if (!savedId) throw new Error('Save the quote before converting.')
      if (selectedRecipient?.type !== 'customer') throw new Error('Convert requires a customer (not a lead).')
      const firstRow = rows.find(r => r.unitPrice > 0)
      if (!firstRow) throw new Error('No line item with a unit price.')
      return convertQuoteToOrder(savedId, selectedRecipient.id, firstRow.unitPrice)
    },
    onSuccess: () => {
      setStatus('accepted')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      navigate('/ops/orders')
    },
    onError: (e: Error) => setError(e.message),
  })

  const isBusy = saveMutation.isPending || previewMutation.isPending || sendMutation.isPending || convertMutation.isPending
  const isReadOnly = status === 'accepted' || status === 'declined'

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingQuote) return <div className="qep-loading">Loading quote…</div>
  if (loadError) return <div className="qep-load-error">Error: {loadError}</div>

  return (
    <div className="qep-page">

      {/* Sticky page header */}
      <div className="qep-header">
        <div className="qep-header__left">
          <button className="qep-back" onClick={() => navigate('/crm/quotes')} aria-label="Back to quotes">
            ← Quotes
          </button>
          <h1 className="qep-title">
            {isNew ? 'New Quote' : (savedId ? `Quote` : 'Edit Quote')}
          </h1>
          {status !== 'draft' && (
            <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>
          )}
        </div>
        <div className="qep-header__actions">
          {!isReadOnly && (
            <>
              <Button variant="ghost" size="sm" loading={saveMutation.isPending} disabled={isBusy}
                onClick={() => saveMutation.mutate()}>
                💾 Save draft
              </Button>
              <Button variant="secondary" size="sm" loading={pdfLoading || previewMutation.isPending} disabled={isBusy}
                onClick={() => previewMutation.mutate()}>
                👁 Preview PDF
              </Button>
              <Button variant="primary" size="sm" loading={sendMutation.isPending} disabled={isBusy || status === 'sent'}
                onClick={() => sendMutation.mutate()}>
                ✉️ Send
              </Button>
            </>
          )}
          {(status === 'sent' || !isReadOnly) && (
            <Button variant="success" size="sm" loading={convertMutation.isPending} disabled={isBusy}
              onClick={() => convertMutation.mutate()}>
              ✓ Convert to order
            </Button>
          )}
        </div>
      </div>

      {error && <div className="qep-error" role="alert">{error}</div>}

      {marginViolations.length > 0 && (
        <div className="qep-error qep-error--warn" role="alert">
          {marginViolations.length} line item{marginViolations.length === 1 ? '' : 's'} below minimum margin. Raise margin or lower cost before saving.
        </div>
      )}

      <div className="qep-body">

        {/* ── Two-column layout: form left, summary right ── */}
        <div className="qep-layout">
          <div className="qep-main">

            {/* Bill to */}
            <section className="qep-section">
              <h2 className="qep-section__title">Bill to</h2>
              <div className="qep-recipient-row">
                <div className="ui-field qep-recipient-select">
                  <label className="ui-field__label" htmlFor="qep-recipient">Customer / Lead *</label>
                  <select
                    id="qep-recipient"
                    className="qep-select"
                    value={recipientId}
                    onChange={e => setRecipientId(e.target.value)}
                    disabled={isReadOnly}
                  >
                    <option value="">— Select customer or lead —</option>
                    {recipients.filter(r => r.type === 'customer').length > 0 && (
                      <optgroup label="Customers">
                        {recipients
                          .filter(r => r.type === 'customer')
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map(r => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                      </optgroup>
                    )}
                    {recipients.filter(r => r.type === 'lead').length > 0 && (
                      <optgroup label="Leads">
                        {recipients
                          .filter(r => r.type === 'lead')
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map(r => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* Auto-filled details */}
                {selectedRecipient && (
                  <div className="qep-recipient-info">
                    <span className={`qep-type-tag qep-type-tag--${selectedRecipient.type}`}>
                      {selectedRecipient.type === 'customer' ? 'Customer' : 'Lead'}
                    </span>
                    {selectedRecipient.email && <span>{selectedRecipient.email}</span>}
                    {selectedRecipient.phone && <span>{selectedRecipient.phone}</span>}
                    {selectedRecipient.address && <span>{selectedRecipient.address}</span>}
                  </div>
                )}
              </div>
            </section>

            {/* Quote details */}
            <section className="qep-section">
              <h2 className="qep-section__title">Quote details</h2>
              <div className="qep-meta-grid">
                <Input label="Reference / project name" value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="e.g. Propane supply 2026" disabled={isReadOnly} />
                <Input label="Valid until" type="date" value={validUntil}
                  onChange={e => setValidUntil(e.target.value)} disabled={isReadOnly} />
              </div>
            </section>

            {/* Line items */}
            <section className="qep-section">
              <h2 className="qep-section__title">Line items</h2>
              {productLoadError && (
                <div className="qep-error" style={{ color: 'var(--color-error, #c0392b)', marginBottom: 'var(--space-4)' }}>
                  Failed to load products: {productLoadError}
                </div>
              )}
              {Object.keys(productMap).length > 0 && (
                <div className="qep-filter-bar" style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {(['All', ...PRODUCT_CATEGORIES] as const).map((cat) => (
                    <button
                      key={cat}
                      className={`ui-btn ui-btn--sm${selectedCategory === cat ? ' ui-btn--brand' : ' ui-btn--secondary'}`}
                      onClick={() => setSelectedCategory(cat)}
                      type="button"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
              <div className="qep-lines-table">
                <div className="qep-rows-header">
                  <span />
                  <span className="qep-col-label">Product / Description</span>
                  <span className="qep-col-label">Qty</span>
                  <span className="qep-col-label">Cost</span>
                  <span className="qep-col-label">Base</span>
                  <span className="qep-col-label">Margin</span>
                  <span className="qep-col-label">Final Price</span>
                  <span className="qep-col-label">Profit</span>
                  <span className="qep-col-label">Margin %</span>
                  <span className="qep-col-label qep-col-label--right">Amount</span>
                  <span />
                </div>
                <div className="qep-rows">
                  {rows.map((row, i) => (
                    <LineItemRow key={row._id} row={row} index={i}
                      onChange={handleRowChange} onProductSelect={handleProductSelect}
                      onRemove={removeRow}
                      hasMarginViolation={Boolean(row.productId) && row.marginPercent + 0.0001 < row.minMarginPercent}
                      products={filteredProducts}
                      disabled={isReadOnly} />
                  ))}
                </div>
              </div>
              {!isReadOnly && (
                <button className="qep-add-row" onClick={addRow}>+ Add line item</button>
              )}
            </section>

            {/* Additional items */}
            <section className="qep-section">
              <h2 className="qep-section__title">Additional items</h2>

              <div className="qep-addon">
                <label className="qep-addon__check">
                  <input type="checkbox" checked={includeDelivery}
                    onChange={e => setIncludeDelivery(e.target.checked)} disabled={isReadOnly} />
                  <span>Delivery fee</span>
                </label>
                {includeDelivery && (
                  <div className="qep-addon__fields">
                    <Input label="Fee ($)" type="number" min="0" step="0.01" value={deliveryFee || ''}
                      onChange={e => setDeliveryFee(parseFloat(e.target.value) || 0)} disabled={isReadOnly} />
                  </div>
                )}
              </div>

              <div className="qep-addon">
                <label className="qep-addon__check">
                  <input type="checkbox" checked={includeRental}
                    onChange={e => setIncludeRental(e.target.checked)} disabled={isReadOnly} />
                  <span>Tank rental</span>
                </label>
                {includeRental && (
                  <div className="qep-addon__fields qep-addon__fields--two">
                    <Input label="Rate ($/month)" type="number" min="0" step="0.01" value={rentalRate || ''}
                      onChange={e => setRentalRate(parseFloat(e.target.value) || 0)} disabled={isReadOnly} />
                    <Input label="Months" type="number" min="1" step="1" value={rentalMonths || ''}
                      onChange={e => setRentalMonths(parseInt(e.target.value, 10) || 0)} disabled={isReadOnly} />
                  </div>
                )}
              </div>
            </section>

            {/* Notes */}
            <section className="qep-section">
              <h2 className="qep-section__title">Notes &amp; terms</h2>
              <textarea className="ui-input qep-textarea" rows={4} value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Payment terms, validity conditions, special notes…"
                disabled={isReadOnly} />
            </section>

          </div>{/* end .qep-main */}

          {/* Sidebar summary */}
          <aside className="qep-sidebar">
            <div className="qep-summary">
              <h3 className="qep-summary__title">Summary</h3>
              <div className="qep-summary__rows">
                <div className="qep-summary__row"><span>Revenue (products)</span><span>{formatCurrency(subtotal)}</span></div>
                <div className="qep-summary__row"><span>Total cost</span><span>{formatCurrency(totalCost)}</span></div>
                <div className="qep-summary__row"><span>Line profit</span><span>{formatCurrency(totalLineProfit)}</span></div>
                {includeDelivery && effectiveDelivery > 0 && (
                  <div className="qep-summary__row">
                    <span>Delivery fee</span>
                    <span>{formatCurrency(effectiveDelivery)}</span>
                  </div>
                )}
                {includeRental && rentalTotal > 0 && (
                  <div className="qep-summary__row">
                    <span>Tank rental</span>
                    <span>{formatCurrency(rentalTotal)}</span>
                  </div>
                )}
                <div className="qep-summary__row qep-summary__row--total">
                  <span>Total revenue</span>
                  <span>{formatCurrency(total)}</span>
                </div>
                <div className="qep-summary__row">
                  <span>Total profit</span>
                  <span>{formatCurrency(totalProfit)}</span>
                </div>
                <div className="qep-summary__row">
                  <span>Overall margin</span>
                  <span>{(overallMarginPercent * 100).toFixed(1)}%</span>
                </div>
              </div>

              {selectedRecipient && (
                <div className="qep-summary__bill-to">
                  <p className="qep-summary__label">Bill to</p>
                  <p className="qep-summary__name">{selectedRecipient.label}</p>
                  {selectedRecipient.email && <p>{selectedRecipient.email}</p>}
                  {selectedRecipient.address && <p>{selectedRecipient.address}</p>}
                </div>
              )}

              {validUntil && (
                <div className="qep-summary__meta">
                  <p className="qep-summary__label">Valid until</p>
                  <p>{formatDate(validUntil)}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {pdfUrl && <PdfPreviewModal url={pdfUrl} onClose={() => setPdfUrl(null)} />}
    </div>
  )
}

export default QuoteEditorPage
