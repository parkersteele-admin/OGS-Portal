/**
 * src/pages/customer/InvoicesPage.tsx
 * Customer portal — Invoice history & payment
 *
 * • Summary bar: outstanding total (red if overdue), "Pay all outstanding"
 * • Filter tabs: All | Outstanding | Paid
 * • Invoice list with click-to-expand detail panel
 * • Detail: line items, payment history, pay / download actions
 * • Mobile: card list, full-width orange Pay button
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { subscribeToCustomerInvoices, generateInvoicePdf } from '../../services/invoiceService'
import { getPaymentsForInvoice } from '../../services/paymentService'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Invoice, InvoiceStatus, Payment } from '../../types/billing'
import { formatCurrency, formatDate } from '../../utils/format'
import './Invoices.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTSTANDING_STATUSES: InvoiceStatus[] = ['sent', 'overdue']

type FilterTab = 'all' | 'outstanding' | 'paid'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Treat a 'sent' invoice whose due date has passed as 'overdue'. */
function effectiveStatus(inv: Invoice): InvoiceStatus {
  if (inv.status === 'sent') {
    const due = inv.dueAt?.toDate?.()
    if (due && due < new Date()) return 'overdue'
  }
  return inv.status
}

function isOutstanding(inv: Invoice): boolean {
  return OUTSTANDING_STATUSES.includes(effectiveStatus(inv))
}

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'brand'

function StatusBadge({ inv }: { inv: Invoice }): React.ReactElement {
  const status = effectiveStatus(inv)
  const due    = inv.dueAt?.toDate?.()

  const map: Record<InvoiceStatus, { variant: BadgeVariant; label: string }> = {
    sent:    { variant: 'warning', label: due ? `Due ${formatDate(due)}` : 'Due' },
    overdue: { variant: 'danger',  label: 'Overdue' },
    paid:    { variant: 'success', label: 'Paid' },
    draft:   { variant: 'neutral', label: 'Draft' },
    void:    { variant: 'neutral', label: 'Void' },
  }
  const { variant, label } = map[status] ?? { variant: 'neutral' as BadgeVariant, label: status }
  return <Badge variant={variant}>{label}</Badge>
}

function methodLabel(method: Payment['method']): string {
  const map: Record<Payment['method'], string> = {
    card:  'Card',
    ach:   'ACH',
    check: 'Check',
    cash:  'Cash',
  }
  return map[method] ?? method
}

// ── Download icon ─────────────────────────────────────────────────────────────

const DownloadIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 2v7m0 0L5.5 6.5M8 9l2.5-2.5M3 12h10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// ── Payment history (lazy-loaded per invoice) ─────────────────────────────────

