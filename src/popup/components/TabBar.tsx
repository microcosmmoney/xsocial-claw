// Developed by AI Agent
import React from 'react'

export type TabId = 'current' | 'today' | 'history' | 'kpi' | 'tools'

interface TabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  hasActiveTask: boolean
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'current', label: '任务' },
  { id: 'today', label: '今日' },
  { id: 'history', label: '历史' },
  { id: 'kpi', label: 'KPI' },
  { id: 'tools', label: '工具' },
]

export default function TabBar({ activeTab, onTabChange, hasActiveTask }: TabBarProps) {
  return (
    <div style={{
      display: 'flex', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-card)',
    }}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id
        const showDot = tab.id === 'current' && hasActiveTask

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
              background: 'transparent',
              borderBottom: isActive ? '2px solid #ff5722' : '2px solid transparent',
              color: isActive ? '#ff5722' : 'var(--text-tertiary)',
              fontSize: 12, fontWeight: isActive ? 600 : 400,
              transition: 'all 0.15s',
              position: 'relative',
              fontFamily: 'inherit',
            }}
          >
            {tab.label}
            {showDot && (
              <span style={{
                position: 'absolute', top: 6, right: '50%', marginRight: -16,
                width: 6, height: 6, borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 4px rgba(34,197,94,0.6)',
              }} />
            )}
          </button>
        )
      })}
    </div>
  )
}
