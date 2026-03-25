// Developed by AI Agent
import React from 'react'
import type { ThemeMode } from '../hooks/useTheme'

interface HeaderProps {
  nodeCode: string | null
  wsConnected: boolean
  isBound: boolean
  themeMode: ThemeMode
  onThemeToggle: () => void
}


function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

export default function Header({ nodeCode, wsConnected, isBound, themeMode, onThemeToggle }: HeaderProps) {
  return (
    <div className="header-bar" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px',
      background: 'var(--bg-header)',
      borderBottom: '1px solid var(--border)',
    }}>
      {}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#ff5722' }}>xSocial</span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>Agent</span>
        {}
        <div
          className={wsConnected ? 'breathing-light-online' : 'breathing-light-offline'}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: wsConnected ? '#22c55e' : '#ef4444',
            marginLeft: 2,
          }}
        />
      </div>

      {}
      <button
        onClick={onThemeToggle}
        title={themeMode === 'light' ? '日间模式' : themeMode === 'dark' ? '夜间模式' : '跟随系统'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        <ThemeIcon mode={themeMode} />
      </button>
    </div>
  )
}
