/**
 * src/components/maps/DispatchMap.tsx
 *
 * Full-featured dispatch map for the OGS Portal ops dashboard.
 *
 * Props:
 *   stops     — RunStop[] for the active run (ordered by RunStop.order)
 *   customers — Customer records keyed by customerId (for lat/lng + name)
 *   driverName — Display name for the truck pin tooltip
 *
 * Marker types:
 *   🟠 Truck       — animated orange pin; shows driver name; positioned at
 *                    the driver's current location via useDriverLocation
 *   🟢 Completed   — green checkmark pin
 *   🟠 Current     — pulsing orange pin (first 'arrived' or first 'pending' stop)
 *   ⚪ Pending     — gray numbered circle pin
 *   Click any stop pin → StopDetailPopover
 *
 * Map style:
 *   Retro / clean light theme; POI labels hidden; transit hidden.
 *   Requires a Map ID (VITE_GOOGLE_MAPS_MAP_ID) for Advanced Markers support.
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useAdvancedMarkerRef,
  useMap,
} from '@vis.gl/react-google-maps'
import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_MAP_ID,
  hasUsableGoogleMapsKey,
  hasGoogleMapsMapId,
} from '../../lib/env'
import { useDriverLocation } from '../../hooks/useDriverLocation'
import { RoutePolyline } from './RoutePolyline'
import type { RunStop, RunStopStatus } from '../../types/run'
import type { Customer } from '../../types/customer'

// ── Constants ──────────────────────────────────────────────────────────────────

type LatLngLiteral  = { lat: number; lng: number }

const CENTRAL_OHIO: LatLngLiteral = { lat: 40.0, lng: -82.9 }
const DEFAULT_ZOOM = 10

// Brand + status colours
const COLOR_BRAND     = '#E87722'
const COLOR_COMPLETED = '#22c55e'
const COLOR_PENDING   = '#6b7280'
const COLOR_WHITE     = '#ffffff'

// ── Stop detail popover ────────────────────────────────────────────────────────

interface StopDetailPopoverProps {
  stop:     RunStop
  customer: Customer | undefined
  onClose:  () => void
}

function StopDetailPopover({ stop, customer, onClose }: StopDetailPopoverProps) {
  const statusLabel: Record<RunStopStatus, string> = {
    pending:   'Pending',
    arrived:   'Arrived',
    completed: 'Completed',
    skipped:   'Skipped',
  }
  const statusColor: Record<RunStopStatus, string> = {
    pending:   COLOR_PENDING,
    arrived:   COLOR_BRAND,
    completed: COLOR_COMPLETED,
    skipped:   '#ef4444',
  }

  return (
    <div style={{ minWidth: 200, fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
        Stop #{stop.order} — {customer?.name ?? stop.customerId}
      </div>
      <div style={{ color: statusColor[stop.status], fontWeight: 600, marginBottom: 6 }}>
        {statusLabel[stop.status]}
      </div>
      {customer && (
        <div style={{ color: '#374151', marginBottom: 4 }}>
          {customer.address}<br />
          {customer.city}, {customer.state} {customer.zip}
        </div>
      )}
      {stop.gallonsDelivered != null && (
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#6b7280' }}>Delivered: </span>
          <strong>{stop.gallonsDelivered} gal</strong>
        </div>
      )}
      {stop.notes && (
        <div style={{ marginTop: 4, fontStyle: 'italic', color: '#6b7280' }}>
          {stop.notes}
        </div>
      )}
      <button
        onClick={onClose}
        style={{
          marginTop: 8, fontSize: 12, color: COLOR_BRAND, background: 'none',
          border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        Close
      </button>
    </div>
  )
}

// ── Truck marker ───────────────────────────────────────────────────────────────

interface TruckMarkerProps {
  lat:        number
  lng:        number
  driverName: string
}

function TruckMarker({ lat, lng, driverName }: TruckMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  const [open, setOpen]     = useState(false)

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat, lng }}
        title={driverName}
        onClick={() => setOpen((v) => !v)}
        zIndex={100}
      >
        {/* Animated truck icon */}
        <div
          style={{
            width: 40, height: 40,
            borderRadius: '50%',
            background: COLOR_BRAND,
            border: `3px solid ${COLOR_WHITE}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'ogs-truck-pulse 2s ease-in-out infinite',
            cursor: 'pointer',
          }}
        >
          {/* Simple truck SVG */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M1 3h15v13H1V3zM16 8h4l3 4v5h-7V8z"
              stroke={COLOR_WHITE} strokeWidth="1.8" strokeLinejoin="round"
            />
            <circle cx="5.5"  cy="18.5" r="1.5" fill={COLOR_WHITE}/>
            <circle cx="18.5" cy="18.5" r="1.5" fill={COLOR_WHITE}/>
          </svg>
        </div>
      </AdvancedMarker>

      {open && marker && (
        <InfoWindow anchor={marker} onClose={() => setOpen(false)}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>🚛 {driverName}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Current position (last stop proxy)</div>
        </InfoWindow>
      )}
    </>
  )
}

// ── Stop marker ────────────────────────────────────────────────────────────────

interface StopMarkerProps {
  stop:      RunStop
  customer:  Customer | undefined
  isCurrent: boolean
}

function StopMarker({ stop, customer, isCurrent }: StopMarkerProps) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  const [open, setOpen]     = useState(false)

  if (!customer?.lat || !customer?.lng) return null

  const isCompleted = stop.status === 'completed'

  let bgColor    = COLOR_PENDING
  const glyphColor = COLOR_WHITE
  // glyphNode is used only inside the custom React div (current-stop pulse).
  // pinGlyph must be string | Element | URL — never a React node.
  let glyphNode: React.ReactNode = (
    <span style={{ fontWeight: 700, fontSize: 11 }}>{stop.order}</span>
  )
  let pinGlyph: string = String(stop.order)

  if (isCompleted) {
    bgColor = COLOR_COMPLETED
    glyphNode = (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke={COLOR_WHITE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
    pinGlyph = '✓'
  } else if (isCurrent) {
    bgColor = COLOR_BRAND
  }

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: customer.lat, lng: customer.lng }}
        title={`Stop #${stop.order} — ${customer.name}`}
        onClick={() => setOpen((v) => !v)}
        zIndex={isCurrent ? 50 : isCompleted ? 10 : 20}
      >
        {isCurrent && !isCompleted ? (
          /* Pulsing orange ring for the current stop */
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: COLOR_BRAND,
              opacity: 0.3,
              animation: 'ogs-current-pulse 1.5s ease-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 4,
              borderRadius: '50%',
              background: COLOR_BRAND,
              border: `2px solid ${COLOR_WHITE}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: COLOR_WHITE,
            }}>
              {glyphNode}
            </div>
          </div>
        ) : (
          <Pin
            background={bgColor}
            borderColor={glyphColor}
            glyphColor={glyphColor}
            glyph={pinGlyph}
            scale={isCurrent ? 1.2 : 1}
          />
        )}
      </AdvancedMarker>

      {open && marker && (
        <InfoWindow anchor={marker} onClose={() => setOpen(false)}>
          <StopDetailPopover
            stop={stop}
            customer={customer}
            onClose={() => setOpen(false)}
          />
        </InfoWindow>
      )}
    </>
  )
}

// ── Keyframe injection ─────────────────────────────────────────────────────────
// Injected once into <head> so marker animations work without a CSS module.

const KEYFRAMES = `
  @keyframes ogs-truck-pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 2px 8px rgba(232,119,34,0.4); }
    50%       { transform: scale(1.08); box-shadow: 0 4px 16px rgba(232,119,34,0.6); }
  }
  @keyframes ogs-current-pulse {
    0%   { transform: scale(1);   opacity: 0.4; }
    100% { transform: scale(2.4); opacity: 0; }
  }
`

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  const tag = document.createElement('style')
  tag.textContent = KEYFRAMES
  document.head.appendChild(tag)
  stylesInjected = true
}

// ── Camera controller ─────────────────────────────────────────────────────────
// Renders nothing; pans the map whenever `target` changes.
function CameraPan({ target }: { target: LatLngLiteral | null | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (map && target) map.panTo(target)
  }, [map, target])
  return null
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface DispatchMapProps {
  stops:        RunStop[]
  customers:    Record<string, Customer>
  driverName:   string
  /** Override map centre — defaults to central Ohio. */
  center?:      LatLngLiteral
  /** Override zoom level. */
  zoom?:        number
  /** CSS height for the map container. Defaults to '100%'. */
  height?:      string
  /** If set, smoothly pans the map to this location. */
  cameraTarget?: LatLngLiteral | null
}

export function DispatchMap({
  stops,
  customers,
  driverName,
  center = CENTRAL_OHIO,
  zoom   = DEFAULT_ZOOM,
  height = '100%',
  cameraTarget,
}: DispatchMapProps) {
  injectStyles()

  const driverPosition = useDriverLocation(stops, customers)

  // Determine which stop is "current" — first arrived, otherwise first pending
  const currentStop =
    stops.find((s) => s.status === 'arrived') ??
    stops.find((s) => s.status === 'pending')

  const handleMapClick = useCallback(() => {
    // Deselect any open popovers — individual markers handle their own state.
  }, [])

  if (!hasUsableGoogleMapsKey) {
    return (
      <div
        style={{
          width: '100%',
          height,
          borderRadius: 8,
          border: '1px solid #f59e0b',
          background: '#fffbeb',
          color: '#92400e',
          padding: 16,
          fontSize: 13,
          lineHeight: 1.5,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        Google Maps is not configured. Set a real VITE_GOOGLE_MAPS_API_KEY in .env.local and restart Vite.
      </div>
    )
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }}>
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          mapId={hasGoogleMapsMapId ? GOOGLE_MAPS_MAP_ID : undefined}
          disableDefaultUI={false}
          gestureHandling="cooperative"
          onClick={handleMapClick}
          reuseMaps
        >
          {/* Camera controller — pans map when a stop is clicked in the sidebar */}
          <CameraPan target={cameraTarget} />

          {/* Route line */}
          <RoutePolyline stops={stops} customers={customers} />

          {/* Truck position */}
          {driverPosition && (
            <TruckMarker
              lat={driverPosition.lat}
              lng={driverPosition.lng}
              driverName={driverName}
            />
          )}

          {/* Stop markers */}
          {[...stops]
            .sort((a, b) => a.order - b.order)
            .map((stop) => (
              <StopMarker
                key={stop.id}
                stop={stop}
                customer={customers[stop.customerId]}
                isCurrent={stop.id === currentStop?.id}
              />
            ))}
        </Map>
      </div>
    </APIProvider>
  )
}
