/**
 * src/pages/ops/sales/SalesDashboard.tsx
 *
 * Main Sales Pipeline page — Kanban board (65%) + Today's Focus sidebar (35%).
 * Route: /ops/sales/dashboard
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PipelineBoard } from '../../../components/sales/PipelineBoard'
import { TodayFocus }    from '../../../components/sales/TodayFocus'
import { LeadDetailDrawer } from '../../../components/sales/LeadDetailDrawer'
import {
  subscribeToActiveLeads,
  getOverdueFollowUps,
  getNewSignupsToday,
  getStalledLeads,
  callAdvanceLeadStage,
} from '../../../services/pipelineService'
import { getUsersByRole } from '../../../services/userService'
import type { PipelineLead, PipelineStage, PipelineFilters } from '../../../types/pipeline'
import { DEFAULT_FILTERS } from '../../../types/pipeline'
import './SalesDashboard.css'

function buildRepNames(users: Array<{ id: string; firstName?: string; lastName?: string; name?: string }>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const u of users) {
    map[u.id] = u.name ?? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.id)
  }
  return map
}

const SalesDashboard: React.FC = () => {
  const navigate = useNavigate()

  // Live leads subscription
  const [leads, setLeads]     = useState<PipelineLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(true)

  // Today's focus (one-shot queries, refreshed by key)
  const [focusKey, setFocusKey] = useState(0)
  const refreshFocus = useCallback(() => setFocusKey((k) => k + 1), [])

  // Drawer
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null)

  // Filters
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS)

  // View mode navigation (list view lives on /ops/sales/pipeline)
  const goToList = () => navigate('/ops/sales/pipeline')

  // Sales reps
  const repsQuery = useQuery({
    queryKey: ['users', 'sales'],
    queryFn:  () => getUsersByRole('sales'),
    staleTime: 5 * 60_000,
  })
  const repNames = buildRepNames(repsQuery.data ?? [])

  // Today focus queries
  const { data: overdue = [],    isLoading: loadOverdue }    = useQuery({ queryKey: ['pipeline', 'overdue',    focusKey], queryFn: getOverdueFollowUps })
  const { data: newSignups = [], isLoading: loadSignups }    = useQuery({ queryKey: ['pipeline', 'newSignups', focusKey], queryFn: getNewSignupsToday })
  const { data: stalled = [],    isLoading: loadStalled }    = useQuery({ queryKey: ['pipeline', 'stalled',   focusKey], queryFn: getStalledLeads })

  // Live leads subscription
  useEffect(() => {
    const unsub = subscribeToActiveLeads((liveLeads) => {
      setLeads(liveLeads)
      setLeadsLoading(false)
    })
    return unsub
  }, [])

  // Sync selected lead from live data
  useEffect(() => {
    if (selectedLead) {
      const fresh = leads.find((l) => l.id === selectedLead.id)
      if (fresh) setSelectedLead(fresh)
    }
  }, [leads, selectedLead?.id])

  const handleStageChange = useCallback(
    async (lead: PipelineLead, newStage: PipelineStage) => {
      await callAdvanceLeadStage(lead.companyId, newStage)
    },
    [],
  )

  const handleMarkWon  = useCallback((lead: PipelineLead) => {
    setSelectedLead(lead)
    // Drawer will handle the Won flow via its action buttons
  }, [])

  const handleMarkLost = useCallback((lead: PipelineLead) => {
    setSelectedLead(lead)
  }, [])

  return (
    <div className="sdash-page">
      <header className="sdash-header">
        <h1 className="sdash-title">Pipeline</h1>
        <button className="sdash-view-toggle" onClick={goToList}>List View ↗</button>
      </header>

      {leadsLoading ? (
        <div className="sdash-loading">
          <span className="layout-loading__spinner" />
        </div>
      ) : (
        <div className="sdash-layout">
          <section className="sdash-board-pane">
            <PipelineBoard
              leads={leads}
              repNames={repNames}
              filters={filters}
              onFilterChange={setFilters}
              onCardClick={setSelectedLead}
              onStageChange={handleStageChange}
              onMarkWon={handleMarkWon}
              onMarkLost={handleMarkLost}
            />
          </section>

          <TodayFocus
            overdue={overdue}
            newSignups={newSignups}
            stalled={stalled}
            repNames={repNames}
            onCardClick={setSelectedLead}
            loading={loadOverdue || loadSignups || loadStalled}
          />
        </div>
      )}

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          repNames={repNames}
          onClose={() => setSelectedLead(null)}
          onUpdated={() => { setSelectedLead(null); refreshFocus() }}
        />
      )}
    </div>
  )
}

export default SalesDashboard
