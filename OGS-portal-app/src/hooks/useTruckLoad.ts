/**
 * src/hooks/useTruckLoad.ts
 *
 * Manages the pre-departure truck load checklist for a run.
 *
 * - Subscribes to /runs/{runId}/manifest in real time (onSnapshot).
 * - handleScan:  validates, writes manifest + cylinder docs, returns ScanResult.
 *   When the manifest has not been pre-populated by the cloud function, any
 *   cylinder found in /cylinders is accepted and auto-added to the manifest.
 * - startRun:    writes loadStatus/loadCompletedAt/loadedBy to run doc, navigates.
 * - flagMissingCylinder: writes to /runs/{runId}/flags/{cylinderId}.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { runManifestCol } from '../lib/firestore'
import { useAuth } from './useAuth'
import type { ManifestItem } from '../types/cylinder'
import type { Cylinder } from '../types/cylinder'
import type { Tank } from '../types/tank'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Tank QR codes encode a URL: https://ogs-portal.web.app/driver/truck?scan=TANK_ID
 * Plain cylinderIds are bare strings.
 * This extracts the actual ID from either format.
 *
 * IMPORTANT: If the raw value is a URL we MUST extract the `scan` param.
 * Falling back to the raw URL string would pass a path containing `//` to
 * Firestore's doc() which throws "Invalid segment... Paths must not contain
 * // in them."
 */
