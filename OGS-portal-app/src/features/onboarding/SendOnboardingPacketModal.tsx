/**
 * src/features/onboarding/SendOnboardingPacketModal.tsx
 *
 * Staff modal: configure and email a digital onboarding packet.
 */

import React, { useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import type { Customer } from '../../types/customer'
import type { AppUser } from '../../types/user'
import { formatAddress } from '../../utils/addressUtils'
import {
  createOnboardingPacket, callableErrorMessage, defaultPersonalMessage, DEFAULT_RATE_SCHEDULE,
  type PacketCustomerInfo, type RateLine,
} from './onboardingService'

interface Props {
  open: boolean
  onClose: () => void
  customer: Customer
  currentUser: AppUser | null
  onSent: (url: string) => void
}

function billingAddressString(c: Customer): string {
  const b = c.billingAddress as Record<string, string | undefined> | null | undefined
  if (b) {
    const line = b.line1 || b.street || ''
    const parts = [line, b.line2, b.city, [b.state, b.zip].filter(Boolean).join(' ')].filter(Boolean)
    if (line) return parts.join(', ')
  }
  return formatAddress(c)
}

function buildPrefill(c: Customer): PacketCustomerInfo {
  const contacts = c.contacts ?? []
  const primary = contacts.find((x) => x.isPrimary) ?? contacts[0]
  const billing = contacts.find((x) => /bill|account|ap\b|payable/i.test(x.role || ''))
  return {
    legalName: c.companyName || c.name || '',
    billingAddress: billingAddressString(c),
    deliveryAddress: formatAddress(c),
    contactName: primary?.name || c.name || '',
    contactTitle: primary?.role || '',
    contactEmail: primary?.email || c.email || '',
    contactPhone: primary?.phone || c.phone || c.mainPhone || '',
    apEmail: billing?.email || '',
    apPhone: billing?.phone || '',
  }
}

export const SendOnboardingPacketModal: React.FC<Props> = ({ open, onClose, customer, currentUser, onSent }) => {
  const prefill = useMemo(() => buildPrefill(customer), [customer])
  const [recipientName, setRecipientName] = useState(prefill.contactName)
  const [recipientEmail, setRecipientEmail] = useState(prefill.contactEmail)
  const [message, setMessage] = useState(() => defaultPersonalMessage(prefill.contactName.split(' ')[0], currentUser?.name || ''))
  const [feeWaived, setFeeWaived] = useState(true)
  const [feeAmount, setFeeAmount] = useState('0')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [serviceMethod, setServiceMethod] = useState('Cylinder exchange')
  const [paymentTerms, setPaymentTerms] = useState(customer.paymentTerms && !/due on receipt|cod/i.test(customer.paymentTerms) ? customer.paymentTerms : 'Payment on delivery')
  const [askCage, setAskCage] = useState(true)
  const [rates, setRates] = useState<RateLine[]>(DEFAULT_RATE_SCHEDULE)
  const [repName, setRepName] = useState(currentUser?.name || '')
  const [repPhone, setRepPhone] = useState(currentUser?.phone || '')
  const [repEmail, setRepEmail] = useState(currentUser?.email || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const updateRate = (i: number, k: keyof RateLine, v: string) => setRates((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))

  const send = async () => {
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) { setError('Enter a valid recipient email.'); return }
    setSending(true)
    try {
      const res = await createOnboardingPacket({
        customerId: customer.id,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        personalMessage: message,
        prefill,
        terms: {
          effectiveDate,
          rateSchedule: rates.filter((r) => r.label.trim()),
          onboardingFee: { waived: feeWaived, amount: feeWaived ? 0 : Number(feeAmount) || 0 },
          serviceMethod,
          paymentTerms,
          rep: { name: repName, phone: repPhone, email: repEmail },
          askCageChoice: askCage,
        },
      })
      onSent(res.url)
      onClose()
    } catch (e) {
      setError(callableErrorMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send onboarding packet" size="lg">
      <div className="obs-modal">
        <p className="obs-muted">
          Emails a secure link to review and sign the Product Supply Agreement and Payment Authorization. The W-9 is attached. Company details below are pre-filled for the customer to confirm.
        </p>

        <div className="obs-grid">
          <label className="obs-field"><span>Recipient name</span>
            <input className="ui-input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></label>
          <label className="obs-field"><span>Recipient email</span>
            <input className="ui-input" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} /></label>
        </div>

        <label className="obs-field"><span>Email message</span>
          <textarea className="ui-input obs-textarea" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} /></label>

        <h4 className="obs-h">Agreement terms</h4>
        <div className="obs-grid obs-grid--3">
          <label className="obs-field"><span>Onboarding fee</span>
            <select className="ui-input" value={feeWaived ? 'waived' : 'charge'} onChange={(e) => setFeeWaived(e.target.value === 'waived')}>
              <option value="waived">Waived</option>
              <option value="charge">Charge fee</option>
            </select></label>
          {!feeWaived && (
            <label className="obs-field"><span>Fee amount ($)</span>
              <input className="ui-input" type="number" min="0" step="0.01" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} /></label>
          )}
          <label className="obs-field"><span>Effective date</span>
            <input className="ui-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></label>
          <label className="obs-field"><span>Service method</span>
            <select className="ui-input" value={serviceMethod} onChange={(e) => setServiceMethod(e.target.value)}>
              <option>Cylinder exchange</option>
              <option>Cylinder refill</option>
              <option>Bulk delivery</option>
            </select></label>
          <label className="obs-field obs-field--wide"><span>Payment terms</span>
            <input className="ui-input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></label>
        </div>
        <label className="obs-check">
          <input type="checkbox" checked={askCage} onChange={(e) => setAskCage(e.target.checked)} />
          Ask the customer to choose purchase or rent for the 12-cylinder cage
        </label>

        <h4 className="obs-h">Initial rate schedule</h4>
        <table className="obs-rates">
          <thead><tr><th>Product or service</th><th>Initial charge</th><th>Billing basis</th><th /></tr></thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={i}>
                <td><input className="ui-input" value={r.label} onChange={(e) => updateRate(i, 'label', e.target.value)} /></td>
                <td><input className="ui-input" value={r.charge} onChange={(e) => updateRate(i, 'charge', e.target.value)} /></td>
                <td><input className="ui-input" value={r.basis} onChange={(e) => updateRate(i, 'basis', e.target.value)} /></td>
                <td><button type="button" className="obs-icon-btn" aria-label="Remove row" onClick={() => setRates(rates.filter((_, idx) => idx !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="obs-link" onClick={() => setRates([...rates, { label: '', charge: '', basis: '' }])}>+ Add line</button>

        <h4 className="obs-h">Account representative</h4>
        <div className="obs-grid obs-grid--3">
          <label className="obs-field"><span>Name</span><input className="ui-input" value={repName} onChange={(e) => setRepName(e.target.value)} /></label>
          <label className="obs-field"><span>Phone</span><input className="ui-input" value={repPhone} onChange={(e) => setRepPhone(e.target.value)} /></label>
          <label className="obs-field"><span>Email</span><input className="ui-input" value={repEmail} onChange={(e) => setRepEmail(e.target.value)} /></label>
        </div>

        {error && <div className="obs-error" role="alert">{error}</div>}

        <div className="obs-actions">
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Send packet'}</Button>
        </div>
      </div>
    </Modal>
  )
}
