/**
 * src/features/onboarding/SignaturePad.tsx
 *
 * Draw-or-type signature capture. Emits a PNG data URL for drawn signatures.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

import type { SignatureValue } from './onboardingService'

export type { SignatureValue }

interface Props {
  name: string
  value: SignatureValue
  onChange: (v: SignatureValue) => void
}

const WIDTH = 560
const HEIGHT = 160

export const SignaturePad: React.FC<Props> = ({ name, value, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(Boolean(value.imageDataUrl))

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    c.width = WIDTH * ratio
    c.height = HEIGHT * ratio
    const ctx = c.getContext('2d')!
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0a1b33'
  }, [])

  useEffect(() => {
    if (value.method === 'drawn') {
      setupCanvas()
      setHasInk(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.method])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (canvasRef.current && hasInk) {
      onChange({ method: 'drawn', imageDataUrl: canvasRef.current.toDataURL('image/png') })
    }
  }

  const clear = () => {
    setupCanvas()
    setHasInk(false)
    onChange({ method: 'drawn', imageDataUrl: undefined })
  }

  return (
    <div className="obp-sig">
      <div className="obp-sig__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={value.method === 'typed'}
          className={`obp-sig__tab${value.method === 'typed' ? ' is-active' : ''}`}
          onClick={() => onChange({ method: 'typed' })}>Type</button>
        <button type="button" role="tab" aria-selected={value.method === 'drawn'}
          className={`obp-sig__tab${value.method === 'drawn' ? ' is-active' : ''}`}
          onClick={() => onChange({ method: 'drawn', imageDataUrl: undefined })}>Draw</button>
      </div>

      {value.method === 'typed' ? (
        <div className="obp-sig__typed" aria-label="Typed signature preview">
          {name ? <span>{name}</span> : <em>Enter your full name above to adopt it as your signature</em>}
        </div>
      ) : (
        <div className="obp-sig__canvas-wrap">
          <canvas
            ref={canvasRef}
            className="obp-sig__canvas"
            style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            aria-label="Draw your signature"
          />
          {!hasInk && <div className="obp-sig__hint">Sign here with your mouse or finger</div>}
          <button type="button" className="obp-link obp-sig__clear" onClick={clear}>Clear</button>
        </div>
      )}
    </div>
  )
}
