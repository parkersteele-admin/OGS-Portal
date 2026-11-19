/**
 * src/features/onboarding/OnboardingPacketsPanel.tsx
 *
 * Customer record → Onboarding tab. Send packets, track status, countersign,
 * and handle bank details for QuickBooks entry.
 */

import React, { useEffect, useState } from 'react'
import { Card, CardBody } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import type { Customer } from '../../types/customer'
import type { AppUser } from '../../types/user'
import { SendOnboardingPacketModal } from './SendOnboardingPacketModal'
import { SignaturePad } from './SignaturePad'
import {
  subscribeToCustomerPackets, resendOnboardingPacket, getOnboardingPacketLink, voidOnboardingPacket,
  countersignOnboardingPacket, revealOnboardingBankDetails, markOnboardingBankEntered, callableErrorMessage, signatureReady,
  type SignatureValue,
  type OnboardingPacketDoc, type PacketStatus,
} from './onboardingService'
import './onboarding.css'

interface Props {
  customer: Customer
  currentUser: AppUser | null
}

const STATUS: Record<PacketStatus, { label: string; variant: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  sent:          { label: 'Sent',                   variant: 'info' },
  viewed:        { label: 'Viewed',                 variant: 'warning' },
  signed:        { label: 'Needs countersignature', variant: 'brand' },
  countersigned: { label: 'Complete',               variant: 'success' },
  voided:        { label: 'Voided',                 variant: 'neutral' },
}

