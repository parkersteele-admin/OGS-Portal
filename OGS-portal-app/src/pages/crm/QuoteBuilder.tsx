/**
 * src/pages/crm/QuoteBuilder.tsx
 *
 * CRM Quotes page — list view + builder slide-in.
 * Route: /crm/quotes
 *
 * Features:
 *  - Quote list table (draft/sent/accepted/declined/expired)
 *  - Slide-in builder panel: customer/lead typeahead, line items,
 *    delivery fee, tank rental, live pricing, notes/terms
 *  - Save draft, Preview PDF (modal), Send to customer, Convert to order
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createQuote,
  updateQuote,
  getQuotes,
  generateQuotePdf,
  sendQuote,
  convertQuoteToOrder,
  deleteQuote,
} from '../../services/quoteService'
import { searchCustomers } from '../../services/customerService'
import { getLeads } from '../../services/leadService'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatDate, formatRelative } from '../../utils/format'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { ProductCombobox } from '../../components/ui/ProductCombobox'
import type { ProductDropdownItem } from '../../services/productService'
import type { Quote, QuoteItem, QuoteStatus } from '../../types/crm'
import type { Customer } from '../../types/customer'
import type { Lead } from '../../types/crm'
import './QuoteBuilder.css'

// ── Types ─────────────────────────────────────────────────────────────────────

/** A draft line item row — productId is optional while typing */
interface DraftLineItem {
  _id:         string     // local key for list reconciliation
  productId:   string
  skuLabel:    string     // e.g. "CO2-20LB" shown as badge when product picked
  description: string
  quantity:    number
  unitPrice:   number
  amount:      number
}

interface RecipientOption {
  type:  'customer' | 'lead'
  id:    string
  label: string          // display name
  sub:   string          // email / company
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<QuoteStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' }> = {
  draft:    { label: 'Draft',    variant: 'neutral'  },
  sent:     { label: 'Sent',     variant: 'info'     },
  accepted: { label: 'Accepted', variant: 'success'  },
  declined: { label: 'Declined', variant: 'danger'   },
  expired:  { label: 'Expired',  variant: 'warning'  },
}

const EMPTY_ROW = (): DraftLineItem => ({
  _id:         crypto.randomUUID(),
  productId:   '',
  skuLabel:    '',
  description: '',
  quantity:    1,
  unitPrice:   0,
  amount:      0,
})

function rowAmount(row: DraftLineItem): number {
  return parseFloat((row.quantity * row.unitPrice).toFixed(2))
}

function toQuoteItem(row: DraftLineItem): QuoteItem {
  return {
    productId:   row.productId,
    description: row.description,
    quantity:    row.quantity,
    unitPrice:   row.unitPrice,
    amount:      row.amount,
  }
}

// ── RecipientSearch ───────────────────────────────────────────────────────────

interface RecipientSearchProps {
  value:    RecipientOption | null
  onChange: (v: RecipientOption | null) => void
  disabled?: boolean
}

