import React from 'react'
import type { DailyKpi } from '../hooks/useKpi'

interface Props {
  kpi: DailyKpi
}

const STATS = [
  { key: 'posts', label: 'Posts', color: '#1d9bf0' },
  { key: 'likes', label: 'Likes', color: '#f91880' },
  { key: 'replies', label: 'Replies', color: '#22c55e' },
  { key: 'follows', label: 'Follows', color: '#ff5722' },
  { key: 'followChecks', label: 'Follow Checks', color: '#a855f7' },
] as const

export default function KpiPage({ kpi }: Props) {
  return (
    <div style={{ padding: '16px 14px', flex: 1 }}>
      <p style={{ fontSize: 11, color: '#999', marginBottom: 14 }}>
        Daily Activity Stats &middot; {kpi.date || new Date().toISOString().slice(0, 10)}
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        {STATS.map((s) => {
          const value = kpi[s.key] || 0
          return (
            <div key={s.key} style={{
              padding: '14px 12px', borderRadius: 8,
              background: '#fff', border: '1px solid #e8e8ec',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <span style={{
                fontSize: 28, fontWeight: 700, color: s.color,
                fontFamily: 'monospace', lineHeight: 1,
              }}>
                {value}
              </span>
              <span style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Total */}
      <div style={{
        marginTop: 14, padding: '12px',
        background: 'rgba(255,87,34,0.05)', borderRadius: 8,
        border: '1px solid rgba(255,87,34,0.12)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: '#666' }}>Total Today</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#ff5722', fontFamily: 'monospace' }}>
          {Object.values(kpi).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)}
        </span>
      </div>
    </div>
  )
}
