/**
 * src/features/operations/components/InvoiceDetailDrawer.tsx
 *
 * Invoice detail drawer showing full invoice info, line items, status,
 * history, and action buttons to view PDF, update status, and manage payment.
 */

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { Invoice, InvoiceStatus } from '../../../types/billing'
import { updateInvoice } from '../../../services/invoiceService'
import { Button } from '../../../components/ui/Button'
import './InvoiceDetailDrawer.css'

interface InvoiceDetailDrawerProps {
  invoice: Invoice
  isOpen: boolean
  onClose: () => void
  onInvoiceUpdated?: (updated: Invoice) => void
}

export function InvoiceDetailDrawer({
  invoice,
  isOpen,
  onClose,
  onInvoiceUpdated,
}: InvoiceDetailDrawerProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPaidDateModal, setShowPaidDateModal] = useState(false)
  const [paidDate, setPaidDate] = useState(
    invoice.paidAt
      ? new Date(invoice.paidAt.toDate()).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
  )

  if (!isOpen) return null

  function fmtCurrency(n: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(n)
  }

  function fmtDate(ts: { toDate?: () => Date } | null | undefined): string {
    if (!ts?.toDate) return '—'
    return ts.toDate().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  async function handleStatusChange(newStatus: InvoiceStatus) {
    setIsUpdatingStatus(true)
    try {
      const updateData: { status: InvoiceStatus } = { status: newStatus }

      if (newStatus === 'paid') {
        setShowStatusMenu(false)
        setShowPaidDateModal(true)
        setIsUpdatingStatus(false)
        return
      }

      await updateInvoice(invoice.id, updateData)

      // Reload updated invoice
      if (onInvoiceUpdated) {
        const updatedInvoice: Invoice = { ...invoice, ...updateData }
        onInvoiceUpdated(updatedInvoice)
      }

      setShowStatusMenu(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update invoice status.'
      alert(message)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  async function handleMarkPaid() {
    setIsUpdatingStatus(true)
    try {
      const dateObj = new Date(paidDate)
      await updateInvoice(invoice.id, {
        status: 'paid',
        paidAt: dateObj as never,
      })

      if (onInvoiceUpdated) {
        const updatedInvoice: Invoice = {
          ...invoice,
          status: 'paid',
          paidAt: dateObj as never,
        }
        onInvoiceUpdated(updatedInvoice)
      }

      setShowPaidDateModal(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark invoice as paid.'
      alert(message)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  async function handleViewPdf() {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, '_blank')
    }
  }

  const statusOptions: Array<{ value: InvoiceStatus; label: string }> = [
    { value: 'sent', label: 'Sent' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ]

  return (
    <>
      {/* Overlay */}
      <div
        className="inv-drawer-overlay"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="inv-drawer">
        {/* Header */}
        <div className="inv-drawer__header">
          <div>
            <h2 className="inv-drawer__title">{invoice.invoiceNumber}</h2>
            <p className="inv-drawer__subtitle">Invoice Details</p>
          </div>
          <button
            className="inv-drawer__close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="inv-drawer__body">
          {/* Status Section */}
          <section className="inv-drawer__section">
            <h3 className="inv-drawer__section-title">Status</h3>
            <div className="inv-drawer__status-row">
              <span className="inv-drawer__status-badge" data-status={invoice.status}>
                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
              </span>
              <div className="inv-drawer__status-menu-wrapper">
                <button
                  className="inv-drawer__status-btn"
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  disabled={isUpdatingStatus}
                >
                  Update Status
                </button>
                {showStatusMenu && (
                  <div className="inv-drawer__status-dropdown">
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`inv-drawer__status-option${
                          invoice.status === option.value ? ' inv-drawer__status-option--active' : ''
                        }`}
                        onClick={() => handleStatusChange(option.value)}
                        disabled={isUpdatingStatus || invoice.status === option.value}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {invoice.paidAt && (
              <p className="inv-drawer__paid-date">Paid on {fmtDate(invoice.paidAt)}</p>
            )}
          </section>

          {/* Dates Section */}
          <section className="inv-drawer__section">
            <h3 className="inv-drawer__section-title">Dates</h3>
            <div className="inv-drawer__row">
              <span className="inv-drawer__label">Issued</span>
              <span className="inv-drawer__value">{fmtDate(invoice.issuedAt)}</span>
            </div>
            <div className="inv-drawer__row">
              <span className="inv-drawer__label">Due</span>
              <span className="inv-drawer__value">{fmtDate(invoice.dueAt)}</span>
            </div>
            {invoice.serviceDate && (
              <div className="inv-drawer__row">
                <span className="inv-drawer__label">Service Date</span>
                <span className="inv-drawer__value">{fmtDate(invoice.serviceDate)}</span>
              </div>
            )}
          </section>

          {/* Line Items Section */}
          <section className="inv-drawer__section">
            <h3 className="inv-drawer__section-title">Line Items</h3>
            <table className="inv-drawer__table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.description}</td>
                    <td className="inv-drawer__table-num">{item.quantity}</td>
                    <td className="inv-drawer__table-num">{fmtCurrency(item.unitPrice)}</td>
                    <td className="inv-drawer__table-num">{fmtCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Totals Section */}
          <section className="inv-drawer__section">
            <h3 className="inv-drawer__section-title">Totals</h3>
            <div className="inv-drawer__row">
              <span className="inv-drawer__label">Subtotal</span>
              <span className="inv-drawer__value">{fmtCurrency(invoice.subtotal)}</span>
            </div>
            {invoice.tax > 0 && (
              <div className="inv-drawer__row">
                <span className="inv-drawer__label">Tax</span>
                <span className="inv-drawer__value">{fmtCurrency(invoice.tax)}</span>
              </div>
            )}
            <div className="inv-drawer__row inv-drawer__row--total">
              <span className="inv-drawer__label">Total</span>
              <span className="inv-drawer__value">{fmtCurrency(invoice.total)}</span>
            </div>
          </section>

          {/* Customer Section */}
          {invoice.customerContactName || invoice.customerContactEmail && (
            <section className="inv-drawer__section">
              <h3 className="inv-drawer__section-title">Customer</h3>
              {invoice.customerContactName && (
                <div className="inv-drawer__row">
                  <span className="inv-drawer__label">Contact</span>
                  <span className="inv-drawer__value">{invoice.customerContactName}</span>
                </div>
              )}
              {invoice.customerContactEmail && (
                <div className="inv-drawer__row">
                  <span className="inv-drawer__label">Email</span>
                  <span className="inv-drawer__value inv-drawer__value--email">
                    {invoice.customerContactEmail}
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Notes Section */}
          {invoice.notes && (
            <section className="inv-drawer__section">
              <h3 className="inv-drawer__section-title">Notes</h3>
              <p className="inv-drawer__note">{invoice.notes}</p>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="inv-drawer__footer">
          {invoice.pdfUrl && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleViewPdf}
            >
              <FileText size={14} aria-hidden="true" /> View PDF
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Paid Date Modal */}
      {showPaidDateModal && (
        <div className="inv-drawer__modal-overlay" onClick={() => !isUpdatingStatus && setShowPaidDateModal(false)}>
          <div className="inv-drawer__modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-drawer__modal-title">Mark as Paid</h3>
            <p className="inv-drawer__modal-text">When was this invoice paid?</p>
            <input
              type="date"
              className="inv-drawer__modal-input"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              disabled={isUpdatingStatus}
            />
            <div className="inv-drawer__modal-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={handleMarkPaid}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? 'Saving...' : 'Mark Paid'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPaidDateModal(false)}
                disabled={isUpdatingStatus}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
