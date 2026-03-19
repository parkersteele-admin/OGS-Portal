/**
 * src/components/driver/QRScanner.tsx
 * BEM prefix: qrs-
 *
 * Reusable QR code scanner using the browser's getUserMedia API and jsqr
 * for decoding. Designed for warehouse/loading dock use — rear-facing camera,
 * continuous decode, 1.5s throttle between scans.
 *
 * jsqr is already in package.json (^1.4.0).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import jsQR from 'jsqr'
import './QRScanner.css'

// ── Props ──────────────────────────────────────────────────────────────────────

interface QRScannerProps {
  onScan: (cylinderId: string) => void
  onError?: (error: string) => void
  isActive: boolean
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function QRScanner({ onScan, onError, isActive, className = '' }: QRScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const rafRef     = useRef<number | null>(null)
  const lastScanAt = useRef<number>(0)

  type ViewfinderState = 'idle' | 'active' | 'success' | 'error'
  const [viewfinderState, setViewfinderState] = useState<ViewfinderState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── Stop camera ──────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) {
      video.srcObject = null
    }
  }, [])

  // ── Decode loop ──────────────────────────────────────────────────────────────
  const decode = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code?.data) {
          const now = Date.now()
          if (now - lastScanAt.current >= 1500) {
            lastScanAt.current = now

            // Brief green flash
            setViewfinderState('success')
            setTimeout(() => setViewfinderState('active'), 200)

            onScan(code.data)
            // Don't return early — keep scanning loop alive
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(decode)
  }, [onScan])

  // ── Camera lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      stopCamera()
      setViewfinderState('idle')
      return
    }

    setViewfinderState('active')
    setErrorMsg(null)
    lastScanAt.current = 0

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.play().then(() => {
          rafRef.current = requestAnimationFrame(decode)
        }).catch((err: Error) => {
          console.warn('[QRScanner] video.play() error:', err)
        })
      })
      .catch((err: Error) => {
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera permission in your browser settings and reload.'
            : err.name === 'NotFoundError'
            ? 'No camera found on this device.'
            : `Camera error: ${err.message}`
        setErrorMsg(msg)
        setViewfinderState('error')
        onError?.(msg)
      })

    return () => {
      stopCamera()
    }
  }, [isActive, decode, stopCamera, onError])

  // ── Render ───────────────────────────────────────────────────────────────────
  if (viewfinderState === 'error') {
    return (
      <div className={`qrs-error ${className}`.trim()}>
        <span className="qrs-error__icon" aria-hidden="true">🚫</span>
        <p className="qrs-error__msg">{errorMsg}</p>
        <p className="qrs-error__hint">
          On iOS: Settings → Safari → Camera → Allow.<br />
          On Android: tap the lock icon in your browser's address bar.
        </p>
      </div>
    )
  }

  const viewfinderClass = [
    'qrs-viewfinder',
    viewfinderState === 'active'  ? 'qrs-viewfinder--active'  : '',
    viewfinderState === 'success' ? 'qrs-viewfinder--success' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={viewfinderClass}>
      {/* Live video preview */}
      <video
        ref={videoRef}
        className="qrs-video"
        playsInline
        muted
        autoPlay
        aria-label="Camera viewfinder"
      />
      {/* Off-screen canvas used for frame analysis only */}
      <canvas ref={canvasRef} className="qrs-canvas" aria-hidden="true" />

      {/* Idle overlay */}
      {!isActive && (
        <div className="qrs-idle-overlay" aria-hidden="true">
          <span className="qrs-idle-overlay__icon">📷</span>
        </div>
      )}

      {/* Corner guides — purely decorative */}
      {isActive && (
        <>
          <span className="qrs-corner qrs-corner--tl" aria-hidden="true" />
          <span className="qrs-corner qrs-corner--tr" aria-hidden="true" />
          <span className="qrs-corner qrs-corner--bl" aria-hidden="true" />
          <span className="qrs-corner qrs-corner--br" aria-hidden="true" />
        </>
      )}
    </div>
  )
}
