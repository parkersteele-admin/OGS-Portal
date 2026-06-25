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
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createQuote,
  updateQuote,
  getQuotes,
  generateQuotePdf,
  sendQuote,
  convertQuoteToOrder,
  deleteQuote,
  duplicateQuote,
} from '../../../services/quoteService'
import { subscribeToCustomers, searchCustomers, getCustomer } from '../../../services/customerService'
import { getLeads, getLead } from '../../../services/leadService'
import { getCompanySettings } from '../../../services/companySettingsService'
import { getActiveUsers } from '../../../services/userService'
import { useAuth } from '../../../hooks/useAuth'
import { formatCurrency, formatDate, formatRelative } from '../../../utils/format'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { ProductCombobox } from '../../../components/ui/ProductCombobox'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import type { ProductDropdownItem } from '../../../services/productService'
import type { Quote, QuoteItem, QuoteStatus } from '../../../types/crm'
import type { Customer } from '../../../types/customer'
import type { Lead } from '../../../types/crm'
import type { AppUser } from '../../../types/user'
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

const DELIVERY_PRODUCT_ID = 'delivery'

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

export const QuoteBuilderPanel: React.FC<QuoteBuilderPanelProps> = ({
  editQuote, prefillLeadId, onClose, onSaved,
}) => {
  const { user }      = useAuth()
  const queryClient   = useQueryClient()

  // ── Form state ────────────────────────────────────────────────────────────

  const [recipient,      setRecipient]      = useState<RecipientOption | null>(null)
  const [name,           setName]           = useState('')
  const [salesRepId,     setSalesRepId]     = useState('')
  const [salesRepSnapshot, setSalesRepSnapshot] = useState<{
    id?: string
    name?: string
    email?: string
    phone?: string
  } | null>(null)
  const [salesRepOptions, setSalesRepOptions] = useState<AppUser[]>([])
  const [fallbackRep, setFallbackRep] = useState({ name: '', email: '', phone: '' })
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
  const [applySalesTax, setApplySalesTax]   = useState(false)
  const [salesTaxRatePercent, setSalesTaxRatePercent] = useState('0.00')
  const [notes,          setNotes]          = useState('')
  const [pdfUrl,         setPdfUrl]         = useState<string | null>(null)
  const [pdfLoading,     setPdfLoading]     = useState(false)
  const [savedId,        setSavedId]        = useState<string | null>(editQuote?.id ?? null)
  const [status,         setStatus]         = useState<QuoteStatus>(editQuote?.status ?? 'draft')
  const [error,          setError]          = useState<string | null>(null)
  const [toast,          setToast]          = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getActiveUsers()
      .then((users) => {
        if (!mounted) return
        const internal = users.filter((u) => ['admin', 'dispatch', 'sales', 'driver'].includes(u.role))
        const preferred = internal.filter((u) => u.role === 'sales' || u.role === 'admin')
        const options = preferred.length > 0 ? preferred : internal
        setSalesRepOptions(options)
        if (!salesRepId && !editQuote) {
          const defaultRep = options.find((u) => u.id === user?.id)
          if (defaultRep) setSalesRepId(defaultRep.id)
          else if (user?.id) setSalesRepId(user.id)
        }
      })
      .catch(() => {
        if (!mounted) return
        setSalesRepOptions([])
      })

    if (editQuote) return () => { mounted = false }
    getCompanySettings()
      .then((settings) => {
        if (!mounted) return
        setFallbackRep({
          name: settings.name ?? '',
          email: settings.email ?? '',
          phone: settings.phone ?? '',
        })
        const configuredRate = Number(settings.defaultSalesTaxRate ?? 0)
        if (!Number.isFinite(configuredRate) || configuredRate <= 0) {
          setApplySalesTax(false)
          setSalesTaxRatePercent('0.00')
          return
        }
        setApplySalesTax(true)
        setSalesTaxRatePercent(configuredRate.toFixed(2))
      })
      .catch(() => {
        if (!mounted) return
        setApplySalesTax(false)
        setSalesTaxRatePercent('0.00')
      })
    return () => { mounted = false }
  }, [editQuote, salesRepId, user?.id])

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
    setSalesRepSnapshot({
      id: editQuote.salesRepId,
      name: editQuote.salesRepName,
      email: editQuote.salesRepEmail,
      phone: editQuote.salesRepPhone,
    })
    setSalesRepId(editQuote.salesRepId ?? editQuote.createdBy ?? user?.id ?? '')
    const initialTaxAmount = editQuote.salesTaxAmount ?? editQuote.tax ?? 0
    const initialTaxRate = editQuote.salesTaxRate ?? editQuote.taxRate ?? 0
    const inferredApplySalesTax = editQuote.applySalesTax ?? (initialTaxRate > 0 || initialTaxAmount > 0)
    setApplySalesTax(Boolean(inferredApplySalesTax))
    setSalesTaxRatePercent((((inferredApplySalesTax ? initialTaxRate : 0) || 0) * 100).toFixed(2))
    setStatus(editQuote.status)
    if (editQuote.validUntil) {
      setValidUntil((editQuote.validUntil as { toDate(): Date }).toDate().toISOString().slice(0, 10))
    }
  }, [editQuote?.id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editQuote || salesRepId || !user?.id) return
    setSalesRepId(user.id)
  }, [editQuote, salesRepId, user?.id])

  // Pre-fill leadId from query param
  useEffect(() => {
    if (prefillLeadId && !editQuote) {
      setRecipient({ type: 'lead', id: prefillLeadId, label: `Lead ${prefillLeadId}`, sub: '' })
    }
  }, [prefillLeadId, editQuote])

  // ── Computed totals ───────────────────────────────────────────────────────

  const deliveryRows = useMemo(
    () => rows.filter((r) => r.productId === DELIVERY_PRODUCT_ID),
    [rows],
  )
  const productRows = useMemo(
    () => rows.filter((r) => r.productId !== DELIVERY_PRODUCT_ID),
    [rows],
  )

  useEffect(() => {
    if (deliveryRows.length === 0) return

    const latestDeliveryRow = deliveryRows[deliveryRows.length - 1]
    const inferredDeliveryFee = latestDeliveryRow.amount > 0
      ? latestDeliveryRow.amount
      : latestDeliveryRow.unitPrice
    const nextDeliveryFee = Number.isFinite(inferredDeliveryFee)
      ? Math.max(inferredDeliveryFee, 0)
      : 0

    setIncludeDelivery(true)
    setDeliveryFee((prev) => (Math.abs(prev - nextDeliveryFee) < 0.005 ? prev : nextDeliveryFee))
    setRows((prev) => prev.filter((r) => r.productId !== DELIVERY_PRODUCT_ID))
  }, [deliveryRows])

  const subtotal = useMemo(
    () => parseFloat(productRows.reduce((s, r) => s + r.amount, 0).toFixed(2)),
    [productRows],
  )
  const rentalTotal = useMemo(
    () => includeRental ? parseFloat((rentalRate * rentalMonths).toFixed(2)) : 0,
    [includeRental, rentalRate, rentalMonths],
  )
  const effectiveDelivery = includeDelivery ? deliveryFee : 0
  const preTaxTotal = parseFloat((subtotal + effectiveDelivery + rentalTotal).toFixed(2))
  const parsedSalesTaxRatePercent = Number.parseFloat(salesTaxRatePercent)
  const safeSalesTaxRatePercent = Number.isFinite(parsedSalesTaxRatePercent)
    ? Math.max(parsedSalesTaxRatePercent, 0)
    : 0
  const salesTaxRate = applySalesTax ? (safeSalesTaxRatePercent / 100) : 0
  const salesTaxAmount = parseFloat((preTaxTotal * salesTaxRate).toFixed(2))
  const total = parseFloat((preTaxTotal + salesTaxAmount).toFixed(2))

  const selectedSalesRep = useMemo(
    () => salesRepOptions.find((rep) => rep.id === salesRepId) ?? null,
    [salesRepOptions, salesRepId],
  )

  const resolvedSalesRep = useMemo(() => {
    if (selectedSalesRep) {
      return {
        salesRepId: selectedSalesRep.id,
        salesRepName: selectedSalesRep.name,
        salesRepEmail: selectedSalesRep.email,
        salesRepPhone: selectedSalesRep.phone,
      }
    }
    if (salesRepSnapshot && salesRepSnapshot.id && salesRepSnapshot.id === salesRepId) {
      return {
        salesRepId: salesRepSnapshot.id,
        salesRepName: salesRepSnapshot.name,
        salesRepEmail: salesRepSnapshot.email,
        salesRepPhone: salesRepSnapshot.phone,
      }
    }
    if (user?.id) {
      return {
        salesRepId: user.id,
        salesRepName: user.name,
        salesRepEmail: user.email,
        salesRepPhone: user.phone,
      }
    }
    return {
      salesRepId: undefined,
      salesRepName: fallbackRep.name || undefined,
      salesRepEmail: fallbackRep.email || undefined,
      salesRepPhone: fallbackRep.phone || undefined,
    }
  }, [selectedSalesRep, salesRepSnapshot, salesRepId, user, fallbackRep])

  const salesRepSelectOptions = useMemo(() => {
    const options = salesRepOptions.map((rep) => ({
      id: rep.id,
      name: rep.name,
      email: rep.email,
    }))
    if (
      salesRepSnapshot?.id
      && !options.some((rep) => rep.id === salesRepSnapshot.id)
      && (salesRepSnapshot.name || salesRepSnapshot.email)
    ) {
      options.push({
        id: salesRepSnapshot.id,
        name: salesRepSnapshot.name || salesRepSnapshot.email || 'Saved rep',
        email: salesRepSnapshot.email || '',
      })
    }
    return options
  }, [salesRepOptions, salesRepSnapshot])

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
        if (product.id === DELIVERY_PRODUCT_ID) {
          setIncludeDelivery(true)
          setDeliveryFee(product.basePrice)
          return {
            ...r,
            productId: '',
            skuLabel: '',
            description: '',
            quantity: 1,
            unitPrice: 0,
            amount: 0,
          }
        }
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
    const items: QuoteItem[] = productRows
      .filter(r => r.description.trim() || r.amount > 0)
      .map(toQuoteItem)

    if (includeDelivery && deliveryFee > 0) {
      items.push({
        productId:   DELIVERY_PRODUCT_ID,
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
    if (productRows.every(r => !r.description.trim() && r.amount === 0)) return 'Add at least one line item.'
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
        applySalesTax,
        salesTaxRate,
        salesTaxAmount,
        taxRate: salesTaxRate,
        tax: salesTaxAmount,
        subtotal: preTaxTotal,
        total,
        createdBy:  user!.id,
        customerId: recipient!.type === 'customer' ? recipient!.id : undefined,
        leadId:     recipient!.type === 'lead'     ? recipient!.id : undefined,
        ...resolvedSalesRep,
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
      // Set status to 'sent' FIRST so the Cloud Function sees it when it checks
      // whether to email the PDF to the recipient.
      await sendQuote(id!)
      await generateQuotePdf(id!) // generates PDF + emails because status is now 'sent'
      setStatus('sent')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onSuccess: () => {
      const name = recipient?.label ?? 'the customer'
      setToast(`Quote sent to ${name}. They'll receive an email with the PDF shortly.`)
      setTimeout(() => setToast(null), 6000)
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
      return convertQuoteToOrder(savedId, recipient.id, firstRow.unitPrice, user?.id)
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

        {toast && (
          <div className="qb-toast" role="status">{toast}</div>
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
            <div className="ui-field">
              <label className="ui-field__label">Sales rep</label>
              <select
                className="ui-input"
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
                disabled={isReadOnly}
              >
                <option value="">Current user</option>
                {salesRepSelectOptions.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name || rep.email}
                  </option>
                ))}
              </select>
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
            {productRows.map((row, i) => (
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

          <div className="qb-addon qb-addon--tax">
            <p className="qb-addon__heading">Sales tax</p>
            <div className="qb-tax-toggle" role="radiogroup" aria-label="Sales tax choice">
              <label className="qb-tax-option">
                <input
                  type="radio"
                  name="qb-tax-mode"
                  checked={applySalesTax}
                  onChange={() => setApplySalesTax(true)}
                  disabled={isReadOnly}
                />
                <span>Apply sales tax</span>
              </label>
              <label className="qb-tax-option">
                <input
                  type="radio"
                  name="qb-tax-mode"
                  checked={!applySalesTax}
                  onChange={() => setApplySalesTax(false)}
                  disabled={isReadOnly}
                />
                <span>Omit sales tax</span>
              </label>
            </div>
            <div className="qb-addon__fields">
              <Input
                label="Sales tax rate (%)"
                type="number"
                min="0"
                step="0.01"
                value={salesTaxRatePercent}
                onChange={e => setSalesTaxRatePercent(e.target.value)}
                disabled={isReadOnly || !applySalesTax}
              />
            </div>
            {!applySalesTax && (
              <p className="qb-tax-note">Sales tax is omitted for this quote.</p>
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
            <div className="qb-summary__row">
              <span>Pre-tax total</span>
              <span>{formatCurrency(preTaxTotal)}</span>
            </div>
            <div className="qb-summary__row">
              <span>{applySalesTax ? `Sales tax (${safeSalesTaxRatePercent.toFixed(2)}%)` : 'Sales tax omitted'}</span>
              <span>{formatCurrency(applySalesTax ? salesTaxAmount : 0)}</span>
            </div>
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
              Save draft
            </Button>

            <Button
              variant="secondary"
              size="sm"
              loading={pdfLoading || previewMutation.isPending}
              disabled={isBusy}
              onClick={() => previewMutation.mutate()}
            >
              Preview PDF
            </Button>

            <Button
              variant="primary"
              size="sm"
              loading={sendMutation.isPending}
              disabled={isBusy || status === 'sent'}
              onClick={() => sendMutation.mutate()}
            >
              Send to customer
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
            Convert to order
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
  nameMap:     Record<string, string>
  currentUserId?: string
  onEdit:      (quote: Quote) => void
  onDuplicate: (quote: Quote) => void
  onResend:    (quote: Quote) => void
  onArchive:   (quote: Quote) => void
  onDelete:    (quote: Quote) => void
  archivingId: string | null
  deletingId:  string | null
  duplicatingId: string | null
  resendingId: string | null
  canManage:   boolean
}

const QuoteTable: React.FC<QuoteTableProps> = ({
  quotes, loading, nameMap, onEdit, onDuplicate, onResend, onArchive, onDelete, archivingId, deletingId, duplicatingId, resendingId, canManage,
  currentUserId,
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
        <p>No quotes yet. Create your first quote.</p>
      </div>
    )
  }

  return (
    <>
    <div className="page-table-wrap qb-table-wrap">
      <table className="page-table qb-table">
        <thead className="page-table__head">
          <tr>
            <th className="page-table__th">Quote #</th>
            <th className="page-table__th">Customer / Lead</th>
            <th className="page-table__th page-table__th--right">Total</th>
            <th className="page-table__th">Status</th>
            <th className="page-table__th">Sent</th>
            <th className="page-table__th">Valid Until</th>
            <th className="page-table__th">Actions</th>
          </tr>
        </thead>
        <tbody className="page-table__tbody">
          {quotes.map(q => {
            const cfg = STATUS_BADGE[q.status]
            return (
              <tr key={q.id} className="page-table__tr qb-tr" onClick={() => onEdit(q)}>
                <td className="page-table__td qb-td--mono">{q.quoteNumber}</td>
                <td className="page-table__td">{nameMap[q.customerId ?? q.leadId ?? ''] ?? q.customerId ?? q.leadId ?? '—'}</td>
                <td className="page-table__td page-table__td--right qb-td--bold">{formatCurrency(q.total)}</td>
                <td className="page-table__td">
                  <StatusBadge status={q.status} label={cfg.label} />
                  {q.status === 'accepted' && (q as Quote & { needsOrderSetup?: boolean }).needsOrderSetup && (
                    <span className="qb-needs-order" title="Standing order not yet set up">⚡ Needs order</span>
                  )}
                </td>
                <td className="page-table__td">
                  {'sentAt' in q && q.sentAt
                    ? formatRelative(q.sentAt as { toDate(): Date })
                    : '—'}
                </td>
                <td className="page-table__td">{q.validUntil ? formatDate(q.validUntil) : '—'}</td>
                <td className="page-table__td qb-td--actions" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(q)}>Edit</Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={duplicatingId === q.id}
                    onClick={() => onDuplicate(q)}
                  >
                    Duplicate
                  </Button>
                  {q.status !== 'draft' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={resendingId === q.id}
                      onClick={() => onResend(q)}
                    >
                      Re-send
                    </Button>
                  )}
                  {canManage && q.status !== 'expired' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={archivingId === q.id}
                      onClick={() => onArchive(q)}
                    >
                      Archive
                    </Button>
                  )}
                  {canManage && (q.status === 'draft' || q.status === 'declined' || q.status === 'expired') && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === q.id}
                      onClick={() => onDelete(q)}
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

    <div className="qb-mobile-cards">
      {quotes.map((q) => {
        const statusLabel =
          q.status === 'accepted' ? 'Approved' :
          q.status === 'expired' ? 'Expired' :
          q.status === 'draft' || q.status === 'sent' ? 'Pending' :
          STATUS_BADGE[q.status].label
        const firstLine = q.lineItems[0]
        const owner = nameMap[q.customerId ?? q.leadId ?? ''] ?? q.customerId ?? q.leadId ?? '—'
        const mineLabel = currentUserId && q.createdBy === currentUserId ? 'Mine' : ''

        return (
          <article
            key={`mobile-${q.id}`}
            className="qb-mobile-card"
            role="button"
            tabIndex={0}
            onClick={() => onEdit(q)}
            onKeyDown={(e) => e.key === 'Enter' && onEdit(q)}
          >
            <div className="qb-mobile-card__top">
              <h3>{q.quoteNumber} · {owner}</h3>
              <span className="qb-mobile-card__amount">{formatCurrency(q.total)}</span>
            </div>
            <div className="qb-mobile-card__meta">{firstLine?.description ?? 'No line items'}</div>
            <div className="qb-mobile-card__bottom">
              <StatusBadge status={q.status} label={statusLabel} className="qb-mobile-card__status" />
              <span>{q.validUntil ? `Valid ${formatDate(q.validUntil)}` : 'No expiry'} {mineLabel && `· ${mineLabel}`}</span>
            </div>
            <div className="qb-mobile-card__actions" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" onClick={() => onEdit(q)}>Open</Button>
              <Button
                variant="secondary"
                size="sm"
                loading={duplicatingId === q.id}
                onClick={() => onDuplicate(q)}
              >
                Duplicate
              </Button>
              {q.status !== 'draft' && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={resendingId === q.id}
                  onClick={() => onResend(q)}
                >
                  Re-send
                </Button>
              )}
              {canManage && q.status !== 'expired' && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={archivingId === q.id}
                  onClick={() => onArchive(q)}
                >
                  Archive
                </Button>
              )}
              {canManage && (q.status === 'draft' || q.status === 'declined' || q.status === 'expired') && (
                <Button
                  variant="danger"
                  size="sm"
                  loading={deletingId === q.id}
                  onClick={() => onDelete(q)}
                >
                  Delete
                </Button>
              )}
            </div>
          </article>
        )
      })}
    </div>
  </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const QuoteBuilder: React.FC = () => {
  const navigate          = useNavigate()
  const location          = useLocation()
  const crmBase           = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'
  const queryClient       = useQueryClient()
  const { user }          = useAuth()

  const [listFilter, setListFilter] = useState<'all' | 'mine' | 'pending' | 'expired'>('all')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [nameMap,     setNameMap]     = useState<Record<string, string>>({})
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null)
  const [quoteToDuplicate, setQuoteToDuplicate] = useState<Quote | null>(null)
  const [listToast, setListToast] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // Build ID → display name map from customers + leads
  useEffect(() => {
    let mounted = true
    const unsub = subscribeToCustomers({}, (customers) => {
      if (!mounted) return
      const map: Record<string, string> = {}
      customers.forEach((c: Customer) => { map[c.id] = c.name })
      getLeads({}, { pageSize: 200 }).then((page) => {
        if (!mounted) return
        page.data.forEach((l: Lead) => { map[l.id] = l.company ?? l.name })
        setNameMap(map)
      })
    })
    return () => { mounted = false; unsub() }
  }, [])

  const { data: quotesPage, isLoading } = useQuery({
    queryKey: ['quotes', 'all'],
    queryFn: () => getQuotes({}, { pageSize: 100 }),
    staleTime: 60_000,
  })
  const quotes = useMemo(() => quotesPage?.data ?? [], [quotesPage?.data])

  // Backfill missing customer/lead display names for quotes that reference
  // records outside the current preloaded customer/lead lists.
  useEffect(() => {
    let cancelled = false

    const unresolvedCustomerIds = [...new Set(
      quotes
        .map((q) => q.customerId)
        .filter((id): id is string => Boolean(id) && !nameMap[id as string]),
    )]
    const unresolvedLeadIds = [...new Set(
      quotes
        .map((q) => q.leadId)
        .filter((id): id is string => Boolean(id) && !nameMap[id as string]),
    )]

    if (unresolvedCustomerIds.length === 0 && unresolvedLeadIds.length === 0) return

    void (async () => {
      const updates: Record<string, string> = {}

      await Promise.all(
        unresolvedCustomerIds.map(async (id) => {
          try {
            const customer = await getCustomer(id)
            updates[id] = customer.name || id
          } catch {
            updates[id] = id
          }
        }),
      )

      await Promise.all(
        unresolvedLeadIds.map(async (id) => {
          try {
            const lead = await getLead(id)
            updates[id] = lead.company || lead.name || id
          } catch {
            updates[id] = id
          }
        }),
      )

      if (!cancelled && Object.keys(updates).length > 0) {
        setNameMap((prev) => ({ ...prev, ...updates }))
      }
    })()

    return () => { cancelled = true }
  }, [quotes, nameMap])

  const canManageQuotes = user?.role === 'admin' || user?.role === 'sales'

  const visibleQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      if (listFilter === 'mine') return quote.createdBy === user?.id
      if (listFilter === 'pending') return quote.status === 'draft' || quote.status === 'sent'
      if (listFilter === 'expired') return quote.status === 'expired'
      return true
    })
  }, [quotes, listFilter, user?.id])

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      setDeletingId(id)
      await deleteQuote(id)
    },
    onSuccess: (_result, vars) => {
      setDeletingId(null)
      setQuoteToDelete(null)
      setListToast('Quote deleted.')
      setTimeout(() => setListToast(null), 5000)
      queryClient.setQueriesData({ queryKey: ['quotes'] }, (old: unknown) => {
        if (!old || typeof old !== 'object') return old
        const maybePage = old as { data?: unknown }
        if (!Array.isArray(maybePage.data)) return old
        return {
          ...(old as Record<string, unknown>),
          data: (maybePage.data as Quote[]).filter(q => q.id !== vars.id),
        }
      })
    },
    onError: () => setDeletingId(null),
  })

  const archiveMutation = useMutation({
    mutationFn: async (quote: Quote) => {
      setArchivingId(quote.id)
      setListError(null)
      await updateQuote(quote.id, { status: 'expired' })
      return quote
    },
    onSuccess: (quote) => {
      setArchivingId(null)
      setListToast(`Quote ${quote.quoteNumber} archived.`)
      setTimeout(() => setListToast(null), 5000)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (err: Error) => {
      setArchivingId(null)
      setListError(err.message || 'Failed to archive quote.')
    },
  })

  const resendMutation = useMutation({
    mutationFn: async (quote: Quote) => {
      setResendingId(quote.id)
      setListError(null)
      await sendQuote(quote.id)
      await generateQuotePdf(quote.id)
      return quote
    },
    onSuccess: (quote) => {
      setResendingId(null)
      setListToast(`Quote ${quote.quoteNumber} re-sent successfully.`)
      setTimeout(() => setListToast(null), 5000)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (err: Error) => {
      setResendingId(null)
      setListError(err.message || 'Failed to re-send quote.')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: async (quote: Quote) => {
      if (!user?.id) throw new Error('You must be signed in to duplicate quotes.')
      setDuplicatingId(quote.id)
      setListError(null)
      return duplicateQuote(quote.id, user.id)
    },
    onSuccess: (newQuoteId, sourceQuote) => {
      setDuplicatingId(null)
      setQuoteToDuplicate(null)
      setListToast(`Quote ${sourceQuote.quoteNumber} duplicated.`)
      setTimeout(() => setListToast(null), 5000)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      navigate(`${crmBase}/quotes/${newQuoteId}`)
    },
    onError: (err: Error) => {
      setDuplicatingId(null)
      setListError(err.message || 'Failed to duplicate quote.')
    },
  })

  const handleNew  = () => navigate(`${crmBase}/quotes/new`)
  const handleEdit = (quote: Quote) => navigate(`${crmBase}/quotes/${quote.id}`)

  return (
    <div className="qb-page">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="page-header">
        <div className="page-header__hero">
          <div className="page-header__title-section">
            <p className="page-header__eyebrow">Revenue Operations</p>
            <h1 className="page-header__title">Quotes</h1>
            <p className="page-header__description">Manage draft, sent, accepted, and archived quotes in one queue.</p>
          </div>
          <div className="page-header__actions qb-header__controls">
            <div className="qb-list-tabs" role="tablist" aria-label="Quote filters">
            {([
              ['all', 'All'],
              ['mine', 'Mine'],
              ['pending', 'Pending'],
              ['expired', 'Expired'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={listFilter === key}
                className={`page-filters__preset${listFilter === key ? ' page-filters__preset--active' : ''}`}
                onClick={() => setListFilter(key)}
              >
                {label}
              </button>
            ))}
            </div>
            <Button variant="primary" size="sm" onClick={handleNew}>
              + New quote
            </Button>
          </div>
        </div>
      </header>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="qb-body">
        {listError && <div className="qb-error" role="alert">{listError}</div>}
        {listToast && <div className="qb-toast" role="status">{listToast}</div>}
        <QuoteTable
          quotes={visibleQuotes}
          loading={isLoading}
          nameMap={nameMap}
          currentUserId={user?.id}
          onEdit={handleEdit}
          onDuplicate={setQuoteToDuplicate}
          onResend={(quote) => resendMutation.mutate(quote)}
          onArchive={(quote) => {
            if (!window.confirm(`Archive quote ${quote.quoteNumber}? It will be marked as expired.`)) return
            archiveMutation.mutate(quote)
          }}
          onDelete={setQuoteToDelete}
          archivingId={archivingId}
          deletingId={deletingId}
          duplicatingId={duplicatingId}
          resendingId={resendingId}
          canManage={canManageQuotes}
        />
      </div>

      <Modal
        open={!!quoteToDelete}
        onClose={() => {
          if (deleteMutation.isPending) return
          setQuoteToDelete(null)
        }}
        title="Delete Quote"
        size="sm"
      >
        {quoteToDelete && (
          <div>
            <p>
              Are you sure you want to delete quote {quoteToDelete.quoteNumber}? This cannot be undone.
            </p>
            <div className="qb-delete-confirm-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuoteToDelete(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate({ id: quoteToDelete.id })}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!quoteToDuplicate}
        onClose={() => {
          if (duplicateMutation.isPending) return
          setQuoteToDuplicate(null)
        }}
        title="Duplicate Quote"
        size="sm"
      >
        {quoteToDuplicate && (
          <div>
            <p>
              Duplicate quote {quoteToDuplicate.quoteNumber} into a new draft?
              The original quote will not be changed.
            </p>
            <div className="qb-delete-confirm-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuoteToDuplicate(null)}
                disabled={duplicateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={duplicateMutation.isPending}
                onClick={() => duplicateMutation.mutate(quoteToDuplicate)}
              >
                Duplicate Quote
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}

export default QuoteBuilder
