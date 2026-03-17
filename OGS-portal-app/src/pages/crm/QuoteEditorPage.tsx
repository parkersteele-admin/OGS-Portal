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
import { useNavigate, useParams } from 'react-router-dom'
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
import type { ProductDropdownItem } from '../../services/productService'
import type { Quote, QuoteItem, QuoteStatus } from '../../types/crm'
import type { Customer } from '../../types/customer'
import type { Lead } from '../../types/crm'
import './QuoteEditorPage.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DraftLineItem {
  _id:         string
  productId:   string
  skuLabel:    string
  description: string
  quantity:    number
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
  skuLabel:    '',
  description: '',
  quantity:    1,
  unitPrice:   0,
  amount:      0,
})

function rowAmount(r: DraftLineItem) {
  return parseFloat((r.quantity * r.unitPrice).toFixed(2))
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
  disabled?:       boolean
}

const LineItemRow: React.FC<LineItemRowProps> = ({ row, index, onChange, onProductSelect, onRemove, disabled }) => {
  const handleNum = (field: 'quantity' | 'unitPrice') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange(row._id, field, parseFloat(e.target.value) || 0)

  return (
    <div className="qep-row">
      <span className="qep-row__num">{index + 1}</span>

      <div className="qep-row__product">
        <ProductCombobox
          value={row.productId}
          onSelect={(p) => onProductSelect(row._id, p)}
          label=""
          placeholder="Select product…"
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

      <input className="ui-input qep-row__price" type="number" min="0" step="0.01"
        placeholder="Unit price" value={row.unitPrice || ''} onChange={handleNum('unitPrice')} disabled={disabled} />

      <span className="qep-row__amount">{formatCurrency(row.amount)}</span>

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
  const isNew         = !quoteId || quoteId === 'new'
  const { user }      = useAuth()
  const queryClient   = useQueryClient()

  // ── Load recipients (customers + leads) ───────────────────────────────────

  const [recipients, setRecipients] = useState<RecipientOption[]>([])

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

  // ── Load existing quote ───────────────────────────────────────────────────

  const [loadingQuote, setLoadingQuote] = useState(!isNew)
  const [loadError,    setLoadError]    = useState('')

  // ── Form state ────────────────────────────────────────────────────────────

  const [recipientId,    setRecipientId]    = useState('')
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
        skuLabel:    '',
        description: item.description,
        quantity:    item.quantity,
        unitPrice:   item.unitPrice,
        amount:      item.amount,
      })))
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
  const rentalTotal = useMemo(
    () => includeRental ? parseFloat((rentalRate * rentalMonths).toFixed(2)) : 0,
    [includeRental, rentalRate, rentalMonths],
  )
  const effectiveDelivery = includeDelivery ? deliveryFee : 0
  const total = parseFloat((subtotal + effectiveDelivery + rentalTotal).toFixed(2))

  // ── Row helpers ───────────────────────────────────────────────────────────

  const handleRowChange = useCallback((id: string, field: keyof DraftLineItem, value: string | number) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r
      const updated = { ...r, [field]: value }
      updated.amount = rowAmount(updated)
      return updated
    }))
  }, [])

  const handleProductSelect = useCallback((id: string, product: ProductDropdownItem | null) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r
      if (!product) return { ...r, productId: '', skuLabel: '' }
      const updated: DraftLineItem = {
        ...r,
        productId:   product.id,
        skuLabel:    product.sku,
        description: `${product.name}${product.unit ? ` (${product.unit})` : ''}`,
        unitPrice:   product.basePrice,
      }
      updated.amount = rowAmount(updated)
      return updated
    }))
  }, [])

  const addRow  = () => setRows(prev => [...prev, EMPTY_ROW()])
  const removeRow = (id: string) => setRows(prev => prev.filter(r => r._id !== id))

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
              <div className="qep-rows-header">
                <span />
                <span className="qep-col-label">Product / Description</span>
                <span className="qep-col-label">Qty</span>
                <span className="qep-col-label">Unit price</span>
                <span className="qep-col-label qep-col-label--right">Amount</span>
                <span />
              </div>
              <div className="qep-rows">
                {rows.map((row, i) => (
                  <LineItemRow key={row._id} row={row} index={i}
                    onChange={handleRowChange} onProductSelect={handleProductSelect}
                    onRemove={removeRow} disabled={isReadOnly} />
                ))}
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
                <div className="qep-summary__row">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
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
                  <span>Total</span>
                  <span>{formatCurrency(total)}</span>
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
