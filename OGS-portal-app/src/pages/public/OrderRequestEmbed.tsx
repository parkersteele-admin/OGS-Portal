import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../lib/firebase'
import './OrderRequestEmbed.css'

interface SubmitOrderRequestInput {
  name: string
  phone: string
  email: string
  company?: string
  deliveryAddress?: string
  preferredDeliveryDate?: string
  requestedItems: string[]
  requestDetails?: string
  sourceUrl?: string
  website?: string
}

const REQUEST_OPTIONS = [
  'Propane refill',
  'New cylinder delivery',
  'Exchange empty cylinders',
  'Tank inspection/service',
  'Recurring delivery setup',
  'Emergency / rush request',
]

const INITIAL_FORM = {
  name: '',
  phone: '',
  email: '',
  company: '',
  deliveryAddress: '',
  preferredDeliveryDate: '',
  requestDetails: '',
  website: '',
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

export default function OrderRequestEmbedPage() {
  const [searchParams] = useSearchParams()
  const embedMode = searchParams.get('embed') === '1'

  const [form, setForm] = useState(INITIAL_FORM)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [error, setError] = useState<string | null>(null)

  const sourceUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  }, [])

  function updateField<K extends keyof typeof INITIAL_FORM>(field: K, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function toggleItem(item: string) {
    setSelectedItems((prev) => (prev.includes(item)
      ? prev.filter((value) => value !== item)
      : [...prev, item]))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const name = form.name.trim()
    const phone = form.phone.trim()
    const email = form.email.trim()
    const requestDetails = form.requestDetails.trim()

    if (!name || !phone || !email) {
      setError('Name, phone, and email are required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    if (selectedItems.length === 0 && !requestDetails) {
      setError('Select at least one request option or add details.')
      return
    }

    setSubmitState('submitting')
    try {
      const submitOrderRequest = httpsCallable<SubmitOrderRequestInput, { success: boolean; requestId: string }>(
        functions,
        'submitOrderRequest',
      )

      await submitOrderRequest({
        name,
        phone,
        email,
        company: form.company.trim(),
        deliveryAddress: form.deliveryAddress.trim(),
        preferredDeliveryDate: form.preferredDeliveryDate,
        requestedItems: selectedItems,
        requestDetails,
        sourceUrl,
        website: form.website,
      })

      setSubmitState('success')
      setForm(INITIAL_FORM)
      setSelectedItems([])
    } catch (err) {
      console.error('[OrderRequestEmbed] submit failed', err)
      setSubmitState('error')
      setError('Could not submit your request right now. Please try again.')
    }
  }

  return (
    <main className={`order-request ${embedMode ? 'order-request--embed' : ''}`}>
      <div className="order-request__surface">
        <header className="order-request__header">
          <p className="order-request__eyebrow">Ohio Gas Supply</p>
          <h1>Request an Order</h1>
          <p>
            Tell us what you need and our operations team will follow up.
            No pricing is shown in this form.
          </p>
        </header>

        {submitState === 'success' ? (
          <section className="order-request__success" aria-live="polite">
            <h2>Request submitted</h2>
            <p>Thanks. Your request is now in our order queue and we will contact you shortly.</p>
            <button
              type="button"
              className="order-request__btn"
              onClick={() => setSubmitState('idle')}
            >
              Submit another request
            </button>
          </section>
        ) : (
          <form className="order-request__form" onSubmit={handleSubmit}>
            <input
              className="order-request__honeypot"
              tabIndex={-1}
              autoComplete="off"
              name="website"
              value={form.website}
              onChange={(event) => updateField('website', event.target.value)}
              aria-hidden="true"
            />

            <div className="order-request__grid">
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  required
                />
              </label>
              <label>
                Phone
                <input
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  required
                />
              </label>
              <label>
                Company (optional)
                <input
                  value={form.company}
                  onChange={(event) => updateField('company', event.target.value)}
                />
              </label>
              <label className="order-request__grid-wide">
                Delivery address (optional)
                <input
                  value={form.deliveryAddress}
                  onChange={(event) => updateField('deliveryAddress', event.target.value)}
                />
              </label>
              <label>
                Preferred delivery date (optional)
                <input
                  type="date"
                  value={form.preferredDeliveryDate}
                  onChange={(event) => updateField('preferredDeliveryDate', event.target.value)}
                />
              </label>
            </div>

            <fieldset className="order-request__options">
              <legend>What do you need?</legend>
              <div className="order-request__chips">
                {REQUEST_OPTIONS.map((item) => {
                  const active = selectedItems.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`order-request__chip ${active ? 'order-request__chip--active' : ''}`}
                      onClick={() => toggleItem(item)}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <label>
              Additional details (optional)
              <textarea
                rows={4}
                value={form.requestDetails}
                onChange={(event) => updateField('requestDetails', event.target.value)}
                placeholder="Anything else we should know about this request?"
              />
            </label>

            {error && <p className="order-request__error">{error}</p>}

            <button type="submit" className="order-request__btn" disabled={submitState === 'submitting'}>
              {submitState === 'submitting' ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