function ts(v?: { toDate?: () => Date } | null): string {
  const d = v?.toDate?.()
  return d ? d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export const OnboardingPacketsPanel: React.FC<Props> = ({ customer, currentUser }) => {
  const isAdmin = currentUser?.role === 'admin'
  const [packets, setPackets] = useState<OnboardingPacketDoc[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [showSend, setShowSend] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const [counterFor, setCounterFor] = useState<OnboardingPacketDoc | null>(null)
  const [bankFor, setBankFor] = useState<OnboardingPacketDoc | null>(null)

  useEffect(() => subscribeToCustomerPackets(customer.id, setPackets, (e) => setLoadError(e.message)), [customer.id])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(callableErrorMessage(e)) } finally { setBusy('') }
  }

  const copyLink = (p: OnboardingPacketDoc) => run(`copy-${p.id}`, async () => {
    const { url } = await getOnboardingPacketLink({ packetId: p.id })
    await navigator.clipboard.writeText(url)
    setNotice('Signing link copied — you can text it to the customer.')
  })

  const resend = (p: OnboardingPacketDoc) => run(`resend-${p.id}`, async () => {
    await resendOnboardingPacket({ packetId: p.id })
    setNotice(`Packet re-sent to ${p.recipientEmail}. Link extended 14 days.`)
  })

  const voidPacket = (p: OnboardingPacketDoc) => {
    if (!window.confirm('Void this packet? The customer\'s link will stop working.')) return
    void run(`void-${p.id}`, async () => { await voidOnboardingPacket({ packetId: p.id }) })
  }

  const open = packets?.find((p) => p.status === 'sent' || p.status === 'viewed')

  return (
    <div className="cr-tab-panel obs-panel" role="tabpanel">
      <Card>
        <CardBody>
          <div className="obs-panel__head">
            <div>
              <h3 className="obs-panel__title">Digital onboarding</h3>
              <p className="obs-muted">Product Supply Agreement, ACH / card payment authorization and W-9 — signed online.</p>
            </div>
            <Button onClick={() => setShowSend(true)} disabled={Boolean(open)} title={open ? 'Resend or void the open packet first' : undefined}>
              Send onboarding packet
            </Button>
          </div>

          {notice && <div className="obs-notice">{notice}</div>}
          {error && <div className="obs-error" role="alert">{error}</div>}
          {loadError && <div className="obs-error">{loadError}</div>}
          {packets === null && !loadError && <p className="obs-muted">Loading…</p>}
          {packets?.length === 0 && <p className="obs-empty">No onboarding packets sent yet.</p>}

          {packets?.map((p) => {
            const s = p.submission
            return (
              <div key={p.id} className="obs-packet">
                <div className="obs-packet__row">
                  <div>
                    <div className="obs-packet__to">{p.recipientName || p.recipientEmail} <span className="obs-muted">· {p.recipientEmail}</span></div>
                    <div className="obs-muted obs-small">Sent {ts(p.createdAt)} by {p.sentBy?.name || p.sentBy?.email}{p.remindersSent ? ` · ${p.remindersSent} reminder${p.remindersSent > 1 ? 's' : ''}` : ''}</div>
                  </div>
                  <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                </div>

                <ol className="obs-timeline">
                  <li className="is-done">Sent<span>{ts(p.createdAt)}</span></li>
                  <li className={p.viewedAt ? 'is-done' : ''}>Viewed<span>{ts(p.viewedAt)}</span></li>
                  <li className={p.signedAt ? 'is-done' : ''}>Customer signed<span>{ts(p.signedAt)}</span></li>
                  <li className={p.countersignedAt ? 'is-done' : ''}>OGS countersigned<span>{ts(p.countersignedAt)}</span></li>
                </ol>

                {s && (
                  <dl className="obs-dl">
                    <div><dt>Signer</dt><dd>{s.signer.name}, {s.signer.title}</dd></div>
                    <div><dt>Payment</dt><dd>{s.paymentMethod === 'ach' ? `ACH · ${s.bank?.bankName} ••••${s.bank?.accountLast4} (${s.bank?.accountType})` : 'Credit card — send QuickBooks payment link'}</dd></div>
                    {s.cageChoice !== 'not_applicable' && <div><dt>Cage</dt><dd>{{ rent: 'Rent', purchase: 'Purchase', undecided: 'Undecided', not_applicable: '' }[s.cageChoice]}</dd></div>}
                    <div><dt>Fee</dt><dd>{p.terms.onboardingFee.waived ? 'Waived' : `$${p.terms.onboardingFee.amount.toFixed(2)}`}</dd></div>
                    <div><dt>Invoices to</dt><dd>{s.info.apEmail || s.info.contactEmail}</dd></div>
                    {s.siteVisitNotes && <div className="obs-dl__wide"><dt>Site visit</dt><dd>{s.siteVisitNotes}</dd></div>}
                  </dl>
                )}

                {s?.paymentMethod === 'ach' && p.bankStatus && p.bankStatus !== 'none' && (
                  <div className={`obs-bank${p.bankStatus === 'pending_entry' ? ' is-pending' : ''}`}>
                    {p.bankStatus === 'pending_entry'
                      ? <>Bank details are waiting to be entered in QuickBooks. They're stored encrypted and will be deleted once marked entered.</>
                      : <>Bank details entered in QuickBooks — full numbers deleted from the portal.</>}
                    {p.bankStatus === 'pending_entry' && isAdmin && (
                      <Button size="sm" variant="secondary" onClick={() => setBankFor(p)}>Enter in QuickBooks</Button>
                    )}
                  </div>
                )}

                <div className="obs-packet__actions">
                  {p.files?.psa && <a className="obs-link" href={p.files.psa.url} target="_blank" rel="noreferrer">Supply agreement PDF</a>}
                  {p.files?.ach && <a className="obs-link" href={p.files.ach.url} target="_blank" rel="noreferrer">Payment authorization PDF</a>}
                  {(p.status === 'sent' || p.status === 'viewed') && <>
                    <Button size="sm" variant="secondary" onClick={() => resend(p)} disabled={!!busy}>{busy === `resend-${p.id}` ? 'Sending…' : 'Resend'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => copyLink(p)} disabled={!!busy}>Copy link</Button>
                    <Button size="sm" variant="ghost" onClick={() => voidPacket(p)} disabled={!!busy}>Void</Button>
                  </>}
                  {p.status === 'signed' && isAdmin && <Button size="sm" onClick={() => setCounterFor(p)}>Countersign</Button>}
                  {p.status === 'signed' && !isAdmin && <span className="obs-muted obs-small">Waiting on an admin to countersign.</span>}
                </div>
              </div>
            )
          })}
        </CardBody>
      </Card>

      {showSend && (
        <SendOnboardingPacketModal
          open={showSend}
          onClose={() => setShowSend(false)}
          customer={customer}
          currentUser={currentUser}
          onSent={() => setNotice('Onboarding packet sent.')}
        />
      )}
      {counterFor && <CountersignModal packet={counterFor} currentUser={currentUser} onClose={() => setCounterFor(null)} onDone={() => setNotice('Agreement countersigned — the executed copy was emailed to the customer.')} />}
      {bankFor && <BankEntryModal packet={bankFor} onClose={() => setBankFor(null)} onDone={() => setNotice('Bank details marked as entered and permanently deleted from the portal.')} />}
    </div>
  )
}

