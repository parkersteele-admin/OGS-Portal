/**
 * src/components/sales/PipelineBoard.tsx
 *
 * Kanban-style board showing one column per active PipelineStage.
 * Uses @dnd-kit/core for drag-and-drop between columns.
 * Won / Lost drop targets appear as footer zones below the columns.
 */

import React, { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { toast } from '../../utils/toast'
import { LeadCard } from './LeadCard'
import { applyFilters } from '../../services/pipelineService'
import type { PipelineLead, PipelineStage, PipelineFilters } from '../../types/pipeline'
import { BOARD_STAGES, STAGE_LABELS } from '../../types/pipeline'
import './PipelineBoard.css'

// ── Droppable column ──────────────────────────────────────────────────────────

function BoardColumn({
  stage,
  leads,
  repNames,
  onCardClick,
}: {
  stage: PipelineStage
  leads: PipelineLead[]
  repNames: Record<string, string>
  onCardClick: (lead: PipelineLead) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const totalEmv = leads.reduce((s, l) => s + (l.estimatedMonthlyValue ?? 0), 0)
  const ids = leads.map((l) => l.id)

  return (
    <div ref={setNodeRef} className={`pb-col${isOver ? ' pb-col--over' : ''}`}>
      <header className="pb-col__header">
        <span className="pb-col__label">{STAGE_LABELS[stage]}</span>
        <span className="pb-col__count">{leads.length}</span>
        {totalEmv > 0 && (
          <span className="pb-col__emv" title="Total estimated monthly value">
            ${totalEmv.toLocaleString()}
          </span>
        )}
      </header>

      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="pb-col__cards">
          {leads.length === 0
            ? <p className="pb-col__empty">No leads</p>
            : leads.map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  repNames={repNames}
                  onClick={onCardClick}
                />
              ))
          }
        </div>
      </SortableContext>
    </div>
  )
}

// ── Terminal drop zones ───────────────────────────────────────────────────────

function TerminalZone({
  stage,
  label,
  variant,
}: {
  stage: 'won' | 'lost'
  label: string
  variant: 'won' | 'lost'
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <div ref={setNodeRef} className={`pb-terminal pb-terminal--${variant}${isOver ? ' pb-terminal--over' : ''}`}>
      {label}
    </div>
  )
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  repNames,
}: {
  filters: PipelineFilters
  onChange: (f: PipelineFilters) => void
  repNames: Record<string, string>
}) {
  const toggleUnassigned = () =>
    onChange({ ...filters, unassignedOnly: !filters.unassignedOnly })
  const clearAll = () =>
    onChange({ assignedTo: [], businessType: [], priority: [], unassignedOnly: false })

  const hasFilters =
    filters.unassignedOnly ||
    filters.assignedTo.length > 0 ||
    filters.businessType.length > 0 ||
    filters.priority.length > 0

  return (
    <div className="pb-filters">
      {Object.keys(repNames).length > 0 && (
        <select
          className="pb-filters__select"
          value=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            const next = filters.assignedTo.includes(v)
              ? filters.assignedTo.filter((r) => r !== v)
              : [...filters.assignedTo, v]
            onChange({ ...filters, assignedTo: next })
          }}
        >
          <option value="">Rep {filters.assignedTo.length > 0 ? `(${filters.assignedTo.length})` : ''}</option>
          {Object.entries(repNames).map(([uid, name]) => (
            <option key={uid} value={uid}>{name}</option>
          ))}
        </select>
      )}

      {(['high', 'normal', 'low'] as const).map((p) => (
        <button
          key={p}
          className={`pb-filters__chip pb-filters__chip--${p}${filters.priority.includes(p) ? ' pb-filters__chip--on' : ''}`}
          onClick={() => {
            const next = filters.priority.includes(p)
              ? filters.priority.filter((x) => x !== p)
              : [...filters.priority, p]
            onChange({ ...filters, priority: next })
          }}
        >
          {p.charAt(0).toUpperCase() + p.slice(1)}
        </button>
      ))}

      <button
        className={`pb-filters__chip${filters.unassignedOnly ? ' pb-filters__chip--on' : ''}`}
        onClick={toggleUnassigned}
      >
        Unassigned
      </button>

      {hasFilters && (
        <button className="pb-filters__clear" onClick={clearAll}>
          Clear filters
        </button>
      )}
    </div>
  )
}

// ── PipelineBoard ─────────────────────────────────────────────────────────────

interface PipelineBoardProps {
  leads:       PipelineLead[]
  repNames:    Record<string, string>
  filters:     PipelineFilters
  onFilterChange: (f: PipelineFilters) => void
  onCardClick: (lead: PipelineLead) => void
  onStageChange: (lead: PipelineLead, newStage: PipelineStage) => Promise<void>
  onMarkWon:   (lead: PipelineLead) => void
  onMarkLost:  (lead: PipelineLead) => void
}

export const PipelineBoard: React.FC<PipelineBoardProps> = ({
  leads,
  repNames,
  filters,
  onFilterChange,
  onCardClick,
  onStageChange,
  onMarkWon,
  onMarkLost,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters])

  const byStage = useMemo(() => {
    const map: Record<string, PipelineLead[]> = {}
    for (const s of BOARD_STAGES) map[s] = []
    for (const l of filtered) {
      if (map[l.stage]) map[l.stage].push(l)
    }
    return map
  }, [filtered])

  const activeLead = useMemo(
    () => leads.find((l) => l.id === activeId) ?? null,
    [leads, activeId],
  )

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveId(null)
      const overId = e.over?.id as string | undefined
      if (!overId || !activeId) return

      const lead = leads.find((l) => l.id === activeId)
      if (!lead) return

      // Dropped on same stage
      if (overId === lead.stage) return

      // Terminal zones
      if (overId === 'won') { onMarkWon(lead);  return }
      if (overId === 'lost') { onMarkLost(lead); return }

      const newStage = overId as PipelineStage
      if (!BOARD_STAGES.includes(newStage) && newStage !== 'won' && newStage !== 'lost') {
        // Over a card in a column — infer column from stage
        const targetLead = leads.find((l) => l.id === overId)
        if (!targetLead || targetLead.stage === lead.stage) return
        try {
          await onStageChange(lead, targetLead.stage)
        } catch {
          toast.error('Could not move lead — stage transition failed.')
        }
        return
      }

      try {
        await onStageChange(lead, newStage)
      } catch {
        toast.error('Could not move lead — stage transition failed.')
      }
    },
    [activeId, leads, onMarkWon, onMarkLost, onStageChange],
  )

  return (
    <div className="pb-wrap">
      <FilterBar filters={filters} onChange={onFilterChange} repNames={repNames} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="pb-board">
          {BOARD_STAGES.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              leads={byStage[stage] ?? []}
              repNames={repNames}
              onCardClick={onCardClick}
            />
          ))}
        </div>

        <div className="pb-terminals">
          <TerminalZone stage="won"  label="✓ Mark as Won"  variant="won" />
          <TerminalZone stage="lost" label="✗ Mark as Lost" variant="lost" />
        </div>

        <DragOverlay>
          {activeLead && (
            <LeadCard
              lead={activeLead}
              repNames={repNames}
              onClick={() => undefined}
              isDragging
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
