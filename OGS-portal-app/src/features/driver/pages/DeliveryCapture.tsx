/**
 * src/pages/driver/DeliveryCapture.tsx
 * BEM prefix: dc-
 *
 * 5-step delivery capture flow for drivers (tablet-optimised).
 *
 * Step 1 — Arrive        : customer/product info + "I've arrived" CTA
 * Step 2 — Qty           : editable quantity stepper
 * Step 3 — Photo         : camera capture via <input capture>
 * Step 4 — Signature     : native canvas signature pad
 * Step 5 — Confirm       : summary + "Mark as delivered" + confirmation dialog
 *
 * Skip stop flow         : always-visible bottom drawer, reason + notes
 *
 * URL:  /driver/capture/:stopId   (state: { runId } from navigate())
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Camera } from 'lucide-react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { updateRunStop, updateStopStatus } from '../../../services/runService'
import {
  uploadDeliveryPhoto,
} from '../../../services/fileService'
import { finalizeSignedDelivery } from '../../../services/deliveryService'
import { useRunStopLive } from '../../../hooks/useRunStopLive'
import { useAuth } from '../../../hooks/useAuth'
import type { Order } from '../../../types/order'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import './DeliveryCapture.css'

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5

const SKIP_REASONS = [
  'Not home',
  'Wrong address',
  'Product unavailable',
  'Access denied',
  'Customer refused delivery',
  'Other',
] as const

type SkipReason = (typeof SKIP_REASONS)[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepLabel(step: Step): string {
  const labels: Record<Step, string> = {
    1: 'Arrive',
    2: 'Quantity',
    3: 'Photo',
    4: 'Signature',
    5: 'Confirm',
  }
  return labels[step]
}

// ── Signature canvas (native, no library needed) ──────────────────────────────

interface SignatureCanvasProps {
  onSigned: (hasSignature: boolean) => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

function SignatureCanvas({ onSigned, canvasRef }: SignatureCanvasProps) {
  const isDrawing = useRef(false)
  const hasStroke = useRef(false)

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
      const ctx = canvas.getContext('2d')!
      const { x, y } = getPos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
      isDrawing.current = true
    },
    [canvasRef],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      ctx.lineWidth  = 2.5
      ctx.lineCap    = 'round'
      ctx.lineJoin   = 'round'
      ctx.strokeStyle = '#111'
      const { x, y } = getPos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      if (!hasStroke.current) {
        hasStroke.current = true
        onSigned(true)
      }
    },
    [canvasRef, onSigned],
  )

  const onPointerUp = useCallback(() => {
    isDrawing.current = false
  }, [])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    onSigned(false)
  }, [canvasRef, onSigned])

  // Size canvas to its displayed size on mount and resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const cssWidth = Math.max(1, Math.round(width))
      const cssHeight = Math.max(1, Math.round(height))
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.round(cssWidth * dpr)
      const pixelHeight = Math.round(cssHeight * dpr)
      if (canvas.width === pixelWidth && canvas.height === pixelHeight) {
        return
      }

      canvas.width = pixelWidth
      canvas.height = pixelHeight
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement ?? canvas)
    return () => ro.disconnect()
  }, [canvasRef])

  return (
    <div className="dc-sig-wrap">
      <canvas
        ref={canvasRef}
        className="dc-sig-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ touchAction: 'none' }}
      />
      <button type="button" className="dc-sig-clear" onClick={clear}>
        Clear
      </button>
      <p className="dc-sig-hint">Sign above with your finger</p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DeliveryCapture() {
  const { stopId }          = useParams<{ stopId: string }>()
  const { state }           = useLocation() as { state?: { runId?: string } }
  const navigate            = useNavigate()
  const runId               = state?.runId ?? ''
  const { isDriver }        = useAuth()

  // Live stop data
  const { stop, loading: stopLoading } = useRunStopLive(runId, stopId)

  // Supplemental data
  const [order,    setOrder]    = useState<Order    | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [product,  setProduct]  = useState<Product  | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  // Step state
  const [step, setStep] = useState<Step>(1)

  // Step 2 — quantity
  const [qtyDelivered, setQtyDelivered] = useState<number>(0)
  // Add-on quantities: productId → qty
  const [addOnQtys, setAddOnQtys] = useState<Record<string, number>>({})

  // Step 3 — photo
  const photoInputRef  = useRef<HTMLInputElement>(null)
  const [photoFile,    setPhotoFile]    = useState<File  | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoProgress, setPhotoProgress] = useState(0)
  const [photoUrl,     setPhotoUrl]     = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)

  // Step 4 — signature
  const sigCanvasRef       = useRef<HTMLCanvasElement>(null)
  const [hasSig,    setHasSig]    = useState(false)
  const [receivedByName, setReceivedByName] = useState('')

  // Step 5 — confirm dialog
  const [showConfirm,    setShowConfirm]    = useState(false)
  const [submitting,     setSubmitting]     = useState(false)
  const [submitError,    setSubmitError]    = useState<string | null>(null)
  const [deliveryNotes,  setDeliveryNotes]  = useState('')

  // Skip stop drawer
  const [showSkip,    setShowSkip]    = useState(false)
  const [skipReason,  setSkipReason]  = useState<SkipReason | ''>('')
  const [skipNotes,   setSkipNotes]   = useState('')
  const [skipping,    setSkipping]    = useState(false)
  const [skipError,   setSkipError]   = useState<string | null>(null)

  // ── Load order / customer / product ───────────────────────────────────────

  useEffect(() => {
    if (!stop) return
    setDataLoading(true)

    async function loadExtras() {
      const [orderSnap, customerSnap] = await Promise.all([
        getDoc(doc(db, 'orders', stop!.orderId)),
        getDoc(doc(db, 'customers', stop!.customerId)),
      ])

      const ord = orderSnap.exists()
        ? ({ id: orderSnap.id, ...orderSnap.data() } as Order)
        : null
      setOrder(ord)
      setQtyDelivered(ord?.quantity ?? 0)
      setReceivedByName(ord?.deliveryContactName ?? '')

      setCustomer(
        customerSnap.exists()
          ? ({ id: customerSnap.id, ...customerSnap.data() } as Customer)
          : null,
      )

      if (ord?.productId) {
        const pSnap = await getDoc(doc(db, 'products', ord.productId))
        setProduct(
          pSnap.exists() ? ({ id: pSnap.id, ...pSnap.data() } as Product) : null,
        )
      }

      // Initialise add-on qty state from order.addOns
      if (ord?.addOns?.length) {
        const initial: Record<string, number> = {}
        for (const ao of ord.addOns) {
          initial[ao.productId] = ao.qty
        }
        setAddOnQtys(initial)
      }

      setDataLoading(false)
    }

    loadExtras().catch((err: Error) => {
      console.error(err)
      setDataLoading(false)
    })
  }, [stop?.orderId, stop?.customerId])

  // ── Step 1: Arrive ─────────────────────────────────────────────────────────

  async function handleArrive() {
    if (!stop || !runId) return
    await updateStopStatus(runId, stop.id, 'arrived')
    setStep(2)
  }

  // ── Step 3: Photo ──────────────────────────────────────────────────────────

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    setPhotoUrl(null)
  }

  async function uploadPhoto() {
    if (!photoFile || !order) return
    setPhotoUploading(true)
    try {
      const url = await uploadDeliveryPhoto(order.id, photoFile, (pct) =>
        setPhotoProgress(pct),
      )
      setPhotoUrl(url)
    } catch (err) {
      console.error('Photo upload failed', err)
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handlePhotoNext() {
    if (!photoUrl && photoFile) {
      await uploadPhoto()
    }
    setStep(4)
  }

  // ── Step 4: Signature ──────────────────────────────────────────────────────

  function getSignatureDataUrl(): string | null {
    const canvas = sigCanvasRef.current
    if (!canvas || !hasSig) return null
    return canvas.toDataURL('image/png')
  }

  async function handleSigNext() {
    if (!hasSig) return
    setStep(5)
  }

  // ── Step 5: Mark delivered ─────────────────────────────────────────────────

  async function handleMarkDelivered() {
    if (!stop || !runId || !order) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (!isDriver) {
        throw new Error('Only drivers can finalize signed deliveries.')
      }
      const signatureDataUrl = getSignatureDataUrl()
      if (!signatureDataUrl) {
        throw new Error('A signature is required before completing delivery.')
      }
      if (!receivedByName.trim()) {
        throw new Error('Received by name is required before completing delivery.')
      }

      const deliveredLineItems = order.productId
        ? [{ productId: order.productId, qty: qtyDelivered }]
        : []
      const deliveredAddOns = order.addOns?.map((ao) => ({
        productId: ao.productId,
        qty: addOnQtys[ao.productId] ?? ao.qty,
      })) ?? []

      await finalizeSignedDelivery({
        runId,
        stopId: stop.id,
        qtyDelivered,
        receivedByName: receivedByName.trim(),
        signatureDataUrl,
        deliveryNotes: deliveryNotes.trim() || undefined,
        photoUrls: photoUrl ? [photoUrl] : undefined,
        deliveredLineItems,
        deliveredAddOns: deliveredAddOns.length ? deliveredAddOns : undefined,
      })

      // Navigate back to schedule after successful delivery
      navigate('/driver/schedule', { replace: true })
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to mark stop as delivered.')
    } finally {
      setSubmitting(false)
      setShowConfirm(false)
    }
  }

  // ── Skip stop ──────────────────────────────────────────────────────────────

  async function handleSkip() {
    if (!stop || !runId || !skipReason) return
    setSkipping(true)
    setSkipError(null)
    try {
      const notes = skipNotes ? `${skipReason}: ${skipNotes}` : skipReason
      await updateRunStop(runId, stop.id, { notes })
      await updateStopStatus(runId, stop.id, 'skipped')
      navigate('/driver/schedule', { replace: true })
    } catch (err) {
      setSkipError((err as Error).message ?? 'Failed to skip stop.')
      setSkipping(false)
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (stopLoading || dataLoading) {
    return (
      <div className="dc-page">
        <div className="dc-loading">
          <span className="dc-spinner" />
          <p>Loading stop details…</p>
        </div>
      </div>
    )
  }

  if (!stop) {
    return (
      <div className="dc-page">
        <div className="dc-error">Stop not found. Check your run and try again.</div>
        <button className="dc-back-link" onClick={() => navigate('/driver/schedule')}>
          ← Back to schedule
        </button>
      </div>
    )
  }

  if (!runId) {
    return (
      <div className="dc-page">
        <div className="dc-error">Missing run ID. Please navigate here from your schedule.</div>
        <button className="dc-back-link" onClick={() => navigate('/driver/schedule')}>
          ← Back to schedule
        </button>
      </div>
    )
  }

  if (!isDriver) {
    return (
      <div className="dc-page">
        <div className="dc-error">This delivery flow is only available to drivers.</div>
        <button className="dc-back-link" onClick={() => navigate('/driver/schedule')}>
          ← Back to schedule
        </button>
      </div>
    )
  }

  const unitLabel = product?.unit ?? 'unit'
  const orderedQty = order?.quantity ?? 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="dc-page">

      {/* ── Step indicator ── */}
      <div className="dc-steps">
        {([1, 2, 3, 4, 5] as Step[]).map((s) => (
          <div
            key={s}
            className={`dc-step ${step === s ? 'dc-step--active' : ''} ${step > s ? 'dc-step--done' : ''}`}
          >
            <div className="dc-step__dot">
              {step > s ? '✓' : s}
            </div>
            <div className="dc-step__lbl">{stepLabel(s)}</div>
          </div>
        ))}
      </div>

      {/* ── Stop identity card (always shown) ── */}
      <div className="dc-stop-card">
        <div className="dc-stop-card__num">Stop {stop.order}</div>
        <div className="dc-stop-card__name">{customer?.name ?? stop.customerId}</div>
        {customer && (
          <div className="dc-stop-card__address">
            {customer.address}, {customer.city} {customer.state} {customer.zip}
          </div>
        )}
        {product && order && (
          <div className="dc-stop-card__product">
            {product.name} · {order.quantity} {unitLabel}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          STEP 1 — ARRIVE
          ════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="dc-body">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="dc-body__icon" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <h2 className="dc-body__heading">Ready to deliver?</h2>
          <p className="dc-body__sub">
            Tap <strong>I've arrived</strong> to log your arrival time and notify dispatch.
          </p>
          <button className="dc-cta dc-cta--arrive" onClick={handleArrive}>
            I've arrived
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 2 — QUANTITY
          ════════════════════════════════════════════════════════ */}
      {step === 2 && (
        <div className="dc-body">
          <h2 className="dc-body__heading">Quantity delivered</h2>

          {/* ── Standing order qty ── */}
          <div className="dc-qty-section">
            <p className="dc-qty-section__label">Standing order</p>
            <p className="dc-body__sub">Ordered: <strong>{orderedQty} {unitLabel}</strong></p>

            <div className="dc-stepper">
              <button
                className="dc-stepper__btn"
                onClick={() => setQtyDelivered((q) => Math.max(0, +(q - 1).toFixed(2)))}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <input
                className="dc-stepper__input"
                type="number"
                min="0"
                step="0.5"
                value={qtyDelivered}
                onChange={(e) => setQtyDelivered(Number(e.target.value))}
              />
              <button
                className="dc-stepper__btn"
                onClick={() => setQtyDelivered((q) => +(q + 1).toFixed(2))}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <span className="dc-stepper__unit">{unitLabel}</span>

            {qtyDelivered !== orderedQty && (
              <div className="dc-qty-note">
                ⚠ Different from ordered quantity ({orderedQty} {unitLabel})
              </div>
            )}
          </div>

          {/* ── Add-ons qty (only shown when add-ons exist) ── */}
          {order?.addOns && order.addOns.length > 0 && (
            <div className="dc-qty-section dc-qty-section--addons">
              <p className="dc-qty-section__label">ADD-ONS</p>
              {order.addOns.map((ao) => {
                const qty = addOnQtys[ao.productId] ?? ao.qty
                return (
                  <div key={ao.productId} className="dc-addon-row">
                    <span className="dc-addon-row__name">{ao.productName}</span>
                    <div className="dc-stepper dc-stepper--compact">
                      <button
                        className="dc-stepper__btn"
                        onClick={() => setAddOnQtys((prev) => ({ ...prev, [ao.productId]: Math.max(0, (prev[ao.productId] ?? ao.qty) - 1) }))}
                        aria-label="Decrease"
                      >−</button>
                      <input
                        className="dc-stepper__input"
                        type="number"
                        min="0"
                        step="1"
                        value={qty}
                        onChange={(e) => setAddOnQtys((prev) => ({ ...prev, [ao.productId]: Number(e.target.value) }))}
                      />
                      <button
                        className="dc-stepper__btn"
                        onClick={() => setAddOnQtys((prev) => ({ ...prev, [ao.productId]: (prev[ao.productId] ?? ao.qty) + 1 }))}
                        aria-label="Increase"
                      >+</button>
                    </div>
                    <span className="dc-addon-row__unit">{unitLabel}</span>
                  </div>
                )
              })}
              <p className="dc-qty-section__sub">
                {Object.values(addOnQtys).reduce((s, v) => s + v, 0)} add-on {unitLabel}s
              </p>
            </div>
          )}

          <button
            className="dc-cta dc-cta--next"
            disabled={qtyDelivered <= 0}
            onClick={() => setStep(3)}
          >
            Next → Photo
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 3 — PHOTO
          ════════════════════════════════════════════════════════ */}
      {step === 3 && (
        <div className="dc-body">
          <h2 className="dc-body__heading">Delivery photo</h2>
          <p className="dc-body__sub">Take a photo of the delivered product at the customer's location.</p>

          {/* Hidden camera input */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="dc-hidden-input"
            onChange={handlePhotoChange}
          />

          {!photoPreview ? (
            <button
              className="dc-cta dc-cta--photo"
              onClick={() => photoInputRef.current?.click()}
            >
              <Camera size={18} aria-hidden="true" /> Take photo
            </button>
          ) : (
            <div className="dc-photo-preview">
              <img src={photoPreview} alt="Delivery photo" className="dc-photo-preview__img" />
              <button
                className="dc-retake-btn"
                onClick={() => {
                  setPhotoFile(null)
                  setPhotoPreview(null)
                  setPhotoUrl(null)
                  if (photoInputRef.current) photoInputRef.current.value = ''
                }}
              >
                ↺ Retake
              </button>
            </div>
          )}

          {photoUploading && (
            <div className="dc-upload-progress">
              <div className="dc-upload-progress__bar" style={{ width: `${photoProgress}%` }} />
              <span>{photoProgress}%</span>
            </div>
          )}

          <button
            className="dc-cta dc-cta--next"
            disabled={!photoFile || photoUploading}
            onClick={handlePhotoNext}
          >
            {photoUploading ? 'Uploading…' : 'Next → Signature'}
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 4 — SIGNATURE
          ════════════════════════════════════════════════════════ */}
      {step === 4 && (
        <div className="dc-body">
          <h2 className="dc-body__heading">Customer signature</h2>
          <p className="dc-body__sub">
            The customer must sign before we can finalize this delivery.
          </p>

          <div className="dc-field">
            <label className="dc-field__label" htmlFor="dc-received-by">
              Received by <span className="dc-field__hint">(required)</span>
            </label>
            <input
              id="dc-received-by"
              className="dc-input"
              type="text"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              placeholder="Customer name"
            />
          </div>

          <SignatureCanvas
            canvasRef={sigCanvasRef}
            onSigned={setHasSig}
          />

          <button
            className="dc-cta dc-cta--next"
            disabled={!hasSig}
            onClick={handleSigNext}
          >
            Confirm Signature
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 5 — CONFIRM
          ════════════════════════════════════════════════════════ */}
      {step === 5 && (
        <div className="dc-body">
          <h2 className="dc-body__heading">Ready to mark delivered</h2>

          <div className="dc-summary">
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Customer</span>
              <span className="dc-summary__val">{customer?.name ?? '—'}</span>
            </div>
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Product</span>
              <span className="dc-summary__val">{product?.name ?? '—'}</span>
            </div>
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Qty delivered</span>
              <span className="dc-summary__val dc-summary__val--hero">
                {qtyDelivered} {unitLabel}
                {qtyDelivered !== orderedQty && (
                  <span className="dc-summary__diff"> (ordered: {orderedQty})</span>
                )}
              </span>
            </div>
            {order?.addOns && order.addOns.length > 0 && (
              <div className="dc-summary__row dc-summary__row--addons">
                <span className="dc-summary__lbl">Add-ons delivered</span>
                <span className="dc-summary__val">
                  {order.addOns.map((ao) => (
                    <span key={ao.productId} className="dc-summary__addon-item">
                      {addOnQtys[ao.productId] ?? ao.qty}× {ao.productName}
                    </span>
                  ))}
                </span>
              </div>
            )}
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Received by</span>
              <span className="dc-summary__val">{receivedByName || '—'}</span>
            </div>
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Photo</span>
              <span className="dc-summary__val">
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt="thumb"
                    className="dc-summary__photo-thumb"
                  />
                ) : '—'}
              </span>
            </div>
            <div className="dc-summary__row">
              <span className="dc-summary__lbl">Signature</span>
              <span className="dc-summary__val">
                {hasSig ? '✓ Captured' : '—'}
              </span>
            </div>
          </div>

          <div className="dc-field">
            <label className="dc-field__label" htmlFor="dc-delivery-notes">
              Delivery notes <span className="dc-field__hint">(optional)</span>
            </label>
            <textarea
              id="dc-delivery-notes"
              className="dc-textarea"
              rows={3}
              placeholder="e.g. left at side door, gate code 1234, spoke with John…"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
            />
          </div>

          {submitError && (
            <div className="dc-error-inline">{submitError}</div>
          )}

          <button
            className="dc-cta dc-cta--deliver"
            onClick={() => setShowConfirm(true)}
            disabled={submitting || !receivedByName.trim()}
          >
            ✓ Mark as delivered
          </button>
        </div>
      )}

      {/* ── Confirm delivery dialog ── */}
      {showConfirm && (
        <div className="dc-overlay" role="dialog" aria-modal="true">
          <div className="dc-dialog">
            <h3 className="dc-dialog__title">Confirm delivery</h3>
            <p className="dc-dialog__body">
              Mark <strong>{qtyDelivered} {unitLabel}</strong> as delivered
              to <strong>{customer?.name}</strong>?<br />
              This will store the signature, attach the delivery documents, and finalize the stop.
            </p>
            {submitError && (
              <div className="dc-error-inline">{submitError}</div>
            )}
            <div className="dc-dialog__actions">
              <button
                className="dc-dialog__btn dc-dialog__btn--cancel"
                onClick={() => { setShowConfirm(false); setSubmitError(null) }}
              >
                Cancel
              </button>
              <button
                className="dc-dialog__btn dc-dialog__btn--confirm"
                onClick={handleMarkDelivered}
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Confirm delivery'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          SKIP STOP — always-visible bottom trigger
          ════════════════════════════════════════════════════════ */}
      <div className="dc-skip-trigger">
        <button
          className="dc-skip-trigger__btn"
          onClick={() => setShowSkip(true)}
        >
          Can't complete stop
        </button>
      </div>

      {showSkip && (
        <div className="dc-overlay" role="dialog" aria-modal="true">
          <div className="dc-dialog dc-dialog--skip">
            <h3 className="dc-dialog__title">Skip this stop</h3>
            <p className="dc-dialog__body">Select a reason for skipping.</p>

            <div className="dc-field">
              <label className="dc-field__label">Reason *</label>
              <select
                className="dc-select"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value as SkipReason)}
              >
                <option value="">Select reason…</option>
                {SKIP_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="dc-field">
              <label className="dc-field__label">Notes (optional)</label>
              <textarea
                className="dc-textarea"
                rows={3}
                placeholder="Additional details…"
                value={skipNotes}
                onChange={(e) => setSkipNotes(e.target.value)}
              />
            </div>

            {skipError && (
              <div className="dc-error-inline">{skipError}</div>
            )}

            <div className="dc-dialog__actions">
              <button
                className="dc-dialog__btn dc-dialog__btn--cancel"
                onClick={() => { setShowSkip(false); setSkipError(null) }}
              >
                Cancel
              </button>
              <button
                className="dc-dialog__btn dc-dialog__btn--skip"
                disabled={!skipReason || skipping}
                onClick={handleSkip}
              >
                {skipping ? 'Skipping…' : 'Skip stop'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
