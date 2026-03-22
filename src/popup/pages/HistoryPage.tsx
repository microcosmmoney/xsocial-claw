import React, { useState } from 'react'
import type { CurrentTask } from '../hooks/useCurrentTask'

interface Props {
  history: CurrentTask[]
}

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <span style={{ color: '#22c55e', fontSize: 12 }}>&#10003;</span>
  if (status === 'failed') return <span style={{ color: '#ef4444', fontSize: 12 }}>&#10007;</span>
  return <span style={{ color: '#d1d5db', fontSize: 12 }}>&#8212;</span>
}

function TaskCard({ task }: { task: CurrentTask }) {
  const [expanded, setExpanded] = useState(false)
  const time = task.completedAt
    ? new Date(task.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''
  const durationMs = (task.completedAt || 0) - (task.startedAt || 0)
  const durationSec = Math.max(0, Math.floor(durationMs / 1000))
  const stepsDone = task.steps?.filter(s => s.status === 'completed').length || 0
  const stepsTotal = task.steps?.length || 0

  return (
    <div style={{
      background: '#fff', borderRadius: 8, border: '1px solid #e8e8ec',
      overflow: 'hidden', marginBottom: 6,
    }}>
      {/* 摘要行（点击展开） */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', cursor: 'pointer',
        }}
      >
        <span style={{
          color: task.status === 'completed' ? '#22c55e' : '#ef4444',
          fontSize: 14, flexShrink: 0,
        }}>
          {task.status === 'completed' ? '✓' : '✗'}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, color: '#ff5722',
              background: 'rgba(255,87,34,0.08)', padding: '1px 6px', borderRadius: 3,
            }}>
              {task.taskType}
            </span>
            <span style={{ fontSize: 12, color: '#333', fontWeight: 500 }}>
              {task.title}
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>
            {stepsDone}/{stepsTotal} 步 · {durationSec}s
          </div>
        </div>

        <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', flexShrink: 0 }}>
          {time}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="#ccc" strokeWidth="2" strokeLinecap="round"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid #f0f0f3' }}>
          {/* 步骤列表 */}
          {task.steps && task.steps.length > 0 && (
            <div style={{ paddingTop: 8 }}>
              {task.steps.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 0', fontSize: 11, color: '#888',
                }}>
                  <StepIcon status={step.status} />
                  <span>{step.description || step.action}</span>
                </div>
              ))}
            </div>
          )}

          {/* AI 汇总 */}
          {task.summary && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 6,
              background: '#f8f9fa', border: '1px solid #e8e8ec',
              fontSize: 12, color: '#333', lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#ff5722' }}>🤖 汇总</span>
              <div style={{ marginTop: 4 }}>{task.summary}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function HistoryPage({ history }: Props) {
  if (history.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 40, color: '#aaa',
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>&#128218;</div>
        <p style={{ fontSize: 13 }}>暂无历史记录</p>
      </div>
    )
  }

  // 按日期分组
  const groups: Record<string, CurrentTask[]> = {}
  for (const t of history) {
    const date = t.completedAt
      ? new Date(t.completedAt).toISOString().slice(0, 10)
      : 'unknown'
    if (!groups[date]) groups[date] = []
    groups[date].push(t)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>
      {Object.entries(groups).map(([date, tasks]) => (
        <div key={date} style={{ marginBottom: 16 }}>
          <p style={{
            fontSize: 11, color: '#888', fontWeight: 600,
            marginBottom: 6, paddingBottom: 4,
          }}>
            {date === today ? '今天' : date}
            <span style={{ marginLeft: 8, color: '#bbb', fontWeight: 400 }}>
              {tasks.length} 个任务
            </span>
          </p>
          {tasks.map((t, i) => (
            <TaskCard key={i} task={t} />
          ))}
        </div>
      ))}
    </div>
  )
}
