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
  useRef,
} from 'react'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getQuote,
  createQuote,
  updateQuote,
  generateQuotePdf,
  sendQuote,
  convertQuoteToOrder,
  duplicateQuote,
} from '../../../services/quoteService'
import { subscribeToCustomers, getCustomer } from '../../../services/customerService'
import { getLeads } from '../../../services/leadService'
import { getCompanySettings } from '../../../services/companySettingsService'
import { getActiveUsers } from '../../../services/userService'
import { useAuth } from '../../../hooks/useAuth'
import { getDoc, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../../lib/firebase'
import { QRCodeSVG } from 'qrcode.react'
import { formatCurrency, formatDate } from '../../../utils/format'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { getProductDropdown, type ProductDropdownItem } from '../../../services/productService'
import type { Quote, QuoteItem, QuoteStatus } from '../../../types/crm'
import type { Customer } from '../../../types/customer'
import type { Lead } from '../../../types/crm'
import type { ProductCategory } from '../../../types/product'
import type { AppUser } from '../../../types/user'
import CustomerCreateModal from '../components/CustomerCreateModal'
import { LineItemsEditor } from '../../shared/line-items/LineItemsEditor'
import {
  EMPTY_LINE_ITEM,
  calculateLineItemRollups,
  calculateMarginPercent,
  recalculateLineItem,
} from '../../shared/line-items/lineItemPricing'
import { getLineItemPricingPermissions } from '../../shared/line-items/lineItemPermissions'
import type { EditableLineItem } from '../../shared/line-items/types'
import './QuoteEditorPage.css'

// ── Types ─────────────────────────────────────────────────────────────────────

const PRODUCT_CATEGORIES: ProductCategory[] = ['CO₂ Cylinders', 'Nitrogen', 'Beer Gas', 'Propane', 'Rentals', 'Fees']

type DraftLineItem = EditableLineItem

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

const CREATE_CUSTOMER_OPTION = '__create_new_customer__'

type FlatIconName = 'back' | 'save' | 'preview' | 'send' | 'convert' | 'remove' | 'summary'

const FlatIcon: React.FC<{ name: FlatIconName }> = ({ name }) => {
  if (name === 'back') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'save') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M4 3.5h9l3 3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 3.5v5h6v-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 14h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'preview') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M1.8 10s3-4.8 8.2-4.8S18.2 10 18.2 10 15.2 14.8 10 14.8 1.8 10 1.8 10Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10" cy="10" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    )
  }
  if (name === 'send') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M2.2 9.6 17.6 2.8l-4.8 14.4-2.6-5-5-.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'convert') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M4 10.5l3.3 3.3L16 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'remove') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M6.2 6.2 13.8 13.8M13.8 6.2 6.2 13.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 2.8v14.4M2.8 10h14.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const DELIVERY_PRODUCT_ID = 'delivery'

