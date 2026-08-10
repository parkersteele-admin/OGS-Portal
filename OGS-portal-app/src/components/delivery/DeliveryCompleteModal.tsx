import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { adminFinalizeDelivery } from '../../services/deliveryService'
import { getProductDropdown, type ProductDropdownItem } from '../../services/productService'
import type { Order } from '../../types/order'
import './DeliveryCompleteModal.css'

interface DeliveryCompleteModalProps {
  order: Order
  runId: string
  stopId: string
  onSuccess: () => void
  onClose: () => void
}

interface EditableDeliveryItem {
  productId: string
  orderedQty: number
  qty: number
}

type Step = 1 | 2 | 3 | 4

interface SignatureCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onSignedChange: (signed: boolean) => void
}

function SignatureCanvas({ canvasRef, onSignedChange }: SignatureCanvasProps) {
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
      const ctx = canvas.getContext('2d')
      if (!ctx) return
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
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const { x, y } = getPos(e)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111'
      ctx.lineTo(x, y)
      ctx.stroke()
      if (!hasStroke.current) {
        hasStroke.current = true
        onSignedChange(true)
      }
    },
    [canvasRef, onSignedChange],
  )

  const onPointerUp = useCallback(() => {
    isDrawing.current = false
  }, [])

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    onSignedChange(false)
  }, [canvasRef, onSignedChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const cssWidth = Math.max(1, Math.round(rect.width))
      const cssHeight = Math.max(1, Math.round(rect.height))
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.round(cssWidth * dpr)
      const pixelHeight = Math.round(cssHeight * dpr)
      if (canvas.width === pixelWidth && canvas.height === pixelHeight) {
        return
      }

      canvas.width = pixelWidth
      canvas.height = pixelHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, cssWidth, cssHeight)

      hasStroke.current = false
      onSignedChange(false)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement ?? canvas)
    return () => observer.disconnect()
  }, [canvasRef])

  return (
    <div className="dcm-signature-wrap">
      <canvas
        ref={canvasRef}
        className="dcm-signature-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ touchAction: 'none' }}
      />
      <button type="button" className="dcm-clear" onClick={clearSignature}>
        Clear
      </button>
    </div>
  )
}

