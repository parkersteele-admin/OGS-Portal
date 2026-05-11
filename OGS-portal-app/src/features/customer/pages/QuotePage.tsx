/**
 * src/features/customer/pages/QuotePage.tsx
 *
 * Customer portal — Quote detail & acceptance
 *
 * Customers land here from the "Accept This Quote" link in a quote email.
 * They can review line items and click Accept or Decline.
 */

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../../lib/firebase'
import { subscribeToQuote } from '../../../services/quoteService'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import type { Quote, QuoteStatus } from '../../../types/crm'
import { formatCurrency, formatDate } from '../../../utils/format'
import './QuotePage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'brand'

function StatusBadge({ status }: { status: QuoteStatus }): React.ReactElement {
  const map: Record<QuoteStatus, { variant: BadgeVariant; label: string }> = {
    draft:    { variant: 'neutral', label: 'Draft' },
    sent:     { variant: 'info',    label: 'Awaiting Response' },
    accepted: { variant: 'success', label: 'Accepted' },
    declined: { variant: 'danger',  label: 'Declined' },
    expired:  { variant: 'neutral', label: 'Expired' },
  }
  const { variant, label } = map[status] ?? { variant: 'neutral' as BadgeVariant, label: status }
  return <Badge variant={variant}>{label}</Badge>
}

// ── Page ──────────────────────────────────────────────────────────────────────

const QuotePage: React.FC = () => {
  const { quoteId }                   = useParams<{ quoteId: string }>()
  const navigate                      = useNavigate()
  const [quote, setQuote]             = useState<Quote | null>(null)
  const [loading, setLoading]         = useState(true)
  const [notFound, setNotFound]       = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!quoteId) { setNotFound(true); setLoading(false); return }

    const unsub = subscribeToQuote(quoteId, (q) => {
      if (q === null) setNotFound(true)
      else setQuote(q)
      setLoading(false)
    })
    return unsub
  }, [quoteId])

  async function respond(response: 'accepted' | 'declined'): Promise<void> {
    if (!quoteId) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const fn = httpsCallable<{ quoteId: string; response: string }, { success: boolean }>(
        functions,
        'respondToQuote',
      )
      await fn({ quoteId, response })
      // Firestore subscription will update `quote` in real-time
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="qp-loading">
        <span className="layout-loading__spinner" />
      </div>
    )
  }

  if (notFound || !quote) {
    return (
      <div className="qp-empty">
        <p className="qp-empty__msg">This quote could not be found or you don't have access to it.</p>
        <Button variant="secondary" onClick={() => navigate('/portal/dashboard')}>
          Back to Dashboard
        </Button>
      </div>
    )
  }

  const validUntil  = quote.validUntil?.toDate?.()
  const acceptedAt  = quote.acceptedAt?.toDate?.()
  const isExpired   = validUntil && validUntil < new Date() && quote.status === 'sent'
  const canRespond  = quote.status === 'sent' && !isExpired
  const salesTaxAmount = quote.salesTaxAmount ?? quote.tax ?? 0
  const salesTaxRate = quote.salesTaxRate ?? quote.taxRate ?? 0
  const applySalesTax = quote.applySalesTax ?? (salesTaxRate > 0 || salesTaxAmount > 0)
  const visibleTaxAmount = applySalesTax ? salesTaxAmount : 0
  const taxLabel = applySalesTax
    ? (salesTaxRate > 0 ? `Sales Tax (${(salesTaxRate * 100).toFixed(2)}%)` : 'Sales Tax')
    : 'Sales Tax Omitted'

  return (
    <div className="qp">
      {/* Header */}
      <div className="qp__header">
        <div className="qp__header-left">
          <h1 className="qp__title">Quote #{quote.quoteNumber}</h1>
          <StatusBadge status={isExpired ? 'expired' : quote.status} />
        </div>
        {validUntil && (
          <p className="qp__expires">
            {isExpired ? 'Expired' : 'Valid until'} {formatDate(validUntil)}
          </p>
        )}
      </div>

      {/* Line items */}
      <div className="qp__card">
        <h2 className="qp__section-title">Quote Details</h2>
        <table className="qp__table" aria-label="Quote line items">
          <thead>
            <tr>
              <th className="qp__th qp__th--desc">Description</th>
              <th className="qp__th qp__th--num">Qty</th>
              <th className="qp__th qp__th--num">Unit Price</th>
              <th className="qp__th qp__th--num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.map((item, i) => (
              <tr key={i} className="qp__tr">
                <td className="qp__td">{item.description}</td>
                <td className="qp__td qp__td--num">{item.quantity}</td>
                <td className="qp__td qp__td--num">{formatCurrency(item.unitPrice)}</td>
                <td className="qp__td qp__td--num">{formatCurrency(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="qp__tr-total">
              <td colSpan={3} className="qp__td qp__td--total-label">Subtotal</td>
              <td className="qp__td qp__td--num">{formatCurrency(quote.subtotal)}</td>
            </tr>
            <tr className="qp__tr-total">
              <td colSpan={3} className="qp__td qp__td--total-label">{taxLabel}</td>
              <td className="qp__td qp__td--num">{formatCurrency(visibleTaxAmount)}</td>
            </tr>
            <tr className="qp__tr-grand">
              <td colSpan={3} className="qp__td qp__td--grand-label">Total</td>
              <td className="qp__td qp__td--grand-num">{formatCurrency(quote.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Notes */}
      {quote.notes && (
        <div className="qp__card qp__card--notes">
          <h2 className="qp__section-title">Notes</h2>
          <p className="qp__notes-text">{quote.notes}</p>
        </div>
      )}

      {/* Response area */}
      {canRespond && (
        <div className="qp__card qp__card--actions">
          <h2 className="qp__section-title">Your Response</h2>
          <p className="qp__action-desc">
            Accepting this quote locks in the prices shown above for your account. You'll be able to
            place orders at these rates immediately.
          </p>
          {submitError && <p className="qp__error">{submitError}</p>}
          <div className="qp__action-row">
            <Button
              variant="primary"
              onClick={() => respond('accepted')}
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Accept Quote'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => respond('declined')}
              disabled={submitting}
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Accepted confirmation */}
      {quote.status === 'accepted' && (
        <div className="qp__card qp__card--accepted">
          <p className="qp__accepted-msg">
            ✓ You accepted this quote{acceptedAt ? ` on ${formatDate(acceptedAt)}` : ''}.
            Your negotiated pricing is now active on your account.
          </p>
          <Button variant="primary" onClick={() => navigate('/portal/catalog')}>
            View My Products
          </Button>
        </div>
      )}

      {/* Declined confirmation */}
      {quote.status === 'declined' && (
        <div className="qp__card qp__card--declined">
          <p className="qp__declined-msg">
            You declined this quote. Contact your sales rep if you'd like to revisit pricing.
          </p>
          <Button variant="secondary" onClick={() => navigate('/portal/dashboard')}>
            Back to Dashboard
          </Button>
        </div>
      )}

      {/* Expired */}
      {isExpired && (
        <div className="qp__card qp__card--expired">
          <p className="qp__expired-msg">
            This quote has expired. Contact your sales rep to request an updated quote.
          </p>
        </div>
      )}
    </div>
  )
}

export default QuotePage
