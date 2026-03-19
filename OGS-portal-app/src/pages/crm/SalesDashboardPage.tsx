import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import {
  buildSalesDashboardData,
  fetchSalesDashboardSnapshot,
  getSalesDashboardPresetRange,
  type SalesDashboardPreset,
} from '../../services/salesDashboardService'
import { formatCurrency, formatDate } from '../../utils/format'
import './SalesDashboardPage.css'

type PresetOption = {
  value: SalesDashboardPreset
  label: string
}

const PRESET_OPTIONS: PresetOption[] = [
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'qtd', label: 'Quarter to date' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'custom', label: 'Custom range' },
]

const INITIAL_RANGE = getSalesDashboardPresetRange('last30')

const KPI_META = {
  wonRevenue: 'Accepted quote value in range',
  openPipeline: 'Current estimated open pipeline',
  quotesSent: 'Non-draft quotes in range',
  winRate: 'Won quotes / non-draft quotes',
  averageDealSize: 'Average accepted quote value',
  newLeads: 'Leads created in range',
} as const

const SalesDashboardPage: React.FC = () => {
  const [preset, setPreset] = useState<SalesDashboardPreset>('last30')
  const [startDate, setStartDate] = useState(INITIAL_RANGE.startDate)
  const [endDate, setEndDate] = useState(INITIAL_RANGE.endDate)
  const [salesRepId, setSalesRepId] = useState('')
  const [stage, setStage] = useState<'all' | 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'>('all')
  const [company, setCompany] = useState('')

  const dashboardQuery = useQuery({
    queryKey: ['crm', 'sales-dashboard'],
    queryFn: fetchSalesDashboardSnapshot,
  })

  const dashboard = useMemo(() => {
    if (!dashboardQuery.data) return null
    return buildSalesDashboardData(dashboardQuery.data, {
      preset,
      startDate,
      endDate,
      salesRepId,
      stage,
      company,
    })
  }, [company, dashboardQuery.data, endDate, preset, salesRepId, stage, startDate])

  const applyPreset = (nextPreset: SalesDashboardPreset) => {
    setPreset(nextPreset)
    if (nextPreset === 'custom') return
    const range = getSalesDashboardPresetRange(nextPreset)
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }

  if (dashboardQuery.isLoading) {
    return (
      <div className="sdash-page sdash-page--loading">
        <div className="layout-loading"><span className="layout-loading__spinner" /></div>
      </div>
    )
  }

  if (dashboardQuery.error || !dashboard) {
    return (
      <div className="sdash-page">
        <Card className="sdash-empty">
          <h1 className="sdash-empty__title">Sales dashboard unavailable</h1>
          <p className="sdash-empty__copy">
            The CRM data needed for the internal sales dashboard could not be loaded.
          </p>
        </Card>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Won Revenue', value: formatCurrency(dashboard.kpis.wonRevenue), meta: KPI_META.wonRevenue },
    { label: 'Open Pipeline', value: formatCurrency(dashboard.kpis.openPipeline), meta: KPI_META.openPipeline },
    { label: 'Quotes Sent', value: String(dashboard.kpis.quotesSent), meta: KPI_META.quotesSent },
    { label: 'Win Rate', value: `${Math.round(dashboard.kpis.winRate * 100)}%`, meta: KPI_META.winRate },
    { label: 'Average Deal Size', value: formatCurrency(dashboard.kpis.averageDealSize), meta: KPI_META.averageDealSize },
    { label: 'New Leads', value: String(dashboard.kpis.newLeads), meta: KPI_META.newLeads },
  ]

  return (
    <div className="sdash-page">
      <section className="sdash-hero">
        <div>
          <p className="sdash-hero__eyebrow">Revenue Operations</p>
          <h1 className="sdash-hero__title">Sales Dashboard</h1>
          <p className="sdash-hero__copy">
            Internal performance view for pipeline health, wins, and rep execution across the CRM.
          </p>
        </div>
        <div className="sdash-hero__meta">
          <Badge variant="brand">Admin + Sales</Badge>
          <span className="sdash-hero__date">Updated from live CRM data</span>
        </div>
      </section>

      <Card className="sdash-filterbar">
        <div className="sdash-filterbar__top">
          <div>
            <p className="sdash-section__eyebrow">Global filters</p>
            <h2 className="sdash-section__title">Performance window</h2>
          </div>
          <div className="sdash-presets">
            {PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`sdash-preset${preset === option.value ? ' sdash-preset--active' : ''}`}
                onClick={() => applyPreset(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sdash-filtergrid">
          <label className="sdash-field">
            <span className="sdash-field__label">Start date</span>
            <input
              type="date"
              className="sdash-field__control"
              value={startDate}
              onChange={(event) => {
                setPreset('custom')
                setStartDate(event.target.value)
              }}
            />
          </label>

          <label className="sdash-field">
            <span className="sdash-field__label">End date</span>
            <input
              type="date"
              className="sdash-field__control"
              value={endDate}
              onChange={(event) => {
                setPreset('custom')
                setEndDate(event.target.value)
              }}
            />
          </label>

          <label className="sdash-field">
            <span className="sdash-field__label">Sales rep</span>
            <select
              className="sdash-field__control"
              value={salesRepId}
              onChange={(event) => setSalesRepId(event.target.value)}
            >
              <option value="">All reps</option>
              {dashboard.options.salesReps.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="sdash-field">
            <span className="sdash-field__label">Pipeline stage</span>
            <select
              className="sdash-field__control"
              value={stage}
              onChange={(event) => setStage(event.target.value as typeof stage)}
            >
              <option value="all">All stages</option>
              {dashboard.options.stages.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="sdash-field">
            <span className="sdash-field__label">Company / customer</span>
            <select
              className="sdash-field__control"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            >
              <option value="">All accounts</option>
              {dashboard.options.companies.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <section className="sdash-kpis">
        {kpiCards.map((card) => (
          <Card key={card.label} className="sdash-kpi">
            <p className="sdash-kpi__label">{card.label}</p>
            <p className="sdash-kpi__value">{card.value}</p>
            <p className="sdash-kpi__meta">{card.meta}</p>
          </Card>
        ))}
      </section>

      <section className="sdash-chartgrid">
        <Card className="sdash-panel sdash-panel--wide">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Trend</p>
              <h2 className="sdash-section__title">Revenue over time</h2>
            </div>
            <Badge variant="neutral">Accepted quotes</Badge>
          </div>
          <LineChart data={dashboard.charts.revenueOverTime} money />
        </Card>

        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Conversion</p>
              <h2 className="sdash-section__title">Quotes sent vs won</h2>
            </div>
            <Badge variant="neutral">Sent uses non-draft proxy</Badge>
          </div>
          <CompareBars data={dashboard.charts.quotesSentVsWon} />
        </Card>

        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Pipeline</p>
              <h2 className="sdash-section__title">Pipeline by stage</h2>
            </div>
            <Badge variant="neutral">Current open opportunities</Badge>
          </div>
          <PipelineBars data={dashboard.charts.pipelineByStage} />
        </Card>
      </section>

      <section className="sdash-leaderboards">
        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Leaderboard</p>
              <h2 className="sdash-section__title">Top sales reps</h2>
            </div>
          </div>
          <div className="sdash-table">
            <div className="sdash-table__head">
              <span>Rep</span>
              <span>Won revenue</span>
              <span>Quotes sent</span>
              <span>Win rate</span>
            </div>
            {dashboard.leaderboards.reps.length === 0 && (
              <p className="sdash-table__empty">No rep performance matched the current filters.</p>
            )}
            {dashboard.leaderboards.reps.map((rep) => (
              <div key={rep.repId} className="sdash-table__row">
                <span>{rep.repName}</span>
                <span>{formatCurrency(rep.wonRevenue)}</span>
                <span>{rep.quotesSent}</span>
                <span>{Math.round(rep.winRate * 100)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Leaderboard</p>
              <h2 className="sdash-section__title">Top companies / customers</h2>
            </div>
          </div>
          <div className="sdash-table">
            <div className="sdash-table__head">
              <span>Account</span>
              <span>Total quoted</span>
              <span>Total won</span>
              <span>Last activity</span>
            </div>
            {dashboard.leaderboards.companies.length === 0 && (
              <p className="sdash-table__empty">No account activity matched the current filters.</p>
            )}
            {dashboard.leaderboards.companies.map((entry) => (
              <div key={entry.company} className="sdash-table__row">
                <span>{entry.company}</span>
                <span>{formatCurrency(entry.totalQuoted)}</span>
                <span>{formatCurrency(entry.totalWon)}</span>
                <span>{entry.lastActivity ? formatDate(entry.lastActivity) : 'No activity'}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="sdash-lowergrid">
        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <p className="sdash-section__eyebrow">Recent wins</p>
              <h2 className="sdash-section__title">Latest accepted quotes</h2>
            </div>
          </div>
          <div className="sdash-recentwins">
            {dashboard.recentWins.length === 0 && (
              <p className="sdash-table__empty">No won quotes landed in the selected range.</p>
            )}
            {dashboard.recentWins.map((win) => (
              <article key={win.quoteId} className="sdash-winrow">
                <div>
                  <p className="sdash-winrow__title">{win.company}</p>
                  <p className="sdash-winrow__meta">{win.quoteNumber} · {win.repName}</p>
                </div>
                <div className="sdash-winrow__value">
                  <strong>{formatCurrency(win.total)}</strong>
                  <span>{win.acceptedAt ? formatDate(win.acceptedAt) : 'Accepted'}</span>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card className="sdash-panel">
          <div className="sdash-panel__head">
            <div>
              <h2 className="sdash-section__title">Data Notes</h2>
            </div>
          </div>
          <div className="sdash-notes">
            {dashboard.dataNotes.map((note) => (
              <div key={note.title} className="sdash-note">
                <span className="sdash-note__dot" aria-hidden="true" />
                <div className="sdash-note__text">
                  <p className="sdash-note__title">{note.title}</p>
                  <p className="sdash-note__explanation">{note.explanation}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}

function LineChart({ data, money = false }: { data: Array<{ label: string; value: number }>; money?: boolean }) {
  const width = 720
  const height = 220
  const padding = 24
  const maxValue = Math.max(...data.map((point) => point.value), 1)
  const step = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0
  const points = data.map((point, index) => {
    const x = padding + index * step
    const y = height - padding - (point.value / maxValue) * (height - padding * 2)
    return { x, y, ...point }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`

  return (
    <div className="sdash-linechart">
      <svg viewBox={`0 0 ${width} ${height}`} className="sdash-linechart__svg" role="img" aria-label="Revenue over time chart">
        <defs>
          <linearGradient id="sdashRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(232, 119, 34, 0.26)" />
            <stop offset="100%" stopColor="rgba(232, 119, 34, 0)" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + ratio * (height - padding * 2)
          return <line key={ratio} x1={padding} x2={width - padding} y1={y} y2={y} className="sdash-linechart__grid" />
        })}
        <polygon points={area} fill="url(#sdashRevenue)" />
        <polyline points={line} className="sdash-linechart__stroke" />
        {points.map((point) => (
          <circle key={`${point.label}-${point.value}`} cx={point.x} cy={point.y} r="4" className="sdash-linechart__point" />
        ))}
      </svg>
      <div className="sdash-linechart__labels">
        {data.map((point) => (
          <div key={point.label} className="sdash-linechart__labelgroup">
            <span>{point.label}</span>
            <strong>{money ? formatCurrency(point.value) : point.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompareBars({ data }: { data: Array<{ label: string; sent: number; won: number }> }) {
  const maxValue = Math.max(...data.flatMap((entry) => [entry.sent, entry.won]), 1)

  return (
    <div className="sdash-compare">
      <div className="sdash-compare__legend">
        <span><i className="sdash-compare__swatch sdash-compare__swatch--sent" />Sent</span>
        <span><i className="sdash-compare__swatch sdash-compare__swatch--won" />Won</span>
      </div>
      <div className="sdash-compare__bars">
        {data.map((entry) => (
          <div key={entry.label} className="sdash-compare__group">
            <div className="sdash-compare__track">
              <span className="sdash-compare__bar sdash-compare__bar--sent" style={{ height: `${(entry.sent / maxValue) * 100}%` }} />
              <span className="sdash-compare__bar sdash-compare__bar--won" style={{ height: `${(entry.won / maxValue) * 100}%` }} />
            </div>
            <div className="sdash-compare__meta">
              <strong>{entry.label}</strong>
              <span>{entry.sent} / {entry.won}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineBars({ data }: { data: Array<{ label: string; count: number; value: number }> }) {
  const maxValue = Math.max(...data.map((entry) => entry.value), 1)

  return (
    <div className="sdash-pipeline">
      {data.length === 0 && <p className="sdash-table__empty">No active pipeline stages matched the current filters.</p>}
      {data.map((entry) => (
        <div key={entry.label} className="sdash-pipeline__row">
          <div className="sdash-pipeline__copy">
            <strong>{entry.label}</strong>
            <span>{entry.count} opportunities</span>
          </div>
          <div className="sdash-pipeline__track">
            <span className="sdash-pipeline__fill" style={{ width: `${(entry.value / maxValue) * 100}%` }} />
          </div>
          <strong className="sdash-pipeline__value">{formatCurrency(entry.value)}</strong>
        </div>
      ))}
    </div>
  )
}

export default SalesDashboardPage