export function DeliveryCompleteModal({
  order,
  runId,
  stopId,
  onSuccess,
  onClose,
}: DeliveryCompleteModalProps) {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<EditableDeliveryItem[]>([])
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [productOptions, setProductOptions] = useState<ProductDropdownItem[]>([])
  const [newItemProductId, setNewItemProductId] = useState('')
  const [newItemQty, setNewItemQty] = useState(1)

  const [receivedByName, setReceivedByName] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadProductNames() {
      try {
        const ids = Array.from(new Set(buildInitialItems(order).map((item) => item.productId))).filter(Boolean)
        if (ids.length === 0) return

        const resolved = await Promise.all(ids.map(async (productId) => {
          const snap = await getDoc(doc(db, 'products', productId))
          if (!snap.exists()) return [productId, productId] as const
          const name = snap.data().name
          return [productId, (typeof name === 'string' && name.trim()) ? name : productId] as const
        }))

        if (!cancelled) {
          setProductNames(Object.fromEntries(resolved))
        }
      } catch {
        // non-blocking
      }
    }

    loadProductNames()
    return () => {
      cancelled = true
    }
  }, [order])

  useEffect(() => {
    let cancelled = false

    getProductDropdown()
      .then((options) => {
        if (cancelled) return
        setProductOptions(options)
        setProductNames((prev) => {
          const next = { ...prev }
          for (const option of options) {
            next[option.id] = option.name
          }
          return next
        })
      })
      .catch(() => {
        if (!cancelled) setProductOptions([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function hydrateUnknownNames() {
      const unknownIds = items
        .map((item) => item.productId)
        .filter((id) => id && !productNames[id])

      if (unknownIds.length === 0) return

      const resolved = await Promise.all(unknownIds.map(async (productId) => {
        const snap = await getDoc(doc(db, 'products', productId))
        if (!snap.exists()) return [productId, productId] as const
        const name = snap.data().name
        return [productId, (typeof name === 'string' && name.trim()) ? name : productId] as const
      }))

      if (!cancelled) {
        setProductNames((prev) => ({
          ...prev,
          ...Object.fromEntries(resolved),
        }))
      }
    }

    hydrateUnknownNames().catch(() => {
      // non-blocking
    })

    return () => {
      cancelled = true
    }
  }, [items, productNames])

  useEffect(() => {
    setItems(buildInitialItems(order))
    setReceivedByName(order.deliveryContactName ?? '')
  }, [order])

  const allQtyValid = useMemo(() => {
    if (items.length === 0) return false
    return items.every((item) => item.qty >= 0) && items.some((item) => item.qty > 0)
  }, [items])

  const deliveredLineItems = useMemo(() => {
    return items
      .filter((item) => item.productId && item.qty > 0)
      .map((item) => ({ productId: item.productId, qty: item.qty }))
  }, [items])

  const totalDeliveredQty = useMemo(
    () => Number(deliveredLineItems.reduce((sum, item) => sum + item.qty, 0).toFixed(2)),
    [deliveredLineItems],
  )

  const canNext =
    (step === 1 && allQtyValid) ||
    (step === 2 && receivedByName.trim().length > 0) ||
    (step === 3 && hasSignature) ||
    step === 4

  function updateQty(current: number, delta: number) {
    return Math.max(0, current + delta)
  }

  function handleAddItem() {
    const productId = newItemProductId.trim()
    const qty = Number(newItemQty)
    if (!productId || !Number.isFinite(qty) || qty <= 0) return

    setItems((prev) => {
      const existingIdx = prev.findIndex((item) => item.productId === productId)
      if (existingIdx >= 0) {
        return prev.map((item, idx) => (
          idx === existingIdx
            ? { ...item, qty: Number((item.qty + qty).toFixed(2)) }
            : item
        ))
      }

      return [
        ...prev,
        {
          productId,
          orderedQty: 0,
          qty: Number(qty.toFixed(2)),
        },
      ]
    })

    setNewItemProductId('')
    setNewItemQty(1)
  }

  function handleRemoveAddedItem(productId: string) {
    setItems((prev) => prev.filter((item) => !(item.productId === productId && item.orderedQty === 0)))
  }

  function getSignatureDataUrl() {
    // Use stored signature data URL if available
    if (signatureDataUrl) return signatureDataUrl
    
    // Fallback: try to get from canvas (for Step 3)
    const canvas = canvasRef.current
    if (!canvas || !hasSignature) return null
    return canvas.toDataURL('image/png')
  }

  function handleNextStep() {
    if (step === 3 && hasSignature) {
      // Capture signature before moving to Step 4
      const canvas = canvasRef.current
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png')
        setSignatureDataUrl(dataUrl)
      }
    }
    setStep((s) => (s + 1) as Step)
  }

  async function handleCompleteDelivery() {
    setSubmitting(true)
    setError(null)
    try {
      const signatureDataUrl = getSignatureDataUrl()
      if (!signatureDataUrl) {
        throw new Error('Signature is required before submitting delivery.')
      }

      await adminFinalizeDelivery({
        runId,
        stopId,
        qtyDelivered: totalDeliveredQty,
        deliveredLineItems,
        receivedByName: receivedByName.trim(),
        signatureDataUrl,
        deliveryNotes: deliveryNotes.trim() || undefined,
      })

      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete delivery.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dcm-overlay" role="dialog" aria-modal="true" aria-label="Complete delivery modal">
      <div className="dcm-modal">
        <header className="dcm-header">
          <h2 className="dcm-title">Complete Delivery</h2>
          <button type="button" className="dcm-close" onClick={onClose} aria-label="Close delivery modal">
            ✕
          </button>
        </header>

        <div className="dcm-progress">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`dcm-progress-pill${step >= n ? ' dcm-progress-pill--active' : ''}`}>
              Step {n}
            </div>
          ))}
        </div>

        <div className="dcm-body">
          {step === 1 && (
            <section>
              <h3 className="dcm-step-title">Confirm Items</h3>
              {items.map((item, idx) => (
                <div key={`${item.productId}-${idx}`} className="dcm-item-row">
                  <div>
                    <div className="dcm-item-name">{productNames[item.productId] || item.productId}</div>
                    <div className="dcm-item-meta">
                      {item.orderedQty > 0 ? `Ordered: ${item.orderedQty}` : 'Added onsite'}
                    </div>
                  </div>
                  <div className="dcm-item-actions">
                    <div className="dcm-stepper">
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.map((row, rowIdx) => (
                          rowIdx === idx ? { ...row, qty: updateQty(row.qty, -1) } : row
                        )))}
                      >
                        −
                      </button>
                      <span>{item.qty}</span>
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.map((row, rowIdx) => (
                          rowIdx === idx ? { ...row, qty: updateQty(row.qty, 1) } : row
                        )))}
                      >
                        +
                      </button>
                    </div>
                    {item.orderedQty === 0 && (
                      <button
                        type="button"
                        className="dcm-remove-item"
                        onClick={() => handleRemoveAddedItem(item.productId)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="dcm-add-item-panel">
                <div className="dcm-add-item-grid">
                  <select
                    value={newItemProductId}
                    onChange={(event) => setNewItemProductId(event.target.value)}
                  >
                    <option value="">Select product to add...</option>
                    {productOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={newItemQty}
                    onChange={(event) => setNewItemQty(Number(event.target.value))}
                  />
                  <button
                    type="button"
                    className="dcm-add-item-btn"
                    onClick={handleAddItem}
                    disabled={!newItemProductId || !Number.isFinite(newItemQty) || newItemQty <= 0}
                  >
                    Add Item
                  </button>
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h3 className="dcm-step-title">Receiver Info</h3>
              <label className="dcm-field">
                <span>Received By (Name)</span>
                <input
                  value={receivedByName}
                  onChange={(event) => setReceivedByName(event.target.value)}
                  placeholder="Enter receiver name"
                />
              </label>
              <label className="dcm-field">
                <span>Delivery Notes (Optional)</span>
                <input
                  value={deliveryNotes}
                  onChange={(event) => setDeliveryNotes(event.target.value)}
                  placeholder="Add delivery notes"
                />
              </label>
            </section>
          )}

          {step === 3 && (
            <section>
              <h3 className="dcm-step-title">Signature Capture</h3>
              <div className="dcm-sig-instructions">
                <p>Have the customer sign below to confirm delivery. They must sign with their finger or a stylus.</p>
              </div>
              <SignatureCanvas canvasRef={canvasRef} onSignedChange={setHasSignature} />
            </section>
          )}

          {step === 4 && (
            <section>
              <h3 className="dcm-step-title">Confirm & Submit</h3>
              
              <div className="dcm-instructions">
                <p className="dcm-instructions__title">What happens next:</p>
                <ul className="dcm-instructions__list">
                  <li>Order status will be marked as <strong>Delivered</strong></li>
                  <li>Bill of Lading PDF will be generated</li>
                  <li>Delivery confirmation email with PDF will be sent to the customer</li>
                  <li>Customer signature will be securely stored</li>
                </ul>
              </div>

              <div className="dcm-summary">
                <p><strong>Receiver:</strong> {receivedByName}</p>
                <p><strong>Total Delivered Quantity:</strong> {totalDeliveredQty}</p>
                {deliveredLineItems.length > 0 && (
                  <div>
                    <strong>Delivered Items:</strong>
                    <ul>
                      {deliveredLineItems.map((item) => (
                        <li key={item.productId}>{productNames[item.productId] || item.productId}: {item.qty}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {deliveryNotes.trim() && <p><strong>Notes:</strong> {deliveryNotes}</p>}
              </div>

              <div className="dcm-signature-section">
                <p className="dcm-signature-label">Customer Signature:</p>
                {signatureDataUrl ? (
                  <img
                    className="dcm-signature-preview"
                    src={signatureDataUrl}
                    alt="Customer signature"
                  />
                ) : (
                  <div className="dcm-signature-placeholder">No signature captured</div>
                )}
              </div>

              {error && (
                <div className="dcm-error-box">
                  <p className="dcm-error">{error}</p>
                </div>
              )}
              {success && (
                <p className="dcm-success">
                  <CheckCircle2 size={16} /> Delivery Complete
                </p>
              )}

              <button
                type="button"
                className="dcm-submit"
                onClick={handleCompleteDelivery}
                disabled={submitting}
              >
                {submitting ? <Loader2 size={16} className="dcm-spin" /> : null}
                {submitting ? 'Completing…' : 'Complete Delivery & Send PDF'}
              </button>
            </section>
          )}
        </div>

        <footer className="dcm-footer">
          {step > 1 && (
            <button type="button" className="dcm-secondary" onClick={() => setStep((s) => (s - 1) as Step)}>
              ← Back
            </button>
          )}
          {step < 4 && (
            <button
              type="button"
              className="dcm-primary"
              onClick={handleNextStep}
              disabled={!canNext}
            >
              Next →
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function buildInitialItems(order: Order): EditableDeliveryItem[] {
  const fromQuoted = Array.isArray(order.quotedLineItems)
    ? order.quotedLineItems
      .map((item) => ({
        productId: String(item.productId ?? '').trim(),
        qty: Number(item.quantity ?? 0),
      }))
      .filter((item) => item.productId && item.qty > 0)
    : []

  if (fromQuoted.length > 0) {
    const merged = mergeByProductId(fromQuoted)
    return merged.map((item) => ({
      productId: item.productId,
      orderedQty: item.qty,
      qty: item.qty,
    }))
  }

  const fallback = [
    order.productId
      ? {
          productId: order.productId,
          qty: Number(order.quantity ?? 0),
        }
      : null,
    ...(order.addOns ?? []).map((item) => ({
      productId: item.productId,
      qty: Number(item.qty ?? 0),
    })),
  ].filter((item): item is { productId: string; qty: number } => !!item && !!item.productId)

  const merged = mergeByProductId(fallback)
  return merged.map((item) => ({
    productId: item.productId,
    orderedQty: item.qty,
    qty: item.qty,
  }))
}

function mergeByProductId(items: Array<{ productId: string; qty: number }>): Array<{ productId: string; qty: number }> {
  const map = new Map<string, number>()
  for (const item of items) {
    const current = map.get(item.productId) ?? 0
    map.set(item.productId, Number((current + Math.max(0, Number(item.qty) || 0)).toFixed(2)))
  }
  return [...map.entries()].map(([productId, qty]) => ({ productId, qty }))
}
