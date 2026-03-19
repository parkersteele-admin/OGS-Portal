/**
 * src/hooks/useTruckLoad.ts
 *
 * Manages the pre-departure truck load checklist for a run.
 *
 * - Subscribes to /runs/{runId}/manifest in real time (onSnapshot).
 * - handleScan:  validates, writes manifest + cylinder docs, returns ScanResult.
 * - startRun:    writes loadStatus/loadCompletedAt/loadedBy to run doc, navigates.
 * - flagMissingCylinder: writes to /runs/{runId}/flags/{cylinderId}.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { runManifestCol } from '../lib/firestore'
import { useAuth } from './useAuth'
import type { ManifestItem } from '../types/cylinder'

// ── Public types ───────────────────────────────────────────────────────────────

export interface ScanResult {
  status: 'success' | 'notInManifest' | 'duplicate' | 'error'
  item?: ManifestItem
  message: string
}

export interface UseTruckLoadResult {
  manifest: ManifestItem[]
  scannedIds: Set<string>
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

  const progress = useMemo(
    () => ({ scanned: scannedIds.size, total: manifest.length }),
    [scannedIds, manifest],
  )

  const allScanned = manifest.length > 0 && scannedIds.size === manifest.length

  // ── handleScan ────────────────────────────────────────────────────────────────
  const handleScan = useCallback(
    async (cylinderId: string): Promise<ScanResult> => {
      if (!runId || !user) {
        return { status: 'error', message: 'Not authenticated.' }
      }

      const item = manifest.find((m) => m.cylinderId === cylinderId)

      if (!item) {
        return {
          status: 'notInManifest',
          message: `Cylinder ${cylinderId} is not on today's manifest.`,
        }
      }

      if (scannedIds.has(cylinderId)) {
        return {
          status: 'duplicate',
          message: `${item.productName} ${item.sizeLabel} is already scanned.`,
          item,
        }
      }

      try {
        const now = serverTimestamp()

        // Mark cylinder as scanned in manifest
        await setDoc(
          doc(db, 'runs', runId, 'manifest', cylinderId),
          { scanned: true, scannedAt: now, scannedBy: user.id },
          { merge: true },
        )

        // Update cylinder registry
        await setDoc(
          doc(db, 'cylinders', cylinderId),
          {
            status: 'onTruck',
            currentRunId: runId,
            lastScannedAt: now,
            lastScannedBy: user.id,
          },
          { merge: true },
        )

        return {
          status: 'success',
          item,
          message: `${item.productName} ${item.sizeLabel} — Stop #${item.stopSequence} — ${item.customerName}`,
        }
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : 'Scan failed. Please try again.',
        }
      }
    },
    [runId, user, manifest, scannedIds],
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
    progress,
    allScanned,
    loading,
    isStarting,
    handleScan,
    startRun,
    flagMissingCylinder,
  }
}
