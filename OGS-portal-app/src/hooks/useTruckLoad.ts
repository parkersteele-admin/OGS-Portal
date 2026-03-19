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
    async (cylinderId: string): Promise<ScanResult> => {
      if (!runId || !user) {
        return { status: 'error', message: 'Not authenticated.' }
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
            doc(db, 'cylinders', cylinderId),
            { status: 'onTruck', currentRunId: runId, lastScannedAt: now, lastScannedBy: user.id },
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

      // ── Case 2: cylinder not in manifest — look it up in /cylinders ─────────
      // This handles the case where the manifest cloud function hasn't run yet,
      // or the cylinder is a valid physical asset being loaded ad-hoc.
      if (adHocScanned.has(cylinderId)) {
        return { status: 'duplicate', message: `Cylinder ${cylinderId} already scanned.` }
      }

      try {
        const cylSnap = await getDoc(doc(db, 'cylinders', cylinderId))
        const now = serverTimestamp()

        if (cylSnap.exists()) {
          // Known cylinder — accept it, auto-create manifest entry
          const cyl = cylSnap.data() as Cylinder

          const autoItem: Omit<ManifestItem, 'scannedAt' | 'scannedBy'> = {
            cylinderId,
            productId:    cyl.productId   ?? '',
            productName:  cyl.productName ?? 'Cylinder',
            sizeLabel:    cyl.sizeLabel   ?? '',
            customerId:   '',
            customerName: 'Unknown — scanned ad-hoc',
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
        } else {
          // Cylinder not in registry — still accept it (write a minimal record)
          // so the driver isn't blocked. Flag as unknown.
          await setDoc(
            doc(db, 'cylinders', cylinderId),
            {
              cylinderId,
              productId:   '',
              productName: 'Unknown',
              sizeLabel:   '',
              status:      'onTruck',
              currentRunId: runId,
              lastScannedAt: now,
              lastScannedBy: user.id,
            },
            { merge: true },
          )
          await setDoc(
            doc(db, 'runs', runId, 'manifest', cylinderId),
            {
              cylinderId,
              productId:    '',
              productName:  'Unknown cylinder',
              sizeLabel:    '',
              customerId:   '',
              customerName: 'Unknown',
              stopSequence:  0,
              orderType:     'offRoute',
              required:      true,
              scanned:       true,
              scannedAt:     now,
              scannedBy:     user.id,
              unknownCylinder: true,
            },
            { merge: true },
          )

          setAdHocScanned((prev) => new Set([...prev, cylinderId]))

          return {
            status: 'success',
            message: `✓ Cylinder ${cylinderId} loaded (not in registry — dispatch notified)`,
          }
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
