/**
 * src/features/onboarding/PublicOnboardingPage.tsx
 *
 * Public onboarding packet — /onboard/:token (no login).
 * Steps: Company info → Agreement → Payment → Review & sign.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getOnboardingPacketPublic, getOnboardingW9, submitOnboardingPacket, callableErrorMessage, signatureReady,
  type PublicPacketResponse, type SignatureValue, type PacketCustomerInfo, type CageChoice,
} from './onboardingService'
import { SignaturePad } from './SignaturePad'
import './onboarding.css'

type OpenPacket = Extract<PublicPacketResponse, { status: 'open' }>

const STEPS = ['Company info', 'Agreement', 'Payment', 'Sign'] as const

function abaValid(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false
  const n = r.split('').map(Number)
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0
}

const Field: React.FC<{
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string
  placeholder?: string; autoComplete?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; full?: boolean
}> = ({ label, value, onChange, required, type = 'text', placeholder, autoComplete, inputMode, full }) => (
  <label className={`obp-field${full ? ' obp-field--full' : ''}`}>
    <span className="obp-field__label">{label}{required && <span className="obp-req"> *</span>}</span>
    <input className="obp-input" type={type} value={value} placeholder={placeholder} autoComplete={autoComplete}
      inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
  </label>
)

export default function PublicOnboardingPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicPacketResponse | null>(null)
  const [loadError, setLoadError] = useState('')
  const [step, setStep] = useState(0)
  const [info, setInfo] = useState<PacketCustomerInfo | null>(null)
  const [cageChoice, setCageChoice] = useState<CageChoice>('undecided')
  const [siteVisitNotes, setSiteVisitNotes] = useState('')
  const [agreementRead, setAgreementRead] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'ach' | 'card'>('ach')
  const [bank, setBank] = useState({ bankName: '', holderName: '', accountType: 'checking' as 'checking' | 'savings', routingNumber: '', accountNumber: '', accountConfirm: '' })
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [sig, setSig] = useState<SignatureValue>({ method: 'typed' })
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [esignConsent, setEsignConsent] = useState(false)
  const [stepError, setStepError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ joinUrl: string | null } | null>(null)

  useEffect(() => {
    getOnboardingPacketPublic({ token })
      .then((res) => {
        setData(res)
        if (res.status === 'open') {
          setInfo(res.prefill)
          setSignerName(res.prefill.contactName)
          setSignerTitle(res.prefill.contactTitle)
          setBank((b) => ({ ...b, holderName: res.prefill.legalName }))
        }
      })
      .catch((err) => setLoadError(callableErrorMessage(err, 'We couldn\'t load this onboarding link.')))
  }, [token])

  const packet = data?.status === 'open' ? (data as OpenPacket) : null
  const company = data?.company

  const setI = (k: keyof PacketCustomerInfo) => (v: string) => setInfo((p) => (p ? { ...p, [k]: v } : p))

  const stepValid = useMemo(() => (s: number): string => {
    if (!info) return 'Loading…'
    if (s === 0) {
      const missing = ([
        ['legalName', 'legal name'], ['billingAddress', 'billing address'], ['deliveryAddress', 'delivery address'],
        ['contactName', 'contact name'], ['contactTitle', 'contact title'], ['contactEmail', 'contact email'], ['contactPhone', 'contact phone'],
      ] as Array<[keyof PacketCustomerInfo, string]>).filter(([k]) => !info[k].trim()).map(([, l]) => l)
      if (missing.length) return `Please complete: ${missing.join(', ')}.`
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.contactEmail)) return 'Contact email is not valid.'
      if (info.apEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.apEmail)) return 'Accounts payable email is not valid.'
    }
    if (s === 1 && !agreementRead) return 'Please confirm you have reviewed the agreement.'
    if (s === 2 && paymentMethod === 'ach') {
      if (!bank.bankName.trim() || !bank.holderName.trim()) return 'Bank name and account holder name are required.'
      if (!abaValid(bank.routingNumber)) return 'Routing number is not valid — it should be the 9-digit number on your checks.'
      if (!/^\d{4,17}$/.test(bank.accountNumber)) return 'Bank account number is not valid.'
      if (bank.accountNumber !== bank.accountConfirm) return 'Account numbers do not match.'
    }
    if (s === 3) {
      if (!signerName.trim() || !signerTitle.trim()) return 'Enter your full name and title.'
      if (!signatureReady(signerName, sig)) return 'Please add your signature.'
      if (!agreeTerms || !esignConsent) return 'Please check both boxes to sign.'
    }
    return ''
  }, [info, agreementRead, paymentMethod, bank, signerName, signerTitle, sig, agreeTerms, esignConsent])

  const next = () => {
    const err = stepValid(step)
    setStepError(err)
    if (!err) { setStep((s) => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }

  const back = () => { setStepError(''); setStep((s) => Math.max(0, s - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const submit = async () => {
    const err = stepValid(3)
    setStepError(err)
    if (err || !info) return
    setSubmitting(true)
    try {
      const res = await submitOnboardingPacket({
        token,
        info,
        cageChoice: packet?.terms.askCageChoice ? cageChoice : 'not_applicable',
        siteVisitNotes,
        paymentMethod,
        ...(paymentMethod === 'ach' ? {
          bank: { bankName: bank.bankName, holderName: bank.holderName, accountType: bank.accountType, routingNumber: bank.routingNumber, accountNumber: bank.accountNumber },
        } : {}),
        signature: { name: signerName, title: signerTitle, method: sig.method, ...(sig.method === 'drawn' ? { imageDataUrl: sig.imageDataUrl } : {}) },
        esignConsent,
        agreeTerms,
      })
      setDone({ joinUrl: res.joinUrl })
      window.scrollTo({ top: 0 })
    } catch (e) {
      setStepError(callableErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const downloadW9 = async () => {
    try {
      const { fileName, base64 } = await getOnboardingW9({ token })
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url; a.download = fileName; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      setStepError(callableErrorMessage(e, 'Could not download the W-9.'))
    }
  }

  // ── Shell ───────────────────────────────────────────────────────────────
  const header = (
    <header className="obp-topbar">
      <div className="obp-topbar__inner">
        {company?.logoUrl ? <img src={company.logoUrl} alt={company.name} className="obp-topbar__logo" /> : <strong>{company?.name || 'Ohio Gas Supply'}</strong>}
        <span className="obp-topbar__secure">Secure account setup</span>
      </div>
    </header>
  )

  if (loadError) {
    return <div className="obp-shell">{header}<main className="obp-main"><div className="obp-card obp-state">
      <h1>Link unavailable</h1><p>{loadError}</p>
      <p className="obp-muted">Call (740) 272-5359 or reply to the email you received.</p>
    </div></main></div>
  }

  if (!data) {
    return <div className="obp-shell">{header}<main className="obp-main"><div className="obp-card obp-state"><div className="obp-spinner" /><p>Loading your documents…</p></div></main></div>
  }

  if (done || data.status !== 'open') {
    const joinUrl = done?.joinUrl
    return <div className="obp-shell">{header}<main className="obp-main"><div className="obp-card obp-state">
      <div className="obp-check" aria-hidden><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <h1>{done ? 'You\'re all set' : 'Already signed'}</h1>
      <p>{done
        ? 'Thanks — your signed agreement and payment authorization have been sent to your email. We\'ll be in touch to confirm your site visit and first delivery.'
        : `These documents for ${data.customerName} have already been signed. Check your email for your copies.`}</p>
      {joinUrl && <>
        <p>Next, create your customer portal login to place orders, track deliveries and view invoices.</p>
        <a className="obp-btn obp-btn--primary" href={joinUrl}>Create portal account</a>
      </>}
    </div></main></div>
  }

  const p = packet!
  const docs = p.documents
  const fee = p.terms.onboardingFee

  return (
    <div className="obp-shell">
      {header}
      <main className="obp-main">
        <div className="obp-intro">
          <h1>Welcome, {p.customerName}</h1>
          <p className="obp-muted">Complete your Ohio Gas Supply account setup in about 5 minutes. Everything is signed online.</p>
        </div>

        <ol className="obp-steps" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className={`obp-steps__item${i === step ? ' is-current' : ''}${i < step ? ' is-done' : ''}`}>
              <span className="obp-steps__num">{i < step ? '✓' : i + 1}</span>
              <span className="obp-steps__label">{label}</span>
            </li>
          ))}
        </ol>

        <div className="obp-card">
          {step === 0 && info && (
            <section>
              <h2>Company information</h2>
              <p className="obp-muted">Confirm the details we'll use on your agreement and invoices.</p>
              <div className="obp-grid">
                <Field full label="Customer legal name" required value={info.legalName} onChange={setI('legalName')} autoComplete="organization" />
                <Field full label="Billing address" required value={info.billingAddress} onChange={setI('billingAddress')} placeholder="Street, City, State ZIP" />
                <Field full label="Delivery address" required value={info.deliveryAddress} onChange={setI('deliveryAddress')} placeholder="Street, City, State ZIP" />
                <Field label="Authorized contact name" required value={info.contactName} onChange={setI('contactName')} autoComplete="name" />
                <Field label="Title" required value={info.contactTitle} onChange={setI('contactTitle')} autoComplete="organization-title" />
                <Field label="Contact email" required type="email" value={info.contactEmail} onChange={setI('contactEmail')} autoComplete="email" />
                <Field label="Contact phone" required type="tel" value={info.contactPhone} onChange={setI('contactPhone')} autoComplete="tel" />
                <Field label="Accounts payable email" type="email" value={info.apEmail} onChange={setI('apEmail')} placeholder="Where invoices should go" />
                <Field label="Accounts payable phone" type="tel" value={info.apPhone} onChange={setI('apPhone')} />
              </div>

              {p.terms.askCageChoice && (
                <fieldset className="obp-fieldset">
                  <legend>12-cylinder storage cage</legend>
                  <div className="obp-choice-row">
                    {([
                      ['rent', 'Rent', rateFor(p, 'rental') || 'Monthly rental'],
                      ['purchase', 'Purchase', rateFor(p, 'purchase') || 'One-time purchase'],
                      ['undecided', 'Not sure yet', 'Discuss at site visit'],
                    ] as Array<[CageChoice, string, string]>).map(([val, label, sub]) => (
                      <label key={val} className={`obp-choice${cageChoice === val ? ' is-selected' : ''}`}>
                        <input type="radio" name="cage" value={val} checked={cageChoice === val} onChange={() => setCageChoice(val)} />
                        <span className="obp-choice__title">{label}</span>
                        <span className="obp-choice__sub">{sub}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <label className="obp-field obp-field--full">
                <span className="obp-field__label">Site visit — best days/times to meet and see where the cage will go</span>
                <textarea className="obp-input obp-textarea" value={siteVisitNotes} onChange={(e) => setSiteVisitNotes(e.target.value)}
                  placeholder="e.g. Weekday mornings; ask for Mike at the loading dock" rows={3} maxLength={1000} />
              </label>
            </section>
          )}

          {step === 1 && (
            <section>
              <h2>{docs.psa.title}</h2>
              <p className="obp-muted">Review your rates and the agreement terms. A signed copy will be emailed to you.</p>

              <div className="obp-ratecard">
                <div className="obp-ratecard__head">Initial rate schedule</div>
                <table className="obp-table">
                  <thead><tr><th>Product or service</th><th>Initial charge</th><th>Billing basis</th></tr></thead>
                  <tbody>
                    {p.terms.rateSchedule.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.charge}</td><td>{r.basis}</td></tr>)}
                    <tr><td>Onboarding fee</td><td>{fee.waived ? <span className="obp-pill">Waived</span> : `$${fee.amount.toFixed(2)}`}</td><td>One time</td></tr>
                  </tbody>
                </table>
                <p className="obp-small">{docs.psa.rateNote} {docs.psa.rateFootnote}</p>
                <dl className="obp-dl">
                  <div><dt>Effective date</dt><dd>{p.terms.effectiveDate ? new Date(p.terms.effectiveDate + 'T12:00:00').toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'Date of signing'} · 12-month initial term</dd></div>
                  <div><dt>Service method</dt><dd>{p.terms.serviceMethod}</dd></div>
                  <div><dt>Payment terms</dt><dd>{p.terms.paymentTerms}</dd></div>
                  {p.terms.rep.name && <div><dt>Your account rep</dt><dd>{[p.terms.rep.name, p.terms.rep.phone, p.terms.rep.email].filter(Boolean).join(' · ')}</dd></div>}
                </dl>
              </div>

              <div className="obp-doc" tabIndex={0} aria-label="Agreement terms">
                <p>{docs.psa.intro}</p>
                {docs.psa.sections.map((s) => (
                  <React.Fragment key={s.number}>
                    {s.group && <div className="obp-doc__group">{s.group}</div>}
                    <h3>{s.number}. {s.title}</h3>
                    {s.paragraphs.map((t, i) => <p key={i}>{t}</p>)}
                  </React.Fragment>
                ))}
              </div>

              <label className="obp-check-row">
                <input type="checkbox" checked={agreementRead} onChange={(e) => setAgreementRead(e.target.checked)} />
                <span>I have reviewed the Product Supply Agreement, including variable pricing (Section 2) and the warranty and liability provisions.</span>
              </label>
              {p.hasW9 && (
                <p className="obp-small">Need our W-9 for your vendor records? <button type="button" className="obp-link" onClick={downloadW9}>Download W-9</button></p>
              )}
            </section>
          )}

          {step === 2 && (
            <section>
              <h2>Payment authorization</h2>
              <p className="obp-muted">Product deliveries are billed upon delivery. Monthly rentals are billed on the 1st of each month in arrears.</p>
              <div className="obp-choice-row">
                <label className={`obp-choice${paymentMethod === 'ach' ? ' is-selected' : ''}`}>
                  <input type="radio" name="pm" checked={paymentMethod === 'ach'} onChange={() => setPaymentMethod('ach')} />
                  <span className="obp-choice__title">ACH bank debit</span>
                  <span className="obp-choice__sub">Business checking or savings</span>
                </label>
                <label className={`obp-choice${paymentMethod === 'card' ? ' is-selected' : ''}`}>
                  <input type="radio" name="pm" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} />
                  <span className="obp-choice__title">Credit card</span>
                  <span className="obp-choice__sub">We'll send a secure payment link</span>
                </label>
              </div>

              {paymentMethod === 'ach' ? (
                <>
                  <div className="obp-grid">
                    <Field label="Bank name" required value={bank.bankName} onChange={(v) => setBank({ ...bank, bankName: v })} />
                    <Field label="Account holder name" required value={bank.holderName} onChange={(v) => setBank({ ...bank, holderName: v })} />
                    <Field label="Routing number (9 digits)" required inputMode="numeric" autoComplete="off" value={bank.routingNumber}
                      onChange={(v) => setBank({ ...bank, routingNumber: v.replace(/\D/g, '').slice(0, 9) })} />
                    <label className="obp-field">
                      <span className="obp-field__label">Account type<span className="obp-req"> *</span></span>
                      <select className="obp-input" value={bank.accountType} onChange={(e) => setBank({ ...bank, accountType: e.target.value as 'checking' | 'savings' })}>
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                      </select>
                    </label>
                    <Field label="Bank account number" required type="password" inputMode="numeric" autoComplete="off" value={bank.accountNumber}
                      onChange={(v) => setBank({ ...bank, accountNumber: v.replace(/\D/g, '').slice(0, 17) })} />
                    <Field label="Confirm account number" required inputMode="numeric" autoComplete="off" value={bank.accountConfirm}
                      onChange={(v) => setBank({ ...bank, accountConfirm: v.replace(/\D/g, '').slice(0, 17) })} />
                  </div>
                  <p className="obp-secure-note">Your bank details are encrypted when you submit and are only used to set up payments in our accounting system. Your signed copy shows only the last 4 digits.</p>
                </>
              ) : (
                <p className="obp-secure-note">{docs.ach.cardNote}</p>
              )}

              <div className="obp-doc obp-doc--short">
                <h3>Authorization for customer-initiated and merchant-initiated charges</h3>
                {docs.ach.paragraphs.map((t, i) => <p key={i} className={t.startsWith('•') ? 'obp-bullet' : ''}>{t}</p>)}
                <p className="obp-small">{docs.ach.footnote}</p>
              </div>
            </section>
          )}

          {step === 3 && info && (
            <section>
              <h2>Review &amp; sign</h2>
              <dl className="obp-summary">
                <div><dt>Company</dt><dd>{info.legalName}</dd></div>
                <div><dt>Delivery address</dt><dd>{info.deliveryAddress}</dd></div>
                <div><dt>Invoices to</dt><dd>{info.apEmail || info.contactEmail}</dd></div>
                <div><dt>Payment</dt><dd>{paymentMethod === 'ach' ? `ACH — ${bank.bankName} ••••${bank.accountNumber.slice(-4)}` : 'Credit card (secure link to follow)'}</dd></div>
                {p.terms.askCageChoice && <div><dt>Storage cage</dt><dd>{{ rent: 'Rent', purchase: 'Purchase', undecided: 'Not sure yet', not_applicable: '' }[cageChoice]}</dd></div>}
                <div><dt>Onboarding fee</dt><dd>{fee.waived ? 'Waived' : `$${fee.amount.toFixed(2)}`}</dd></div>
              </dl>
              <button type="button" className="obp-link obp-edit-link" onClick={() => setStep(0)}>Edit details</button>

              <div className="obp-grid">
                <Field label="Your full name" required value={signerName} onChange={setSignerName} autoComplete="name" />
                <Field label="Your title" required value={signerTitle} onChange={setSignerTitle} />
              </div>

              <SignaturePad name={signerName} value={sig} onChange={setSig} />

              <label className="obp-check-row">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>On behalf of <strong>{info.legalName || 'the customer'}</strong>, I accept the {docs.psa.title} and the {docs.ach.title}, and I confirm I am authorized to bind this business.</span>
              </label>
              <label className="obp-check-row">
                <input type="checkbox" checked={esignConsent} onChange={(e) => setEsignConsent(e.target.checked)} />
                <span>{docs.esignConsent}</span>
              </label>
            </section>
          )}

          {stepError && <div className="obp-error" role="alert">{stepError}</div>}

          <div className="obp-actions">
            {step > 0 ? <button type="button" className="obp-btn obp-btn--ghost" onClick={back} disabled={submitting}>Back</button> : <span />}
            {step < STEPS.length - 1
              ? <button type="button" className="obp-btn obp-btn--primary" onClick={next}>Continue</button>
              : <button type="button" className="obp-btn obp-btn--primary" onClick={submit} disabled={submitting}>{submitting ? 'Signing…' : 'Sign & submit'}</button>}
          </div>
        </div>

        <p className="obp-footer-note">
          Questions? {p.terms.rep.name ? `Contact ${p.terms.rep.name}${p.terms.rep.phone ? ` at ${p.terms.rep.phone}` : ''} or call` : 'Call'} {company?.phone || '(740) 272-5359'}.
          This link expires {new Date(p.expiresAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}.
        </p>
      </main>
    </div>
  )
}

function rateFor(p: OpenPacket, kind: 'rental' | 'purchase'): string {
  const row = p.terms.rateSchedule.find((r) => /cage/i.test(r.label) && new RegExp(kind === 'rental' ? 'rent' : 'purchase', 'i').test(r.label))
  return row ? `${row.charge} ${row.basis.toLowerCase()}` : ''
}