const PaymentHistory: React.FC<{ invoiceId: string }> = ({ invoiceId }) => {
  const [payments, setPayments] = useState<Payment[] | null>(null)

  useEffect(() => {
    getPaymentsForInvoice(invoiceId).then(setPayments)
  }, [invoiceId])

  if (payments === null) {
    return <p className="inv-panel__loading">Loading payments…</p>
  }
  if (payments.length === 0) return null

  return (
    <div className="inv-panel__section">
      <h4 className="inv-panel__section-title">Payment History</h4>
      <table className="inv-panel__table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Method</th>
            <th className="inv-col--right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{p.processedAt ? formatDate(p.processedAt) : formatDate(p.createdAt)}</td>
              <td>{methodLabel(p.method)}</td>
              <td className="inv-col--right">{formatCurrency(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  invoice:  Invoice
  onClose:  () => void
}

const DetailPanel: React.FC<DetailPanelProps> = ({ invoice, onClose }) => {
  const navigate      = useNavigate()
  const [dlBusy, setDlBusy] = useState(false)
  const outstanding   = isOutstanding(invoice)

  const handleDownload = useCallback(async () => {
    setDlBusy(true)
    try {
      const url = invoice.pdfUrl ?? await generateInvoicePdf(invoice.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setDlBusy(false)
    }
  }, [invoice])

  return (
    <aside className="inv-panel" aria-label="Invoice details">
      {/* Sticky header */}
      <div className="inv-panel__header">
        <div>
          <p className="inv-panel__inv-num">{invoice.invoiceNumber}</p>
          <p className="inv-panel__dates">
            Issued {formatDate(invoice.issuedAt)} · Due {formatDate(invoice.dueAt)}
          </p>
        </div>
        <button className="inv-panel__close" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      {/* Status + total */}
      <div className="inv-panel__status-row">
        <StatusBadge inv={invoice} />
        <span className="inv-panel__total">{formatCurrency(invoice.total)}</span>
      </div>

      {/* Line items */}
      <div className="inv-panel__section">
        <h4 className="inv-panel__section-title">Line Items</h4>
        <table className="inv-panel__table inv-panel__table--items">
          <thead>
            <tr>
              <th>Description</th>
              <th className="inv-col--right">Qty</th>
              <th className="inv-col--right">Unit Price</th>
              <th className="inv-col--right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, i) => (
              <tr key={i}>
                <td>{item.description}</td>
                <td className="inv-col--right">{item.quantity}</td>
                <td className="inv-col--right">{formatCurrency(item.unitPrice)}</td>
                <td className="inv-col--right">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="inv-col--right inv-panel__sub-label">Subtotal</td>
              <td className="inv-col--right">{formatCurrency(invoice.subtotal)}</td>
            </tr>
            {invoice.tax > 0 && (
              <tr>
                <td colSpan={3} className="inv-col--right inv-panel__sub-label">Tax</td>
                <td className="inv-col--right">{formatCurrency(invoice.tax)}</td>
              </tr>
            )}
            <tr className="inv-panel__total-row">
              <td colSpan={3} className="inv-col--right">Total Due</td>
              <td className="inv-col--right">{formatCurrency(invoice.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment history */}
      <PaymentHistory invoiceId={invoice.id} />

      {/* Sticky action bar */}
      <div className="inv-panel__actions">
        {outstanding && (
          <Button
            variant="primary"
            onClick={() => navigate(`/portal/invoices/${invoice.id}/pay`)}
          >
            Pay Now
          </Button>
        )}
        <Button variant="secondary" loading={dlBusy} onClick={handleDownload}>
          Download PDF
        </Button>
      </div>
    </aside>
  )
}

// ── Invoice row ───────────────────────────────────────────────────────────────

interface InvoiceRowProps {
  invoice:    Invoice
  selected:   boolean
  onClick:    () => void
  onPay:      () => void
  onDownload: () => void
  dlBusy:     boolean
}

const InvoiceRow: React.FC<InvoiceRowProps> = ({
  invoice, selected, onClick, onPay, onDownload, dlBusy,
}) => {
  const outstanding = isOutstanding(invoice)

  const stopAndCall = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, fn: () => void) => {
      e.stopPropagation()
      fn()
    },
    [],
  )

  return (
    <div
      className={`inv-row${selected ? ' inv-row--selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-pressed={selected}
    >
      <span className="inv-row__num">{invoice.invoiceNumber}</span>

      <span className="inv-row__dates">
        <span>{formatDate(invoice.issuedAt)}</span>
        <span className="inv-row__sep" aria-hidden="true">→</span>
        <span>{formatDate(invoice.dueAt)}</span>
      </span>

      <span className="inv-row__badge">
        <StatusBadge inv={invoice} />
      </span>

      <span className="inv-row__total">{formatCurrency(invoice.total)}</span>

      <span className="inv-row__actions" onClick={(e) => e.stopPropagation()}>
        {outstanding && (
          <Button
            variant="primary"
            size="sm"
            onClick={(e) => stopAndCall(e, onPay)}
          >
            Pay now
          </Button>
        )}
        <button
          className="inv-row__dl-btn"
          aria-label="Download PDF"
          title="Download PDF"
          disabled={dlBusy}
          onClick={(e) => stopAndCall(e, onDownload)}
        >
          {dlBusy ? <span className="inv-row__dl-spin" /> : <DownloadIcon />}
        </button>
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const InvoicesPage: React.FC = () => {
  const { user }    = useAuth()
  const navigate    = useNavigate()
  const customerId  = user?.customerId ?? ''

  const [invoices, setInvoices]   = useState<Invoice[]>([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<FilterTab>('all')
  const [selected, setSelected]   = useState<Invoice | null>(null)
  const [dlSet, setDlSet]         = useState<Set<string>>(new Set())

  // Track selected ID separately to avoid stale-closure loops in the sync effect
  const selectedIdRef = useRef<string | null>(null)
  useEffect(() => { selectedIdRef.current = selected?.id ?? null }, [selected])

  // Real-time invoice subscription
  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    const unsub = subscribeToCustomerInvoices(customerId, (data) => {
      setInvoices(data)
      setLoading(false)
    })
    return unsub
  }, [customerId])

  // Keep the open panel in sync when Firestore pushes an update
  useEffect(() => {
    if (!selectedIdRef.current) return
    const updated = invoices.find((inv) => inv.id === selectedIdRef.current)
    if (updated) setSelected(updated)
  }, [invoices])

  // Filtered list for the active tab
  const filtered = useMemo(() => {
    switch (tab) {
      case 'outstanding': return invoices.filter(isOutstanding)
      case 'paid':        return invoices.filter((inv) => inv.status === 'paid')
      default:            return invoices
    }
  }, [invoices, tab])

  // Summary bar data
  const outstandingList  = useMemo(() => invoices.filter(isOutstanding), [invoices])
  const outstandingTotal = outstandingList.reduce((sum, inv) => sum + inv.total, 0)
  const hasOverdue       = outstandingList.some((inv) => effectiveStatus(inv) === 'overdue')

  const handleDownload = useCallback(async (invoice: Invoice) => {
    setDlSet((prev) => new Set(prev).add(invoice.id))
    try {
      const url = invoice.pdfUrl ?? await generateInvoicePdf(invoice.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setDlSet((prev) => { const n = new Set(prev); n.delete(invoice.id); return n })
    }
  }, [])

  const toggleSelected = useCallback((inv: Invoice) => {
    setSelected((prev) => (prev?.id === inv.id ? null : inv))
  }, [])

  const panelOpen = selected !== null

  return (
    <div className={`inv-page${panelOpen ? ' inv-page--panel-open' : ''}`}>

      {/* ── Summary bar ──────────────────────────────────────────────── */}
      {outstandingList.length > 0 && (
        <div className={`inv-summary${hasOverdue ? ' inv-summary--overdue' : ''}`}>
          <div className="inv-summary__left">
            <span className="inv-summary__label">
              {outstandingList.length === 1
                ? '1 invoice outstanding'
                : `${outstandingList.length} invoices outstanding`}
            </span>
            <span className="inv-summary__amount">{formatCurrency(outstandingTotal)}</span>
          </div>
          {outstandingList.length > 1 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(`/portal/invoices/${outstandingList[0].id}/pay`)}
            >
              Pay all outstanding
            </Button>
          )}
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="inv-header">
        <h1 className="inv-header__title">Invoices</h1>
      </div>

      {/* ── Filter tabs ──────────────────────────────────────────────── */}
      <div className="inv-tabs" role="tablist">
        {(['all', 'outstanding', 'paid'] as FilterTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`inv-tab${tab === t ? ' inv-tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'all' ? 'All' : t === 'outstanding' ? 'Outstanding' : 'Paid'}
            {t === 'outstanding' && outstandingList.length > 0 && (
              <span className="inv-tab__badge">{outstandingList.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="inv-body">
        <div className="inv-list-wrap">

          {/* Desktop column headers */}
          <div className="inv-list-header" aria-hidden="true">
            <span>Invoice #</span>
            <span>Issued → Due</span>
            <span>Status</span>
            <span className="inv-col--right">Amount</span>
            <span />
          </div>

          {loading ? (
            <div className="inv-skeleton">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="inv-skeleton__row" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="inv-empty">
              <p>No invoices yet.</p>
            </div>
          ) : (
            filtered.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                selected={selected?.id === inv.id}
                onClick={() => toggleSelected(inv)}
                onPay={() => navigate(`/portal/invoices/${inv.id}/pay`)}
                onDownload={() => handleDownload(inv)}
                dlBusy={dlSet.has(inv.id)}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            invoice={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

export default InvoicesPage
