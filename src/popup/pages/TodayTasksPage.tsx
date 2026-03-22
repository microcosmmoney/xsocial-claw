import React from 'react'
import type { CurrentTask } from '../hooks/useCurrentTask'

interface Props {
  tasks: CurrentTask[]
}

export default function TodayTasksPage({ tasks }: Props) {
  if (tasks.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 40, color: '#aaa',
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>&#128203;</div>
        <p style={{ fontSize: 13 }}>今日暂无完成的任务</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>
      <p style={{ fontSize: 11, color: '#999', marginBottom: 10 }}>
        今日已完成 {tasks.length} 个任务
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map((t, i) => {
          const time = t.completedAt ? new Date(t.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 6,
              background: '#fff', border: '1px solid #e8e8ec',
            }}>
              <span style={{ color: t.status === 'completed' ? '#22c55e' : '#ef4444', fontSize: 14 }}>
                {t.status === 'completed' ? '\u2713' : '\u2717'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#1a1a2e' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {t.taskType} &middot; {t.steps?.length || 0} 步骤
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace' }}>{time}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