const RecipientSearch: React.FC<RecipientSearchProps> = ({ value, onChange, disabled }) => {
  const [query,   setQuery]   = useState(value?.label ?? '')
  const [options, setOptions] = useState<RecipientOption[]>([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync when value prop changes externally
  useEffect(() => {
    setQuery(value?.label ?? '')
  }, [value?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const search = useCallback(async (term: string) => {
    if (term.length < 2) { setOptions([]); setOpen(false); return }
    setLoading(true)
    try {
      const [customers, leadsPage] = await Promise.all([
        searchCustomers(term),
        getLeads({}, { pageSize: 10 }),
      ])
      const lower = term.toLowerCase()
      const filteredLeads = (leadsPage.data ?? []).filter(
        l => l.name.toLowerCase().includes(lower) ||
             (l.company ?? '').toLowerCase().includes(lower) ||
             l.email.toLowerCase().includes(lower),
      )
      const opts: RecipientOption[] = [
        ...customers.map((c: Customer) => ({
          type: 'customer' as const,
          id:   c.id,
          label: c.name,
          sub:  c.email,
        })),
        ...filteredLeads.map((l: Lead) => ({
          type: 'lead' as const,
          id:   l.id,
          label: l.company ?? l.name,
          sub:  l.email,
        })),
      ]
      setOptions(opts)
      setOpen(opts.length > 0)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    onChange(null)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(v), 250)
  }

  const handleSelect = (opt: RecipientOption) => {
    onChange(opt)
    setQuery(opt.label)
    setOpen(false)
  }

  return (
    <div className="qb-typeahead" ref={containerRef}>
      <input
        className={`ui-input qb-typeahead__input${value ? ' qb-typeahead__input--selected' : ''}`}
        value={query}
        onChange={handleInput}
        onFocus={() => options.length > 0 && setOpen(true)}
        placeholder="Search customers or leads…"
        disabled={disabled}
        autoComplete="off"
      />
      {loading && <span className="qb-typeahead__spinner" />}
      {value && (
        <button className="qb-typeahead__clear" onClick={() => { onChange(null); setQuery('') }} aria-label="Clear">✕</button>
      )}
      {open && (
        <ul className="qb-typeahead__dropdown" role="listbox">
          {options.map(opt => (
            <li
              key={`${opt.type}-${opt.id}`}
              className="qb-typeahead__option"
              role="option"
              onMouseDown={() => handleSelect(opt)}
            >
              <span className="qb-typeahead__option-label">{opt.label}</span>
              <span className="qb-typeahead__option-meta">
                <span className={`qb-type-tag qb-type-tag--${opt.type}`}>
                  {opt.type === 'customer' ? 'Customer' : 'Lead'}
                </span>
                {opt.sub}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── LineItemRow ───────────────────────────────────────────────────────────────

interface LineItemRowProps {
  row:             DraftLineItem
  index:           number
  onChange:        (id: string, field: keyof DraftLineItem, value: string | number) => void
  onProductSelect: (id: string, product: ProductDropdownItem | null) => void
  onRemove:        (id: string) => void
  disabled?:       boolean
}

const LineItemRow: React.FC<LineItemRowProps> = ({ row, index, onChange, onProductSelect, onRemove, disabled }) => {
  const handleNum = (field: 'quantity' | 'unitPrice') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 0
      onChange(row._id, field, v)
    }

  return (
    <div className="qb-row">
      <span className="qb-row__num">{index + 1}</span>

      <div className="qb-row__product">
        <ProductCombobox
          value={row.productId}
          onSelect={(p) => onProductSelect(row._id, p)}
          label=""
          placeholder="Select product…"
          disabled={disabled}
        />
        <input
          className="ui-input qb-row__desc"
          placeholder="Description (auto-filled or custom)"
          value={row.description}
          onChange={e => onChange(row._id, 'description', e.target.value)}
          disabled={disabled}
        />
      </div>

      <input
        className="ui-input qb-row__qty"
        type="number"
        min="0"
        step="0.01"
        placeholder="Qty"
        value={row.quantity || ''}
        onChange={handleNum('quantity')}
        disabled={disabled}
      />

      <input
        className="ui-input qb-row__price"
        type="number"
        min="0"
        step="0.01"
        placeholder="Unit price"
        value={row.unitPrice || ''}
        onChange={handleNum('unitPrice')}
        disabled={disabled}
      />

      <span className="qb-row__amount">{formatCurrency(row.amount)}</span>

      <button
        className="qb-row__remove"
        onClick={() => onRemove(row._id)}
        aria-label="Remove line item"
        title="Remove"
        disabled={disabled}
      >
        ✕
      </button>
    </div>
  )
}

// ── PdfPreviewModal ───────────────────────────────────────────────────────────

interface PdfPreviewModalProps {
  url:     string
  onClose: () => void
}

const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({ url, onClose }) => (
  <Modal open onClose={onClose} title="Quote preview" size="lg">
    <div className="qb-pdf-preview">
      <iframe
        src={url}
        className="qb-pdf-preview__frame"
        title="Quote PDF preview"
      />
      <div className="qb-pdf-preview__actions">
        <a href={url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--secondary ui-btn--sm">
          Open in new tab
        </a>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  </Modal>
)

// ── QuoteBuilderPanel ─────────────────────────────────────────────────────────

interface QuoteBuilderPanelProps {
  editQuote:   Quote | null     // null = new quote
  prefillLeadId?: string        // from ?leadId= query param
  onClose:     () => void
  onSaved:     (id: string) => void
}

const QuoteBuilderPanel: React.FC<QuoteBuilderPanelProps> = ({
  editQuote, prefillLeadId, onClose, onSaved,
}) => {
  const { user }      = useAuth()
  const queryClient   = useQueryClient()

  // ── Form state ────────────────────────────────────────────────────────────

  const [recipient,      setRecipient]      = useState<RecipientOption | null>(null)
  const [name,           setName]           = useState('')
  const [validUntil,     setValidUntil]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [rows,           setRows]           = useState<DraftLineItem[]>([EMPTY_ROW()])
  const [deliveryFee,    setDeliveryFee]    = useState(0)
  const [includeDelivery,setIncludeDelivery]= useState(false)
  const [rentalMonths,   setRentalMonths]   = useState(0)
  const [rentalRate,     setRentalRate]     = useState(0)
  const [includeRental,  setIncludeRental]  = useState(false)
  const [notes,          setNotes]          = useState('')
  const [pdfUrl,         setPdfUrl]         = useState<string | null>(null)
  const [pdfLoading,     setPdfLoading]     = useState(false)
  const [savedId,        setSavedId]        = useState<string | null>(editQuote?.id ?? null)
  const [status,         setStatus]         = useState<QuoteStatus>(editQuote?.status ?? 'draft')
  const [error,          setError]          = useState<string | null>(null)

  // Pre-fill from edit quote
  useEffect(() => {
    if (!editQuote) return
    // Set recipient
    if (editQuote.customerId) {
      setRecipient({ type: 'customer', id: editQuote.customerId, label: editQuote.customerId, sub: '' })
    } else if (editQuote.leadId) {
      setRecipient({ type: 'lead', id: editQuote.leadId, label: editQuote.leadId, sub: '' })
    }
    setRows(
      editQuote.lineItems.map(item => ({
        _id:         crypto.randomUUID(),
        productId:   item.productId,
        skuLabel:    '',
        description: item.description,
        quantity:    item.quantity,
        unitPrice:   item.unitPrice,
        amount:      item.amount,
      }))
    )
    setNotes(editQuote.notes ?? '')
    setStatus(editQuote.status)
    if (editQuote.validUntil) {
      setValidUntil((editQuote.validUntil as { toDate(): Date }).toDate().toISOString().slice(0, 10))
    }
  }, [editQuote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill leadId from query param
  useEffect(() => {
    if (prefillLeadId && !editQuote) {
      setRecipient({ type: 'lead', id: prefillLeadId, label: `Lead ${prefillLeadId}`, sub: '' })
    }
  }, [prefillLeadId, editQuote])

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

  const handleRowChange = useCallback(
    (id: string, field: keyof DraftLineItem, value: string | number) => {
      setRows(prev => prev.map(r => {
        if (r._id !== id) return r
        const updated = { ...r, [field]: value }
        updated.amount = rowAmount(updated)
        return updated
      }))
    },
    [],
  )

  // Auto-fill description + unitPrice when a product is chosen from the catalog
  const handleProductSelect = useCallback(
    (id: string, product: ProductDropdownItem | null) => {
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
    },
    [],
  )

  const addRow = () => setRows(prev => [...prev, EMPTY_ROW()])
  const removeRow = (id: string) =>
    setRows(prev => prev.filter(r => r._id !== id))

  // ── Build payload ─────────────────────────────────────────────────────────

  const buildLineItems = (): QuoteItem[] => {
    const items: QuoteItem[] = rows
      .filter(r => r.description.trim() || r.amount > 0)
      .map(toQuoteItem)

    if (includeDelivery && deliveryFee > 0) {
      items.push({
        productId:   'delivery',
        description: 'Delivery fee',
        quantity:    1,
        unitPrice:   deliveryFee,
        amount:      deliveryFee,
      })
    }
    if (includeRental && rentalRate > 0 && rentalMonths > 0) {
      items.push({
        productId:   'rental',
        description: `Tank rental (${rentalMonths} month${rentalMonths !== 1 ? 's' : ''})`,
        quantity:    rentalMonths,
        unitPrice:   rentalRate,
        amount:      rentalTotal,
      })
    }
    return items
  }

  const validate = (): string | null => {
    if (!recipient) return 'Please select a customer or lead.'
    if (rows.every(r => !r.description.trim() && r.amount === 0)) return 'Add at least one line item.'
    if (!validUntil) return 'Please set a valid-until date.'
    return null
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const err = validate()
      if (err) throw new Error(err)

      const lineItems = buildLineItems()
      const payload = {
        lineItems,
        validUntil: new Date(validUntil),
        notes:      notes.trim() || undefined,
        createdBy:  user!.id,
        customerId: recipient!.type === 'customer' ? recipient!.id : undefined,
        leadId:     recipient!.type === 'lead'     ? recipient!.id : undefined,
      }

      if (savedId) {
        await updateQuote(savedId, { ...payload, status } as unknown as Partial<Omit<Quote, 'id' | 'createdAt'>>)
        return savedId
      } else {
        return createQuote(payload)
      }
    },
    onSuccess: (id) => {
      setSavedId(id)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      onSaved(id)
    },
    onError: (e: Error) => setError(e.message),
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      // Auto-save first if unsaved
      let id = savedId
      if (!id) {
        const err = validate()
        if (err) throw new Error(err)
        id = await saveMutation.mutateAsync()
      }
      setPdfLoading(true)
      try {
        const url = await generateQuotePdf(id!)
        setPdfUrl(url)
      } finally {
        setPdfLoading(false)
      }
    },
    onError: (e: Error) => { setError(e.message); setPdfLoading(false) },
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      let id = savedId
      if (!id) id = await saveMutation.mutateAsync()
      await generateQuotePdf(id!) // ensures PDF exists
      await sendQuote(id!)
      setStatus('sent')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const convertMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      if (!savedId) throw new Error('Save the quote before converting.')
      if (!recipient || recipient.type !== 'customer') {
        throw new Error('Convert is only available for customer-linked quotes.')
      }
      const firstRow = rows.find(r => r.unitPrice > 0)
      if (!firstRow) throw new Error('No line item with a unit price.')
      return convertQuoteToOrder(savedId, recipient.id, firstRow.unitPrice)
    },
    onSuccess: () => {
      setStatus('accepted')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      // Navigate to ops orders
      window.location.href = `/ops/orders`
    },
    onError: (e: Error) => setError(e.message),
  })

  const isBusy =
    saveMutation.isPending ||
    previewMutation.isPending ||
    sendMutation.isPending ||
    convertMutation.isPending

  const isReadOnly = status === 'accepted' || status === 'declined'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <aside className="qb-panel" aria-label="Quote builder">
      <div className="qb-panel__header">
        <div className="qb-panel__title-row">
          <h2 className="qb-panel__title">
            {editQuote ? `Quote ${editQuote.quoteNumber}` : 'New quote'}
          </h2>
          <button className="qb-panel__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {status !== 'draft' && (
          <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>
        )}
      </div>

      <div className="qb-panel__body">

        {error && (
          <div className="qb-error" role="alert">{error}</div>
        )}

        {/* Recipient */}
        <section className="qb-section">
          <h4 className="qb-section__title">Bill to</h4>
          <RecipientSearch
            value={recipient}
            onChange={setRecipient}
            disabled={isReadOnly}
          />
          {recipient && (
            <p className="qb-section__hint">
              <span className={`qb-type-tag qb-type-tag--${recipient.type}`}>
                {recipient.type === 'customer' ? 'Customer' : 'Lead'}
              </span>
              {recipient.sub}
            </p>
          )}
        </section>

        {/* Meta */}
        <section className="qb-section">
          <div className="qb-meta-row">
            <div className="ui-field">
              <label className="ui-field__label">Quote reference</label>
              <input
                className="ui-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Propane supply 2026"
                disabled={isReadOnly}
              />
            </div>
            <Input
              label="Valid until"
              type="date"
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              disabled={isReadOnly}
            />
          </div>
        </section>

        {/* Line items */}
        <section className="qb-section">
          <h4 className="qb-section__title">Line items</h4>

          <div className="qb-rows-header">
            <span className="qb-rows-header__num" />
            <span className="qb-rows-header__desc">Product / Description</span>
            <span className="qb-rows-header__qty">Qty</span>
            <span className="qb-rows-header__price">Unit price</span>
            <span className="qb-rows-header__amount">Amount</span>
            <span className="qb-rows-header__rm" />
          </div>

          <div className="qb-rows">
            {rows.map((row, i) => (
              <LineItemRow
                key={row._id}
                row={row}
                index={i}
                onChange={handleRowChange}
                onProductSelect={handleProductSelect}
                onRemove={removeRow}
                disabled={isReadOnly}
              />
            ))}
          </div>

          {!isReadOnly && (
            <button className="qb-add-row" onClick={addRow}>
              + Add line item
            </button>
          )}
        </section>

        {/* Special items */}
        <section className="qb-section">
          <h4 className="qb-section__title">Additional items</h4>

          {/* Delivery fee */}
          <div className="qb-addon">
            <label className="qb-addon__check">
              <input
                type="checkbox"
                checked={includeDelivery}
                onChange={e => setIncludeDelivery(e.target.checked)}
                disabled={isReadOnly}
              />
              <span className="qb-addon__label">Delivery fee</span>
            </label>
            {includeDelivery && (
              <div className="qb-addon__fields">
                <Input
                  label="Fee ($)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={deliveryFee || ''}
                  onChange={e => setDeliveryFee(parseFloat(e.target.value) || 0)}
                  disabled={isReadOnly}
                />
              </div>
            )}
          </div>

          {/* Tank rental */}
          <div className="qb-addon">
            <label className="qb-addon__check">
              <input
                type="checkbox"
                checked={includeRental}
                onChange={e => setIncludeRental(e.target.checked)}
                disabled={isReadOnly}
              />
              <span className="qb-addon__label">Tank rental</span>
            </label>
            {includeRental && (
              <div className="qb-addon__fields qb-addon__fields--two">
                <Input
                  label="Rate ($/month)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={rentalRate || ''}
                  onChange={e => setRentalRate(parseFloat(e.target.value) || 0)}
                  disabled={isReadOnly}
                />
                <Input
                  label="Months"
                  type="number"
                  min="1"
                  step="1"
                  value={rentalMonths || ''}
                  onChange={e => setRentalMonths(parseInt(e.target.value, 10) || 0)}
                  disabled={isReadOnly}
                />
              </div>
            )}
          </div>
        </section>

        {/* Pricing summary */}
        <section className="qb-section qb-section--summary">
          <div className="qb-summary">
            <div className="qb-summary__row">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {includeDelivery && effectiveDelivery > 0 && (
              <div className="qb-summary__row">
                <span>Delivery fee</span>
                <span>{formatCurrency(effectiveDelivery)}</span>
              </div>
            )}
            {includeRental && rentalTotal > 0 && (
              <div className="qb-summary__row">
                <span>Tank rental</span>
                <span>{formatCurrency(rentalTotal)}</span>
              </div>
            )}
            <div className="qb-summary__row qb-summary__row--total">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </section>

        {/* Notes / terms */}
        <section className="qb-section">
          <h4 className="qb-section__title">Notes &amp; terms</h4>
          <textarea
            className="ui-input qb-textarea"
            rows={4}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Payment terms, validity conditions, any special notes…"
            disabled={isReadOnly}
          />
        </section>

      </div>

      {/* Footer actions */}
      <div className="qb-panel__footer">
        {!isReadOnly && (
          <>
            <Button
              variant="ghost"
              size="sm"
              loading={saveMutation.isPending}
              disabled={isBusy}
              onClick={() => saveMutation.mutate()}
            >
              💾 Save draft
            </Button>

            <Button
              variant="secondary"
              size="sm"
              loading={pdfLoading || previewMutation.isPending}
              disabled={isBusy}
              onClick={() => previewMutation.mutate()}
            >
              👁 Preview PDF
            </Button>

            <Button
              variant="primary"
              size="sm"
              loading={sendMutation.isPending}
              disabled={isBusy || status === 'sent'}
              onClick={() => sendMutation.mutate()}
            >
              ✉️ Send to customer
            </Button>
          </>
        )}

        {(status === 'sent' || status === 'accepted' || !isReadOnly) && (
          <Button
            variant="success"
            size="sm"
            loading={convertMutation.isPending}
            disabled={isBusy || status === 'accepted'}
            onClick={() => convertMutation.mutate()}
          >
            ✓ Convert to order
          </Button>
        )}
      </div>

      {/* PDF preview modal */}
      {pdfUrl && (
        <PdfPreviewModal url={pdfUrl} onClose={() => setPdfUrl(null)} />
      )}
    </aside>
  )
}

// ── QuoteTable ────────────────────────────────────────────────────────────────

interface QuoteTableProps {
  quotes:      Quote[]
  loading:     boolean
  onEdit:      (quote: Quote) => void
  onDelete:    (id: string) => void
  deletingId:  string | null
}

const QuoteTable: React.FC<QuoteTableProps> = ({
  quotes, loading, onEdit, onDelete, deletingId,
}) => {
  if (loading) {
    return (
      <div className="qb-table-wrap">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="qb-skeleton" />
        ))}
      </div>
    )
  }

  if (quotes.length === 0) {
    return (
      <div className="qb-empty-state">
        <p>No quotes yet. Create your first quote →</p>
      </div>
    )
  }

  return (
    <div className="qb-table-wrap">
      <table className="qb-table">
        <thead>
          <tr>
            <th className="qb-th">Quote #</th>
            <th className="qb-th">Customer / Lead</th>
            <th className="qb-th qb-th--right">Total</th>
            <th className="qb-th">Status</th>
            <th className="qb-th">Sent</th>
            <th className="qb-th">Valid Until</th>
            <th className="qb-th">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map(q => {
            const cfg = STATUS_BADGE[q.status]
            return (
              <tr key={q.id} className="qb-tr" onClick={() => onEdit(q)}>
                <td className="qb-td qb-td--mono">{q.quoteNumber}</td>
                <td className="qb-td">{q.customerId ?? q.leadId ?? '—'}</td>
                <td className="qb-td qb-td--right qb-td--bold">{formatCurrency(q.total)}</td>
                <td className="qb-td">
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
                </td>
                <td className="qb-td">
                  {'sentAt' in q && q.sentAt
                    ? formatRelative(q.sentAt as { toDate(): Date })
                    : '—'}
                </td>
                <td className="qb-td">{q.validUntil ? formatDate(q.validUntil) : '—'}</td>
                <td className="qb-td qb-td--actions" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(q)}>Edit</Button>
                  {q.status === 'draft' && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === q.id}
                      onClick={() => onDelete(q.id)}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const QuoteBuilder: React.FC = () => {
  const [searchParams]    = useSearchParams()
  const queryClient       = useQueryClient()

  const [panelOpen,   setPanelOpen]   = useState(() => searchParams.get('new') === '1')
  const [editQuote,   setEditQuote]   = useState<Quote | null>(null)
  const [statusFilter,setStatusFilter]= useState<QuoteStatus | 'all'>('all')
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  const prefillLeadId = searchParams.get('leadId') ?? undefined

  const { data: quotesPage, isLoading } = useQuery({
    queryKey: ['quotes', statusFilter],
    queryFn: () => getQuotes(
      statusFilter === 'all' ? {} : { status: statusFilter },
      { pageSize: 100 },
    ),
    staleTime: 60_000,
  })
  const quotes = quotesPage?.data ?? []

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      setDeletingId(id)
      await deleteQuote(id)
    },
    onSuccess: () => {
      setDeletingId(null)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: () => setDeletingId(null),
  })

  const handleNew = () => {
    setEditQuote(null)
    setPanelOpen(true)
  }

  const handleEdit = (quote: Quote) => {
    setEditQuote(quote)
    setPanelOpen(true)
  }

  const handleClose = () => {
    setPanelOpen(false)
    setEditQuote(null)
  }

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['quotes'] })
  }

  return (
    <div className={`qb-page${panelOpen ? ' qb-page--panel-open' : ''}`}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="qb-header">
        <h1 className="qb-header__title">Quotes</h1>
        <div className="qb-header__controls">
          <select
            className="qb-status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_BADGE) as QuoteStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={handleNew}>
            + New quote
          </Button>
        </div>
      </header>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="qb-body">
        <QuoteTable
          quotes={quotes}
          loading={isLoading}
          onEdit={handleEdit}
          onDelete={id => deleteMutation.mutate(id)}
          deletingId={deletingId}
        />
      </div>

      {/* ── Slide-in builder panel ───────────────────────────────────────────── */}
      {panelOpen && (
        <>
          <div className="qb-panel-backdrop" onClick={handleClose} />
          <QuoteBuilderPanel
            editQuote={editQuote}
            prefillLeadId={prefillLeadId}
            onClose={handleClose}
            onSaved={handleSaved}
          />
        </>
      )}
    </div>
  )
}

export default QuoteBuilder