function toQuoteItem(r: DraftLineItem): QuoteItem {
  return { productId: r.productId, description: r.description, quantity: r.quantity, unitPrice: r.unitPrice, amount: r.amount }
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
  const location      = useLocation()
  const crmBase       = location.pathname.startsWith('/admin') ? '/admin/crm' : '/crm'
  const { quoteId }   = useParams<{ quoteId: string }>()
  const [searchParams] = useSearchParams()
  const isNew         = !quoteId || quoteId === 'new'
  const prefillLeadId = isNew ? (searchParams.get('leadId') ?? '') : ''
  const { user, role } = useAuth()
  const queryClient   = useQueryClient()
  const pricingPermissions = useMemo(() => getLineItemPricingPermissions(role), [role])

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
        label:   c.name ?? '',
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
          label:   (l.company ?? l.name) ?? '',
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
  const [rows,           setRows]           = useState<DraftLineItem[]>([EMPTY_LINE_ITEM()])
  const [salesRepId,     setSalesRepId]     = useState('')
  const [salesRepSnapshot, setSalesRepSnapshot] = useState<{
    id?: string
    name?: string
    email?: string
    phone?: string
  } | null>(null)
  const [salesRepOptions, setSalesRepOptions] = useState<AppUser[]>([])
  const [fallbackRep, setFallbackRep] = useState({ name: '', email: '', phone: '' })
  const [deliveryFee,    setDeliveryFee]    = useState(0)
  const [includeDelivery,setIncludeDelivery]= useState(false)
  const [rentalMonths,   setRentalMonths]   = useState(0)
  const [rentalRate,     setRentalRate]     = useState(0)
  const [includeRental,  setIncludeRental]  = useState(false)
  const [applySalesTax, setApplySalesTax] = useState(false)
  const [salesTaxRatePercent, setSalesTaxRatePercent] = useState('0.00')
  const [notes,          setNotes]          = useState('')
  const [pdfUrl,         setPdfUrl]         = useState<string | null>(null)
  const [pdfLoading,     setPdfLoading]     = useState(false)
  const [savedId,        setSavedId]        = useState<string | null>(isNew ? null : quoteId!)
  const [status,         setStatus]         = useState<QuoteStatus>('draft')
  const [needsOrderSetup, setNeedsOrderSetup] = useState(false)
  const [approvalDetails, setApprovalDetails] = useState<Quote['approval'] | null>(null)
  const [setupUrl,       setSetupUrl]       = useState<string | null>(null)
  const [setupComplete,  setSetupComplete]  = useState(false)
  const [setupUrlLoading, setSetupUrlLoading] = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [sendToast,      setSendToast]      = useState<string | null>(null)
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const summaryRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    getActiveUsers()
      .then((users) => {
        if (!mounted) return
        const internal = users.filter((u) => ['admin', 'dispatch', 'sales', 'driver'].includes(u.role))
        const preferred = internal.filter((u) => u.role === 'sales' || u.role === 'admin')
        const options = preferred.length > 0 ? preferred : internal
        setSalesRepOptions(options)
        if (!salesRepId && isNew) {
          const defaultRep = options.find((u) => u.id === user?.id)
          if (defaultRep) setSalesRepId(defaultRep.id)
          else if (user?.id) setSalesRepId(user.id)
        }
      })
      .catch(() => {
        if (!mounted) return
        setSalesRepOptions([])
      })

    getCompanySettings()
      .then((settings) => {
        if (!mounted) return
        setFallbackRep({
          name: settings.name ?? '',
          email: settings.email ?? '',
          phone: settings.phone ?? '',
        })
        if (!isNew) return
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
        if (!mounted || !isNew) return
        setApplySalesTax(false)
        setSalesTaxRatePercent('0.00')
      })
    return () => { mounted = false }
  }, [isNew, salesRepId, user?.id])

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
      })).map((row) => recalculateLineItem(row, 'unitPrice', pricingPermissions.enforceMarginFloor)))
      setNotes(q.notes ?? '')
      setSalesRepSnapshot({
        id: q.salesRepId,
        name: q.salesRepName,
        email: q.salesRepEmail,
        phone: q.salesRepPhone,
      })
      setSalesRepId(q.salesRepId ?? q.createdBy ?? user?.id ?? '')
      setStatus(q.status)
      const initialTaxAmount = q.salesTaxAmount ?? q.tax ?? 0
      const initialTaxRate = q.salesTaxRate ?? q.taxRate ?? 0
      const inferredApplySalesTax = q.applySalesTax ?? (initialTaxRate > 0 || initialTaxAmount > 0)
      setApplySalesTax(Boolean(inferredApplySalesTax))
      setSalesTaxRatePercent((((inferredApplySalesTax ? initialTaxRate : 0) || 0) * 100).toFixed(2))
      if (q.needsOrderSetup) setNeedsOrderSetup(true)
      setApprovalDetails(q.approval ?? null)

      // Load setup token from customer doc to show QR code
      if (q.status === 'accepted' && q.customerId) {
        getDoc(doc(db, 'customers', q.customerId as string)).then((cSnap) => {
          if (!cSnap.exists()) return
          const cd = cSnap.data()
          if (cd.setupComplete) {
            setSetupComplete(true)
          } else if (cd.setupToken) {
            setSetupUrl(`https://app.ohiogassupply.com/join/${cd.setupToken as string}`)
          }
        }).catch(() => null)
      }

      if (q.validUntil) {
        setValidUntil((q.validUntil as { toDate(): Date }).toDate().toISOString().slice(0, 10))
      }
      setLoadingQuote(false)
    }).catch((e) => {
      setLoadError(e.message)
      setLoadingQuote(false)
    })
  }, [quoteId, user?.id, pricingPermissions.enforceMarginFloor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isNew || salesRepId || !user?.id) return
    setSalesRepId(user.id)
  }, [isNew, salesRepId, user?.id])

  // ── Selected recipient details (for auto-fill display) ───────────────────

  const selectedRecipient = useMemo(
    () => recipients.find(r => r.id === recipientId) ?? null,
    [recipients, recipientId],
  )

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

  const handleRecipientChange = useCallback((value: string) => {
    if (value === CREATE_CUSTOMER_OPTION) {
      setShowCreateCustomer(true)
      return
    }
    setRecipientId(value)
  }, [])

  const handleInlineCustomerCreated = useCallback(async (id: string) => {
    try {
      const customer = await getCustomer(id)
      const nextOption: RecipientOption = {
        type: 'customer',
        id: customer.id,
        label: customer.name ?? '',
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        address: [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', '),
      }
      setRecipients((prev) => {
        const withoutExisting = prev.filter((r) => !(r.type === 'customer' && r.id === id))
        return [...withoutExisting, nextOption]
      })
    } catch {
      setRecipients((prev) => {
        if (prev.some((r) => r.id === id)) return prev
        return [...prev, { type: 'customer', id, label: 'New customer', email: '', phone: '', address: '' }]
      })
    }

    setRecipientId(id)
    setShowCreateCustomer(false)
  }, [])

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
  const totalCost = useMemo(
    () => parseFloat(productRows.reduce((s, r) => s + (r.cost * r.quantity), 0).toFixed(2)),
    [productRows],
  )
  const totalLineProfit = useMemo(
    () => parseFloat(productRows.reduce((s, r) => s + r.profit, 0).toFixed(2)),
    [productRows],
  )
  const rentalTotal = useMemo(
    () => includeRental ? parseFloat((rentalRate * rentalMonths).toFixed(2)) : 0,
    [includeRental, rentalRate, rentalMonths],
  )
  const effectiveDelivery = includeDelivery ? deliveryFee : 0
  const parsedSalesTaxRatePercent = Number.parseFloat(salesTaxRatePercent)
  const safeSalesTaxRatePercent = Number.isFinite(parsedSalesTaxRatePercent)
    ? Math.max(parsedSalesTaxRatePercent, 0)
    : 0
  const salesTaxRate = applySalesTax ? (safeSalesTaxRatePercent / 100) : 0
  const rollups = useMemo(
    () => calculateLineItemRollups({
      revenueProducts: subtotal,
      totalCost,
      lineProfit: totalLineProfit,
      extraRevenue: effectiveDelivery + rentalTotal,
      applySalesTax,
      salesTaxRate,
    }),
    [subtotal, totalCost, totalLineProfit, effectiveDelivery, rentalTotal, applySalesTax, salesTaxRate],
  )
  const preTaxTotal = rollups.preTaxTotal
  const salesTaxAmount = rollups.salesTaxAmount
  const total = rollups.totalRevenue
  const totalProfit = rollups.totalProfit
  const overallMarginPercent = rollups.overallMarginPercent
  const marginViolations = useMemo(
    () => productRows.filter((r) => r.productId && r.marginPercent + 0.0001 < r.minMarginPercent),
    [productRows],
  )

  useEffect(() => {
    if (Object.keys(productMap).length === 0) return
    setRows((prev) => prev.map((row) => {
      if (!row.productId) return row
      const product = productMap[row.productId]
      if (!product) return row
      const marginPercent = calculateMarginPercent(row.unitPrice, product.cost)
      return recalculateLineItem({
        ...row,
        productName: product.name,
        basePrice: product.basePrice,
        cost: product.cost,
        minMarginPercent: product.minMarginPercent,
        minPrice: product.minPrice,
        marginPercent,
      }, 'unitPrice', pricingPermissions.enforceMarginFloor)
    }))
  }, [productMap, pricingPermissions.enforceMarginFloor])

  // Compute filtered products based on selected category
  const filteredProducts = useMemo(() => {
    const products = Object.values(productMap).filter((p) => p.id !== DELIVERY_PRODUCT_ID)
    if (selectedCategory === 'All') return products
    return products.filter((p) => p.category === selectedCategory)
  }, [productMap, selectedCategory])

  // ── Build payload ─────────────────────────────────────────────────────────

  const buildLineItems = (): QuoteItem[] => {
    const items: QuoteItem[] = productRows
      .filter(r => r.description.trim() || r.amount > 0)
      .map(toQuoteItem)

    if (includeDelivery && deliveryFee > 0)
      items.push({ productId: DELIVERY_PRODUCT_ID, description: 'Delivery fee', quantity: 1, unitPrice: deliveryFee, amount: deliveryFee })
    if (includeRental && rentalRate > 0 && rentalMonths > 0)
      items.push({ productId: 'rental', description: `Tank rental (${rentalMonths} mo.)`, quantity: rentalMonths, unitPrice: rentalRate, amount: rentalTotal })
    return items
  }

  const validate = (): string | null => {
    if (!recipientId) return 'Please select a customer or lead.'
    if (productRows.every(r => !r.description.trim() && r.amount === 0)) return 'Add at least one line item.'
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
        applySalesTax,
        salesTaxRate,
        salesTaxAmount,
        taxRate: salesTaxRate,
        tax: salesTaxAmount,
        subtotal: preTaxTotal,
        total,
        createdBy:  user!.id,
        customerId: rec?.type === 'customer' ? rec.id : undefined,
        leadId:     rec?.type === 'lead'     ? rec.id : undefined,
        ...resolvedSalesRep,
      }
      if (savedId) {
        // When re-editing a declined quote, reset it to draft so it can be re-sent
        const nextStatus: QuoteStatus = status === 'declined' ? 'draft' : status
        await updateQuote(savedId, { ...payload, status: nextStatus } as unknown as Partial<Omit<Quote, 'id' | 'createdAt'>>)
        return savedId
      }
      return createQuote(payload)
    },
    onSuccess: (id) => {
      setSavedId(id)
      setError(null)
      if (status === 'declined') setStatus('draft')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      if (isNew) navigate(`${crmBase}/quotes/${id}`, { replace: true })
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
      // Generate PDF + email to customer. If this fails, surface it clearly so
      // staff can retry instead of assuming the customer was notified.
      await generateQuotePdf(id!)
      setStatus('sent')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onSuccess: () => {
      const selectedOpt = recipients.find(r => r.id === recipientId)
      const name = selectedOpt?.label ?? 'the customer'
      setSendToast(`Quote sent to ${name}. They'll receive an email with the PDF shortly.`)
      setTimeout(() => setSendToast(null), 6000)
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
      return convertQuoteToOrder(savedId, selectedRecipient.id, firstRow.unitPrice, user?.id)
    },
    onSuccess: () => {
      setStatus('accepted')
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      navigate('/ops/orders')
    },
    onError: (e: Error) => setError(e.message),
  })

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (!savedId) throw new Error('Save this quote before duplicating.')
      if (!user?.id) throw new Error('You must be signed in to duplicate quotes.')
      return duplicateQuote(savedId, user.id)
    },
    onSuccess: (newQuoteId) => {
      setShowDuplicateConfirm(false)
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      navigate(`${crmBase}/quotes/${newQuoteId}`)
    },
    onError: (e: Error) => setError(e.message),
  })

  const isBusy = saveMutation.isPending || previewMutation.isPending || sendMutation.isPending || convertMutation.isPending || duplicateMutation.isPending
  const isReadOnly = status === 'accepted'
  const isDeclinedRevision = status === 'declined'

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingQuote) return <div className="qep-loading">Loading quote…</div>
  if (loadError) return <div className="qep-load-error">Error: {loadError}</div>

  return (
    <div className="qep-page">

      {/* Sticky page header */}
      <div className="qep-header">
        <div className="qep-header__left">
          <button className="qep-back" onClick={() => navigate(`${crmBase}/quotes`)} aria-label="Back to quotes">
            <span className="qep-icon" aria-hidden="true"><FlatIcon name="back" /></span>
            <span>Quotes</span>
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
                <span className="qep-action-label"><span className="qep-icon" aria-hidden="true"><FlatIcon name="save" /></span>Save draft</span>
              </Button>
              {!isNew && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={duplicateMutation.isPending}
                  disabled={isBusy || !savedId}
                  onClick={() => setShowDuplicateConfirm(true)}
                >
                  <span className="qep-action-label">Duplicate Quote</span>
                </Button>
              )}
              <Button variant="secondary" size="sm" loading={pdfLoading || previewMutation.isPending} disabled={isBusy}
                onClick={() => previewMutation.mutate()}>
                <span className="qep-action-label"><span className="qep-icon" aria-hidden="true"><FlatIcon name="preview" /></span>Preview PDF</span>
              </Button>
              <Button variant="primary" size="sm" loading={sendMutation.isPending} disabled={isBusy}
                onClick={() => sendMutation.mutate()}>
                <span className="qep-action-label"><span className="qep-icon" aria-hidden="true"><FlatIcon name="send" /></span>{status === 'sent' || isDeclinedRevision ? 'Re-send' : 'Send'}</span>
              </Button>
            </>
          )}
          {(status === 'sent' || !isReadOnly) && (
            <Button variant="success" size="sm" loading={convertMutation.isPending} disabled={isBusy}
              onClick={() => convertMutation.mutate()}>
              <span className="qep-action-label"><span className="qep-icon" aria-hidden="true"><FlatIcon name="convert" /></span>Convert to order</span>
            </Button>
          )}
          {status === 'accepted' && needsOrderSetup && (
            <Button variant="primary" size="sm"
              onClick={() => {
                const base = location.pathname.startsWith('/admin') ? '/admin' : ''
                const custParam = recipientId ? `?customerId=${recipientId}` : ''
                navigate(`${base}/orders/new${custParam}`)
              }}>
              Set Up Standing Order
            </Button>
          )}
        </div>
      </div>

      {error && <div className="qep-error" role="alert">{error}</div>}

      {sendToast && <div className="qep-toast" role="status">{sendToast}</div>}

      {status === 'accepted' && needsOrderSetup && (
        <div className="qep-notice qep-notice--action" role="status">
          ✅ Quote accepted — pricing is locked in. Next step: set up this customer’s
          {' '}<button
            type="button"
            className="qep-notice__link"
            onClick={() => {
              const base = location.pathname.startsWith('/admin') ? '/admin' : ''
              const custParam = recipientId ? `?customerId=${recipientId}` : ''
              navigate(`${base}/orders/new${custParam}`)
            }}
          >standing delivery order</button>.
        </div>
      )}

      {status === 'accepted' && approvalDetails && (
        <div className="qep-notice" role="status">
          <strong>Approval details:</strong> {approvalDetails.approvedByName}
          {approvalDetails.approvedByEmail ? ` (${approvalDetails.approvedByEmail})` : ''}
          {' · '}Delivery contact: {approvalDetails.deliveryContactName}
          {' · '}Communication: {approvalDetails.primaryCommunicationMethod}
          {approvalDetails.paymentMethodStatus
            ? ` · Payment: ${approvalDetails.paymentMethodStatus.replace(/_/g, ' ')}`
            : ''}
        </div>
      )}

      {/* ── Customer portal setup QR code ───────────────────────────────── */}
      {status === 'accepted' && selectedRecipient?.type === 'customer' && (
        <div className="qep-setup-qr">
          <div className="qep-setup-qr__header">
            <span className="qep-setup-qr__title">Customer Portal Setup</span>
            {setupComplete ? (
              <span className="qep-setup-qr__badge qep-setup-qr__badge--done">✓ Account created</span>
            ) : setupUrl ? (
              <span className="qep-setup-qr__badge">Scan or share to set up</span>
            ) : null}
          </div>

          {setupComplete ? (
            <p className="qep-setup-qr__done">
              This customer has already set up their portal account.
            </p>
          ) : setupUrl ? (
            <div className="qep-setup-qr__body">
              <div className="qep-setup-qr__code">
                <QRCodeSVG value={setupUrl} size={140} includeMargin />
              </div>
              <div className="qep-setup-qr__info">
                <p className="qep-setup-qr__hint">
                  Show or send this QR code so the customer can create their portal account.
                  They'll pick their role and set a password — no further action needed.
                </p>
                <div className="qep-setup-qr__actions">
                  <button
                    type="button"
                    className="qep-setup-qr__copy"
                    onClick={() => {
                      navigator.clipboard.writeText(setupUrl).catch(() => null)
                    }}
                  >
                    Copy link
                  </button>
                  <a
                    href={setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="qep-setup-qr__open"
                  >
                    Open ↗
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="qep-setup-qr__body qep-setup-qr__body--empty">
              <p className="qep-setup-qr__hint">
                Generate a setup link to create a QR code the customer can scan to create their portal account.
              </p>
              <button
                type="button"
                className="qep-setup-qr__generate"
                disabled={setupUrlLoading}
                onClick={() => {
                  if (!recipientId) return
                  setSetupUrlLoading(true)
                  const fn = httpsCallable<{ customerId: string }, { url: string }>(functions, 'generateSetupLink')
                  fn({ customerId: recipientId })
                    .then((res) => setSetupUrl(res.data.url))
                    .catch((err: { message?: string }) => setError(err.message ?? 'Failed to generate setup link.'))
                    .finally(() => setSetupUrlLoading(false))
                }}
              >
                {setupUrlLoading ? 'Generating…' : 'Generate QR setup link'}
              </button>
            </div>
          )}
        </div>
      )}

      {isDeclinedRevision && (
        <div className="qep-notice qep-notice--declined" role="status">
          This quote was declined by the customer. Edit freely and click <strong>Save &amp; Re-send</strong> to send a revised version.
        </div>
      )}

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
                  <div className="qep-recipient-picker">
                    <select
                      id="qep-recipient"
                      className="qep-select"
                      value={recipientId}
                      onChange={e => handleRecipientChange(e.target.value)}
                      disabled={isReadOnly}
                    >
                      <option value="">— Select customer or lead —</option>
                      {recipients.filter(r => r.type === 'customer').length > 0 && (
                        <optgroup label="Customers">
                          <option value={CREATE_CUSTOMER_OPTION}>+ New Customer</option>
                          {recipients
                            .filter(r => r.type === 'customer')
                            .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
                            .map(r => (
                              <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                        </optgroup>
                      )}
                      {recipients.filter(r => r.type === 'customer').length === 0 && !isReadOnly && (
                        <option value={CREATE_CUSTOMER_OPTION}>+ New Customer</option>
                      )}
                      {recipients.filter(r => r.type === 'lead').length > 0 && (
                        <optgroup label="Leads">
                          {recipients
                            .filter(r => r.type === 'lead')
                            .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
                            .map(r => (
                              <option key={r.id} value={r.id}>{r.label}</option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                    {!isReadOnly && (
                      <button
                        type="button"
                        className="qep-recipient-add"
                        onClick={() => setShowCreateCustomer(true)}
                      >
                        + New Customer
                      </button>
                    )}
                  </div>
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
              <LineItemsEditor
                items={productRows}
                products={filteredProducts}
                disabled={isReadOnly}
                canViewInternalPricing={pricingPermissions.canViewInternalPricing}
                canEditInternalPricing={pricingPermissions.canEditInternalPricing}
                enforceMarginFloor={pricingPermissions.enforceMarginFloor}
                onChange={setRows}
              />
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

              <div className="qep-addon qep-addon--tax">
                <p className="qep-addon__heading">Sales tax</p>
                <div className="qep-tax-toggle" role="radiogroup" aria-label="Sales tax choice">
                  <label className="qep-tax-option">
                    <input
                      type="radio"
                      name="qep-tax-mode"
                      checked={applySalesTax}
                      onChange={() => setApplySalesTax(true)}
                      disabled={isReadOnly}
                    />
                    <span>Apply sales tax</span>
                  </label>
                  <label className="qep-tax-option">
                    <input
                      type="radio"
                      name="qep-tax-mode"
                      checked={!applySalesTax}
                      onChange={() => setApplySalesTax(false)}
                      disabled={isReadOnly}
                    />
                    <span>Omit sales tax</span>
                  </label>
                </div>
                <div className="qep-addon__fields">
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
                  <p className="qep-tax-note">Sales tax is omitted for this quote.</p>
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
          <aside className="qep-sidebar" ref={summaryRef}>
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
                <div className="qep-summary__row">
                  <span>Pre-tax total</span>
                  <span>{formatCurrency(preTaxTotal)}</span>
                </div>
                <div className="qep-summary__row">
                  <span>{applySalesTax ? `Sales tax (${safeSalesTaxRatePercent.toFixed(2)}%)` : 'Sales tax omitted'}</span>
                  <span>{formatCurrency(applySalesTax ? salesTaxAmount : 0)}</span>
                </div>
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

      <div className="qep-mobile-summarybar">
        <div className="qep-mobile-summarybar__totals">
          <span>Total</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
        <button
          type="button"
          className="qep-mobile-summarybar__btn"
          onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span className="qep-icon" aria-hidden="true"><FlatIcon name="summary" /></span>
          <span>Review summary</span>
        </button>
      </div>

      <CustomerCreateModal
        open={showCreateCustomer}
        title="Create New Customer"
        onClose={() => setShowCreateCustomer(false)}
        onCreated={handleInlineCustomerCreated}
      />

      <Modal
        open={showDuplicateConfirm}
        onClose={() => {
          if (duplicateMutation.isPending) return
          setShowDuplicateConfirm(false)
        }}
        title="Duplicate Quote"
        size="sm"
      >
        <div>
          <p>
            Create a duplicate draft from this quote? The original quote will remain unchanged.
          </p>
          <div className="qep-confirm-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDuplicateConfirm(false)}
              disabled={duplicateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={duplicateMutation.isPending}
              onClick={() => duplicateMutation.mutate()}
            >
              Duplicate Quote
            </Button>
          </div>
        </div>
      </Modal>

      {pdfUrl && <PdfPreviewModal url={pdfUrl} onClose={() => setPdfUrl(null)} />}
    </div>
  )
}

export default QuoteEditorPage
