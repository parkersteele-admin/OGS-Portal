/**
 * src/pages/public/Welcome.tsx
 *
 * Public marketing / explainer page at /welcome.
 * Standalone route — does not touch the "/" root redirect or the
 * authenticated app shell. Meant to be shared with prospects, partners,
 * and stakeholders reviewing the platform before sign-in.
 */

import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import {
  Truck,
  Gauge,
  Users,
  ShieldCheck,
  Radio,
  FileText,
  ClipboardCheck,
  MapPin,
  Fuel,
  BarChart3,
  Receipt,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { BrandLogo } from '../../components/branding/BrandLogo'
import { functions } from '../../lib/firebase'
import './Welcome.css'

const roleCards = [
  {
    icon: Users,
    label: 'Customer Portal',
    description:
      'A self-service hub where customers manage their account without picking up the phone.',
    features: [
      'Place and track orders in real time',
      'Live propane tank level monitoring',
      'Invoices, payments & order history',
      'Team access with company profiles',
    ],
  },
  {
    icon: BarChart3,
    label: 'Sales & CRM',
    description:
      'A full pipeline for the sales team — from lead to signed quote to paid invoice.',
    features: [
      'Lead and customer pipeline management',
      'Quote builder with margin-safe pricing',
      'Sales dashboard, leaderboard & targets',
      'Aging reports & billing visibility',
    ],
  },
  {
    icon: Radio,
    label: 'Dispatch & Operations',
    description:
      'Command center for planning routes, watching inventory, and keeping trucks moving.',
    features: [
      'Delivery run builder & live dispatch board',
      'Tank & inventory monitoring',
      'Order queue across the whole operation',
      'Ops-wide billing and customer lookup',
    ],
  },
  {
    icon: Truck,
    label: 'Driver App',
    description:
      'A mobile-first experience built for the cab of the truck, not the back office.',
    features: [
      'Daily schedule, stop-by-stop',
      'Proof-of-delivery capture on site',
      'Truck load & inventory tracking',
      'Works the way a route actually runs',
    ],
  },
  {
    icon: ShieldCheck,
    label: 'Admin & Controls',
    description:
      'Role-based control over pricing, users, and how the company runs day to day.',
    features: [
      'User management & role permissions',
      'Price list & minimum-margin controls',
      'Delivery & company settings',
      'Branded email templates',
    ],
  },
  {
    icon: Fuel,
    label: 'Fleet & Inventory',
    description: 'Know what is in the ground and what is on the truck, at all times.',
    features: [
      'Real-time tank level tracking',
      'Inventory across trucks & tanks',
      'Run summaries after every delivery',
      'Data that keeps deliveries on schedule',
    ],
  },
]

const workflowSteps = [
  { icon: FileText, title: 'Order or Quote', text: 'A customer orders through the portal, or sales builds a quote in the CRM.' },
  { icon: MapPin, title: 'Route & Dispatch', text: 'Ops builds the run and dispatch sends it out with live visibility.' },
  { icon: Truck, title: 'Deliver & Capture', text: 'Drivers run their stops and capture proof of delivery from the truck.' },
  { icon: Receipt, title: 'Bill & Get Paid', text: 'Invoices generate automatically and flow straight to the customer.' },
]

const trustPoints = [
  'Built for Ohio propane & gas delivery',
  'Role-based access for every team',
  'Real-time data, not end-of-day reports',
]

interface InquiryFormState {
  name: string
  email: string
  company: string
  phone: string
  message: string
  website: string // honeypot — left blank by real visitors
}

const INITIAL_FORM: InquiryFormState = {
  name: '',
  email: '',
  company: '',
  phone: '',
  message: '',
  website: '',
}

const WelcomePage: React.FC = () => {
  const [form, setForm] = useState<InquiryFormState>(INITIAL_FORM)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  function updateField<K extends keyof InquiryFormState>(field: K, value: InquiryFormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleInquirySubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError('Please fill in your name, email, and a short message.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid email address.')
      return
    }

    setStatus('submitting')
    try {
      const submitWelcomeInquiry = httpsCallable(functions, 'submitWelcomeInquiry')
      await submitWelcomeInquiry({
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        phone: form.phone.trim(),
        message: form.message.trim(),
        website: form.website, // honeypot
      })
      setStatus('sent')
      setForm(INITIAL_FORM)
    } catch (err) {
      console.error('submitWelcomeInquiry failed', err)
      setStatus('error')
      setError('Something went wrong sending your message. Please try again in a moment.')
    }
  }

  return (
    <div className="welcome">
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="welcome-nav">
        <div className="welcome-nav__inner">
          <BrandLogo variant="white" className="welcome-nav__logo" />
          <Link to="/login" className="welcome-nav__cta">
            Sign In
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="welcome-hero">
        <div className="welcome-hero__bg" aria-hidden="true" />
        <div className="welcome-hero__inner">
          <p className="welcome-hero__eyebrow">Ohio Gas Supply Platform</p>
          <h1 className="welcome-hero__title">
            One platform running every part of the delivery.
          </h1>
          <p className="welcome-hero__subtitle">
            From the customer&rsquo;s order to the driver&rsquo;s last stop, OGS connects
            sales, dispatch, delivery, and billing in a single system built for how a
            gas company actually operates.
          </p>
          <div className="welcome-hero__actions">
            <Link to="/login" className="welcome-btn welcome-btn--primary">
              Sign In <ArrowRight size={16} />
            </Link>
            <a href="#platform" className="welcome-btn welcome-btn--ghost">
              See how it works
            </a>
          </div>
          <ul className="welcome-hero__trust">
            {trustPoints.map((point) => (
              <li key={point}>
                <CheckCircle2 size={15} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Platform / role grid ────────────────────────────────────── */}
      <section id="platform" className="welcome-section">
        <div className="welcome-section__head">
          <p className="welcome-section__eyebrow">The platform</p>
          <h2 className="welcome-section__title">Every role, one system of record</h2>
          <p className="welcome-section__subtitle">
            Each team gets a purpose-built workspace — all reading from the same live
            data, so nothing gets lost between a phone call and a delivery truck.
          </p>
        </div>

        <div className="welcome-grid">
          {roleCards.map(({ icon: Icon, label, description, features }) => (
            <div className="welcome-card" key={label}>
              <div className="welcome-card__icon">
                <Icon size={20} />
              </div>
              <h3 className="welcome-card__title">{label}</h3>
              <p className="welcome-card__desc">{description}</p>
              <ul className="welcome-card__list">
                {features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Workflow ─────────────────────────────────────────────────── */}
      <section className="welcome-flow">
        <div className="welcome-section__head">
          <p className="welcome-section__eyebrow">End to end</p>
          <h2 className="welcome-section__title">From order to invoice, in one path</h2>
        </div>

        <div className="welcome-flow__steps">
          {workflowSteps.map(({ icon: Icon, title, text }, i) => (
            <React.Fragment key={title}>
              <div className="welcome-flow__step">
                <div className="welcome-flow__icon">
                  <Icon size={22} />
                </div>
                <span className="welcome-flow__num">{String(i + 1).padStart(2, '0')}</span>
                <h4>{title}</h4>
                <p>{text}</p>
              </div>
              {i < workflowSteps.length - 1 && (
                <div className="welcome-flow__connector" aria-hidden="true" />
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ── Stat strip ──────────────────────────────────────────────── */}
      <section className="welcome-stats">
        <div className="welcome-stats__item">
          <Gauge size={22} />
          <div>
            <strong>Live tank data</strong>
            <span>Know levels before the customer calls</span>
          </div>
        </div>
        <div className="welcome-stats__item">
          <ClipboardCheck size={22} />
          <div>
            <strong>Proof of delivery</strong>
            <span>Captured on-site, every stop</span>
          </div>
        </div>
        <div className="welcome-stats__item">
          <ShieldCheck size={22} />
          <div>
            <strong>Role-based access</strong>
            <span>Everyone sees exactly what they need</span>
          </div>
        </div>
      </section>

      {/* ── Closing inquiry form ────────────────────────────────────── */}
      <section id="inquire" className="welcome-close">
        <div className="welcome-close__inner">
          <h2>Want to see it in action?</h2>
          <p>Tell us a bit about your business and we&rsquo;ll follow up.</p>

          {status === 'sent' ? (
            <div className="welcome-form__success">
              <CheckCircle2 size={20} />
              <span>Thanks — your message is on its way. We&rsquo;ll be in touch soon.</span>
            </div>
          ) : (
            <form className="welcome-form" onSubmit={handleInquirySubmit} noValidate>
              {/* Honeypot — hidden from real visitors, ignored server-side if filled */}
              <input
                type="text"
                name="website"
                value={form.website}
                onChange={(e) => updateField('website', e.target.value)}
                className="welcome-form__honeypot"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />

              <div className="welcome-form__row">
                <div className="welcome-form__field">
                  <label htmlFor="wc-name">Name</label>
                  <input
                    id="wc-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    disabled={status === 'submitting'}
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="welcome-form__field">
                  <label htmlFor="wc-email">Email</label>
                  <input
                    id="wc-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    disabled={status === 'submitting'}
                    placeholder="jane@company.com"
                  />
                </div>
              </div>

              <div className="welcome-form__row">
                <div className="welcome-form__field">
                  <label htmlFor="wc-company">Company (optional)</label>
                  <input
                    id="wc-company"
                    type="text"
                    value={form.company}
                    onChange={(e) => updateField('company', e.target.value)}
                    disabled={status === 'submitting'}
                    placeholder="Company name"
                  />
                </div>
                <div className="welcome-form__field">
                  <label htmlFor="wc-phone">Phone (optional)</label>
                  <input
                    id="wc-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    disabled={status === 'submitting'}
                    placeholder="(614) 555-0100"
                  />
                </div>
              </div>

              <div className="welcome-form__field">
                <label htmlFor="wc-message">What are you looking for?</label>
                <textarea
                  id="wc-message"
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => updateField('message', e.target.value)}
                  disabled={status === 'submitting'}
                  placeholder="Tell us a little about your operation and what you'd like to see."
                />
              </div>

              {error && <div className="welcome-form__error">{error}</div>}

              <button
                type="submit"
                className="welcome-btn welcome-btn--primary welcome-form__submit"
                disabled={status === 'submitting'}
              >
                {status === 'submitting' ? (
                  <>
                    <Loader2 size={16} className="welcome-form__spinner" /> Sending…
                  </>
                ) : (
                  <>
                    Send Inquiry <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </section>

      <footer className="welcome-footer">
        <BrandLogo variant="white" className="welcome-footer__logo" />
        <p>&copy; {new Date().getFullYear()} Ohio Gas Supply. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default WelcomePage