// ── Countersign ───────────────────────────────────────────────────────────────

const CountersignModal: React.FC<{ packet: OnboardingPacketDoc; currentUser: AppUser | null; onClose: () => void; onDone: () => void }> = ({ packet, currentUser, onClose, onDone }) => {
  const [name, setName] = useState(currentUser?.name || '')
  const [title, setTitle] = useState(currentUser?.position || '')
  const [sig, setSig] = useState<SignatureValue>({ method: 'typed' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim() || !title.trim() || !signatureReady(name, sig)) { setError('Name, title and signature are required.'); return }
    setSaving(true); setError('')
    try {
      await countersignOnboardingPacket({ packetId: packet.id, name, title, method: sig.method, ...(sig.method === 'drawn' ? { imageDataUrl: sig.imageDataUrl } : {}) })
      onDone(); onClose()
    } catch (e) { setError(callableErrorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title="Countersign supply agreement" size="md">
      <div className="obs-modal">
        <p className="obs-muted">Signing for Ohio Gas Supply Co. on the agreement with <strong>{packet.submission?.info.legalName || packet.customerName}</strong>. The fully executed PDF is emailed to the customer.</p>
        {packet.files?.psa && <p><a className="obs-link" href={packet.files.psa.url} target="_blank" rel="noreferrer">Review customer-signed agreement</a></p>}
        <div className="obs-grid">
          <label className="obs-field"><span>Name</span><input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="obs-field"><span>Title</span><input className="ui-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. President" /></label>
        </div>
        <SignaturePad name={name} value={sig} onChange={setSig} />
        {error && <div className="obs-error">{error}</div>}
        <div className="obs-actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Signing…' : 'Countersign'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Bank details → QuickBooks ─────────────────────────────────────────────────

const BankEntryModal: React.FC<{ packet: OnboardingPacketDoc; onClose: () => void; onDone: () => void }> = ({ packet, onClose, onDone }) => {
  const [details, setDetails] = useState<Awaited<ReturnType<typeof revealOnboardingBankDetails>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const reveal = async () => {
    setLoading(true); setError('')
    try { setDetails(await revealOnboardingBankDetails({ packetId: packet.id })) } catch (e) { setError(callableErrorMessage(e)) } finally { setLoading(false) }
  }

  const markEntered = async () => {
    setLoading(true); setError('')
    try { await markOnboardingBankEntered({ packetId: packet.id }); onDone(); onClose() } catch (e) { setError(callableErrorMessage(e)) } finally { setLoading(false) }
  }

  const copy = (v: string) => { void navigator.clipboard.writeText(v) }

  return (
    <Modal open onClose={onClose} title="Enter bank details in QuickBooks" size="md">
      <div className="obs-modal">
        <ol className="obs-steps-list">
          <li>In QuickBooks, open <strong>{packet.submission?.info.legalName || packet.customerName}</strong> and add a bank account payment method (Receive payment → Bank transfer → Enter bank info → save for future use).</li>
          <li>Reveal and copy the details below. Each reveal is logged.</li>
          <li>Once saved in QuickBooks, mark as entered — the full numbers are then permanently deleted here.</li>
        </ol>
        {!details ? (
          <Button variant="secondary" onClick={reveal} disabled={loading}>{loading ? 'Decrypting…' : 'Reveal bank details'}</Button>
        ) : (
          <dl className="obs-dl obs-dl--bank">
            <div><dt>Bank</dt><dd>{details.bankName}</dd></div>
            <div><dt>Account holder</dt><dd>{details.holderName}</dd></div>
            <div><dt>Account type</dt><dd>{details.accountType === 'savings' ? 'Savings' : 'Checking'}</dd></div>
            <div><dt>Routing number</dt><dd className="obs-mono">{details.routingNumber} <button type="button" className="obs-link" onClick={() => copy(details.routingNumber)}>Copy</button></dd></div>
            <div><dt>Account number</dt><dd className="obs-mono">{details.accountNumber} <button type="button" className="obs-link" onClick={() => copy(details.accountNumber)}>Copy</button></dd></div>
          </dl>
        )}
        <label className="obs-check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I saved this bank account in QuickBooks for this customer.
        </label>
        {error && <div className="obs-error">{error}</div>}
        <div className="obs-actions">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Close</Button>
          <Button onClick={markEntered} disabled={!confirmed || loading}>Mark entered &amp; delete</Button>
        </div>
      </div>
    </Modal>
  )
}