function extractId(raw: string): string {
  const cleaned = raw.trim()
  // If it looks like a URL (has a protocol), extract the scan query param.
  if (cleaned.includes('://')) {
    try {
      const url = new URL(cleaned)
      return url.searchParams.get('scan') ?? ''
    } catch {
      return ''  // Unparseable URL — reject rather than pass raw value to Firestore
    }
  }
  return cleaned
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface ScanResult {
  status: 'success' | 'notInManifest' | 'duplicate' | 'error'
  item?: ManifestItem
  message: string
}

export interface UseTruckLoadResult {
  manifest: ManifestItem[]
  scannedIds: Set<string>
  /** Number of cylinders scanned ad-hoc (not pre-listed in manifest) */
  adHocCount: number
  progress: { scanned: number; total: number }
  allScanned: boolean
  loading: boolean
  isStarting: boolean
  handleScan: (cylinderId: string) => Promise<ScanResult>
  startRun: () => Promise<void>
  flagMissingCylinder: (cylinderId: string, notes: string) => Promise<void>
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useTruckLoad(runId: string | null | undefined): UseTruckLoadResult {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [manifest, setManifest] = useState<ManifestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)

  // ── Real-time manifest subscription ─────────────────────────────────────────
  useEffect(() => {
    if (!runId) {
      setLoading(false)
      return
    }

    setLoading(true)

    const unsub = onSnapshot(
      runManifestCol(runId),
      (snap) => {
        setManifest(
          snap.docs.map((d) => ({ ...d.data(), cylinderId: d.id } as ManifestItem)),
        )
        setLoading(false)
      },
      (err) => {
        console.error('[useTruckLoad] manifest snapshot error:', err)
        setLoading(false)
      },
    )

    return unsub
  }, [runId])

  // ── Derived state ────────────────────────────────────────────────────────────
  const scannedIds = useMemo(
    () => new Set(manifest.filter((m) => m.scanned).map((m) => m.cylinderId)),
    [manifest],
  )

  // Track cylinders scanned ad-hoc (not pre-listed in manifest)
  const [adHocScanned, setAdHocScanned] = useState<Set<string>>(new Set())

  const progress = useMemo(
    () => ({
      // In dynamic mode (no pre-populated manifest) count ad-hoc scans
      scanned: manifest.length > 0 ? scannedIds.size : adHocScanned.size,
      total:   manifest.length,
    }),
    [scannedIds, adHocScanned, manifest],
  )

  const allScanned =
    // Pre-populated manifest: every item must be scanned
    (manifest.length > 0 && scannedIds.size === manifest.length) ||
    // Dynamic/empty manifest: at least one cylinder scanned ad-hoc
    (manifest.length === 0 && adHocScanned.size > 0)

  // ── handleScan ────────────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (rawValue: string): Promise<ScanResult> => {
      if (!runId || !user) {
        return { status: 'error', message: 'Not authenticated.' }
      }

      // Tank QR codes encode a URL — extract the bare ID first.
      const cylinderId = extractId(rawValue)
      if (!cylinderId) {
        return { status: 'error', message: 'Could not read QR code value.' }
      }

      // ── Case 1: cylinder is in the pre-populated manifest ──────────────────
      const item = manifest.find((m) => m.cylinderId === cylinderId)

      if (item) {
        if (scannedIds.has(cylinderId)) {
          return {
            status: 'duplicate',
            message: `${item.productName} ${item.sizeLabel} is already scanned.`,
            item,
          }
        }

        try {
          const now = serverTimestamp()
          await setDoc(
            doc(db, 'runs', runId, 'manifest', cylinderId),
            { scanned: true, scannedAt: now, scannedBy: user.id },
            { merge: true },
          )
          await setDoc(
            doc(db, 'tanks', cylinderId),
            { status: 'on_truck', driverId: user.id, loadedAt: now },
            { merge: true },
          )
          return {
            status: 'success',
            item,
            message: `✓ ${item.productName} ${item.sizeLabel} — Stop #${item.stopSequence} — ${item.customerName}`,
          }
        } catch (err) {
          return { status: 'error', message: err instanceof Error ? err.message : 'Scan failed.' }
        }
      }

      // Duplicate ad-hoc scan
      if (adHocScanned.has(cylinderId)) {
        return { status: 'duplicate', message: `Already scanned ${cylinderId}.` }
      }

      try {
        const now = serverTimestamp()

        // ── Case 2: look up /tanks first — tank QR codes point here ───────────
        const tankSnap = await getDoc(doc(db, 'tanks', cylinderId))
        if (tankSnap.exists()) {
          const tank = tankSnap.data() as Tank
          const productName = `${tank.gasType ?? ''} ${tank.sizeLabel ?? ''}`.trim() || 'Tank'

          const autoItem: Omit<ManifestItem, 'scannedAt' | 'scannedBy'> = {
            cylinderId,
            productId:    cylinderId,
            productName,
            sizeLabel:    tank.sizeLabel  ?? '',
            customerId:   '',
            customerName: 'Loaded from inventory',
            stopSequence: 0,
            orderType:    'offRoute',
            required:     true,
            scanned:      true,
          }

          await setDoc(
            doc(db, 'runs', runId, 'manifest', cylinderId),
            { ...autoItem, scannedAt: now, scannedBy: user.id },
            { merge: true },
          )
          await setDoc(
            doc(db, 'tanks', cylinderId),
            { status: 'on_truck', driverId: user.id, loadedAt: now },
            { merge: true },
          )

          setAdHocScanned((prev) => new Set([...prev, cylinderId]))

          const label = `${productName} (${tank.serialNumber ?? cylinderId})`
          return {
            status: 'success',
            item: { ...autoItem, scanned: true },
            message: `✓ ${label} loaded`,
          }
        }

        // ── Case 3: fall back to /cylinders ───────────────────────────────────
        const cylSnap = await getDoc(doc(db, 'cylinders', cylinderId))
        if (cylSnap.exists()) {
          const cyl = cylSnap.data() as Cylinder

          const autoItem: Omit<ManifestItem, 'scannedAt' | 'scannedBy'> = {
            cylinderId,
            productId:    cyl.productId   ?? '',
            productName:  cyl.productName ?? 'Cylinder',
            sizeLabel:    cyl.sizeLabel   ?? '',
            customerId:   '',
            customerName: 'Loaded from inventory',
            stopSequence: 0,
            orderType:    'offRoute',
            required:     true,
            scanned:      true,
          }

          await setDoc(
            doc(db, 'runs', runId, 'manifest', cylinderId),
            { ...autoItem, scannedAt: now, scannedBy: user.id },
            { merge: true },
          )
          await setDoc(
            doc(db, 'cylinders', cylinderId),
            { status: 'onTruck', currentRunId: runId, lastScannedAt: now, lastScannedBy: user.id },
            { merge: true },
          )

          setAdHocScanned((prev) => new Set([...prev, cylinderId]))

          return {
            status: 'success',
            item: { ...autoItem, scanned: true },
            message: `✓ ${cyl.productName ?? 'Cylinder'} ${cyl.sizeLabel ?? ''} loaded`,
          }
        }

        // ── Case 4: completely unknown — write minimal record, never block driver ──
        await setDoc(
          doc(db, 'tanks', cylinderId),
          { id: cylinderId, serialNumber: cylinderId, gasType: '', sizeLabel: '', status: 'on_truck', driverId: user.id, loadedAt: now },
          { merge: true },
        )
        await setDoc(
          doc(db, 'runs', runId, 'manifest', cylinderId),
          {
            cylinderId, productId: '', productName: 'Unknown tank', sizeLabel: '',
            customerId: '', customerName: 'Unknown', stopSequence: 0,
            orderType: 'offRoute', required: true, scanned: true,
            scannedAt: now, scannedBy: user.id, unknownCylinder: true,
          },
          { merge: true },
        )

        setAdHocScanned((prev) => new Set([...prev, cylinderId]))

        return {
          status: 'success',
          message: `✓ Tank ${cylinderId} loaded (not in registry — contact dispatch)`,
        }

      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : 'Scan failed.' }
      }
    },
    [runId, user, manifest, scannedIds, adHocScanned],
  )

  // ── startRun ──────────────────────────────────────────────────────────────────
  const startRun = useCallback(async () => {
    if (!runId || !user || !allScanned) return

    setIsStarting(true)
    try {
      await updateDoc(doc(db, 'runs', runId), {
        loadStatus: 'started',
        loadCompletedAt: serverTimestamp(),
        loadedBy: user.id,
      })
      navigate('/driver/schedule')
    } finally {
      setIsStarting(false)
    }
  }, [runId, user, allScanned, navigate])

  // ── flagMissingCylinder ──────────────────────────────────────────────────────
  const flagMissingCylinder = useCallback(
    async (cylinderId: string, notes: string) => {
      if (!runId || !user) return

      await setDoc(doc(db, 'runs', runId, 'flags', cylinderId), {
        cylinderId,
        reportedBy: user.id,
        reportedAt: serverTimestamp(),
        notes,
        resolved: false,
      })
    },
    [runId, user],
  )

  return {
    manifest,
    scannedIds,
    adHocCount: adHocScanned.size,
    progress,
    allScanned,
    loading,
    isStarting,
    handleScan,
    startRun,
    flagMissingCylinder,
  }
}
