import React, { useState } from 'react'
import Header from './components/Header'
import UnboundView from './components/UnboundView'
import XProfileCard from './components/XProfileCard'
import TabBar, { type TabId } from './components/TabBar'
import CurrentTaskPage from './pages/CurrentTaskPage'
import TodayTasksPage from './pages/TodayTasksPage'
import HistoryPage from './pages/HistoryPage'
import KpiPage from './pages/KpiPage'
import ToolsPage from './pages/ToolsPage'
import { useNodeStatus } from './hooks/useNodeStatus'
import { useCurrentTask } from './hooks/useCurrentTask'
import { useTaskHistory } from './hooks/useTaskHistory'
import { useKpi } from './hooks/useKpi'
import { useTheme } from './hooks/useTheme'

export default function App() {
  const { status, loading } = useNodeStatus()
  const currentTask = useCurrentTask()
  const { history, todayTasks } = useTaskHistory()
  const kpi = useKpi()
  const { mode: themeMode, cycleTheme } = useTheme()
  const [activeTab, setActiveTab] = useState<TabId>('current')

  if (loading) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)', minHeight: '100vh',
      }}>
        <div className="animate-spin" style={{
          width: 24, height: 24, border: '3px solid #ddd',
          borderTopColor: '#ff5722', borderRadius: '50%',
        }} />
      </div>
    )
  }

  const isBound = status?.isBound || false
  const hasXUser = !!status?.xUser

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header
        nodeCode={status?.nodeCode || null}
        wsConnected={status?.wsConnected || false}
        isBound={isBound}
        themeMode={themeMode}
        onThemeToggle={cycleTheme}
      />

      {!isBound ? (
        <UnboundView
          nodeCode={status?.nodeCode || null}
          wsConnected={status?.wsConnected || false}
        />
      ) : (
        <>
          {hasXUser && (
            <XProfileCard
              xUser={status!.xUser!}
              nodeCode={status?.nodeCode || null}
            />
          )}

          <TabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            hasActiveTask={!!currentTask}
          />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {activeTab === 'current' && <CurrentTaskPage task={currentTask} hasXAccount={hasXUser} />}
            {activeTab === 'today' && <TodayTasksPage tasks={todayTasks} />}
            {activeTab === 'history' && <HistoryPage history={history} />}
            {activeTab === 'kpi' && <KpiPage kpi={kpi} />}
            {activeTab === 'tools' && <ToolsPage />}
          </div>

          {/* Footer */}
          <div style={{
            padding: '6px 14px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-card)',
          }}>
            <span>xSocial Agent v{chrome.runtime.getManifest().version}</span>
            <span>{status?.wsConnected ? 'WS Connected' : 'WS Disconnected'}</span>
          </div>
        </>
      )}
    </div>
  )
}
