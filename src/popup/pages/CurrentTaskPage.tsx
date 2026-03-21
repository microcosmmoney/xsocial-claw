import React from 'react'
import type { CurrentTask } from '../hooks/useCurrentTask'

interface Props {
  task: CurrentTask | null
  hasXAccount?: boolean
}

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') return <span style={{ color: '#22c55e', fontSize: 14 }}>&#10003;</span>
  if (status === 'running') return (
    <span className="animate-spin" style={{
      display: 'inline-block', width: 12, height: 12,
      border: '2px solid #ddd', borderTopColor: '#ff5722', borderRadius: '50%',
    }} />
  )
  if (status === 'failed') return <span style={{ color: '#ef4444', fontSize: 14 }}>&#10007;</span>
  if (status === 'skipped') return <span style={{ color: '#d1d5db', fontSize: 14 }}>&#8212;</span>
  return <span style={{ color: '#d1d5db', fontSize: 14 }}>&#9675;</span>
}

function StepRow({ step }: { step: { action: string; description: string; status: string } }) {
  const isActive = step.status === 'running'
  const isDone = step.status === 'completed'
  const isFailed = step.status === 'failed'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 10px', borderRadius: 6,
      background: isActive ? 'rgba(255,87,34,0.05)' : 'transparent',
      border: isActive ? '1px solid rgba(255,87,34,0.15)' : '1px solid transparent',
    }}>
      <StepIcon status={step.status} />
      <span style={{
        flex: 1, fontSize: 12,
        color: isDone ? '#888' : isFailed ? '#ef4444' : isActive ? '#1a1a2e' : '#bbb',
        fontWeight: isActive ? 500 : 400,
      }}>
        {step.description || step.action}
      </span>
    </div>
  )
}

export default function CurrentTaskPage({ task, hasXAccount }: Props) {
  // No task
  if (!task) {
    if (!hasXAccount) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 20px', color: '#555',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>🔗</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', marginBottom: 8 }}>Please bind your X account first</p>
          <div style={{
            textAlign: 'left', fontSize: 12, color: '#888', lineHeight: 1.8,
            background: '#fff', padding: '14px 16px', borderRadius: 10,
            border: '1px solid #e0e0e5', width: '100%', maxWidth: 280,
          }}>
            {['Sign in at xsocial.cc', 'Go to Production > My Accounts', 'Bind your X account to this node'].map((text, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < 2 ? 6 : 0 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  background: '#ff5722', color: '#fff', fontSize: 10, fontWeight: 600,
                }}>{i + 1}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 40, color: '#aaa',
      }}>
        <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>&#9201;</div>
        <p style={{ fontSize: 13 }}>Waiting for task assignment...</p>
        <p style={{ fontSize: 11, marginTop: 4, color: '#bbb' }}>Progress will appear here once a task starts</p>
      </div>
    )
  }

  // Has task (running or completed)
  const isCompleted = task.status === 'completed' || task.status === 'aborted'
  const elapsed = (task.completedAt || Date.now()) - task.startedAt
  const minutes = Math.floor(elapsed / 60000)
  const seconds = Math.floor((elapsed % 60000) / 1000)

  return (
    <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>
      {/* Task header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: '#ff5722',
            background: 'rgba(255,87,34,0.08)', padding: '2px 8px', borderRadius: 4,
          }}>
            {task.taskType}
          </span>
          {isCompleted && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: task.status === 'completed' ? '#22c55e' : '#ef4444',
              background: task.status === 'completed' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              padding: '2px 6px', borderRadius: 4,
            }}>
              {task.status === 'completed' ? 'Completed' : 'Aborted'}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>
          {minutes}:{String(seconds).padStart(2, '0')}
        </span>
      </div>

      {/* Step list — always visible */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 12 }}>
        {task.steps.map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </div>

      {/* AI Summary */}
      {task.summary && (
        <div style={{
          padding: '12px 14px', borderRadius: 10,
          background: '#fff', border: '1px solid #e0e0e5',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <p style={{
            fontSize: 12, fontWeight: 700, color: '#ff5722', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 14 }}>🤖</span> AI Browse Summary
          </p>
          <div style={{
            fontSize: 13, color: '#333', lineHeight: 1.7,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {task.summary}
          </div>
        </div>
      )}

      {/* Clear completed task */}
      {isCompleted && (
        <button
          onClick={async () => {
            await chrome.storage.local.remove('current_task')
            window.location.reload()
          }}
          style={{
            marginTop: 12, width: '100%', padding: '8px', borderRadius: 6,
            border: '1px solid #e0e0e5', background: '#fff',
            fontSize: 12, color: '#888', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Clear Current Task
        </button>
      )}
    </div>
  )
}
