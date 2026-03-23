/**
 * src/types/pipeline.ts
 *
 * Types for the OGS Sales Pipeline feature.
 * PipelineLead documents live at leads/{companyId} and are 1:1 with
 * customers/{companyId}. Distinct from the legacy CRM Lead type in crm.ts.
 */

import type { Timestamp } from 'firebase/firestore'

// ── Stage ─────────────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'new_signup'
  | 'pending_setup'
  | 'quote_requested'
  | 'quote_sent'
  | 'negotiating'
  | 'won'
  | 'lost'
  | 'stalled'

/** Stages shown as board columns (excludes terminal stages). */
export const BOARD_STAGES: PipelineStage[] = [
  'new_signup',
  'pending_setup',
  'quote_requested',
  'quote_sent',
  'negotiating',
  'stalled',
]

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new_signup:      'New Signup',
  pending_setup:   'Pending Setup',
  quote_requested: 'Quote Requested',
  quote_sent:      'Quote Sent',
  negotiating:     'Negotiating',
  won:             'Won',
  lost:            'Lost',
  stalled:         'Stalled',
}

/** Ordered list used to validate forward-only transitions. */
export const STAGE_ORDER: PipelineStage[] = [
  'new_signup',
  'pending_setup',
  'quote_requested',
  'quote_sent',
  'negotiating',
  'won',
]

// ── Priority ──────────────────────────────────────────────────────────────────

export type LeadPriority = 'high' | 'normal' | 'low'

// ── Source ────────────────────────────────────────────────────────────────────

export type LeadSource = 'online_signup' | 'manual' | 'referral' | 'outreach'

// ── Activity ──────────────────────────────────────────────────────────────────

export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'stage_change' | 'system'

export interface ActivityEntry {
  id: string
  type: ActivityType
  body: string
  createdBy: string  // uid or 'system'
  createdAt: Timestamp
}

// ── Stage History ─────────────────────────────────────────────────────────────

export interface StageHistoryEntry {
  stage: PipelineStage
  enteredAt: Timestamp
  exitedAt: Timestamp | null
  actor: string  // uid or 'system'
  note: string | null
}

// ── Loss Reasons ──────────────────────────────────────────────────────────────

export type LossReason =
  | 'chose_competitor'
  | 'price'
  | 'no_longer_needed'
  | 'unresponsive'
  | 'other'

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  chose_competitor: 'Chose a competitor',
  price:            'Price',
  no_longer_needed: 'No longer needed',
  unresponsive:     'Unresponsive',
  other:            'Other',
}

// ── Lead document ─────────────────────────────────────────────────────────────

export interface PipelineLead {
  id: string
  companyId: string
  companyName: string
  businessType: string | null
  stage: PipelineStage
  assignedTo: string | null     // uid of assigned sales rep
  assignedAt: Timestamp | null
  priority: LeadPriority
  estimatedMonthlyValue: number
  source: LeadSource
  notes: ActivityEntry[]        // inline activity log
  stageHistory: StageHistoryEntry[]
  nextFollowUpAt: Timestamp | null
  tags: string[]
  lostReason: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Filters ───────────────────────────────────────────────────────────────────

export interface PipelineFilters {
  assignedTo: string[]       // uid[]  — empty = all
  businessType: string[]     // empty = all
  priority: LeadPriority[]   // empty = all
  unassignedOnly: boolean
}

export const DEFAULT_FILTERS: PipelineFilters = {
  assignedTo: [],
  businessType: [],
  priority: [],
  unassignedOnly: false,
}
