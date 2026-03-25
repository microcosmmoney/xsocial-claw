// Developed by AI Agent
import React, { useState, useEffect } from 'react'
import type { FollowMode, FollowSessionState, FollowAutoConfig } from '@shared/types'

const MODES: { id: FollowMode; label: string; desc: string }[] = [
  { id: 'homepage', label: '首页滚动', desc: '滚动首页，关注蓝V帖发帖者' },
  { id: 'detail', label: '详情页深入', desc: '进入高回帖蓝V帖，从底部向上关注' },
  { id: 'mixed', label: '随机混合', desc: '随机切换首页/详情页 (推荐)' },
]

export default function FollowTool() {
  const [state, setState] = useState<FollowSessionState | null>(null)
  const [config, setConfig] = useState<FollowAutoConfig | null>(null)
  const [loading, setLoading] = useState(true)

  
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'FOLLOW_AUTO_GET_STATE' })
        if (res?.success && res.data) {
          setState(res.data.state)
          setConfig(res.data.config)
        }
      } catch {  }
      setLoading(false)
    }
    fetch_()
    const timer = setInterval(fetch_, 2000)
    return () => clearInterval(timer)
  }, [])

  const handleStart = async () => {
    if (!config) return
    await chrome.runtime.sendMessage({
      type: 'FOLLOW_AUTO_START',
      payload: { config },
    })
  }

  const handlePause = async () => {
    await chrome.runtime.sendMessage({ type: 'FOLLOW_AUTO_PAUSE' })
  }

  const handleModeChange = async (mode: FollowMode) => {
    const res = await chrome.runtime.sendMessage({
      type: 'FOLLOW_AUTO_UPDATE_CONFIG',
      payload: { mode },
    })
    if (res?.success) setConfig(res.data)
  }

  const handleConfigChange = async (key: string, value: number) => {
    const res = await chrome.runtime.sendMessage({
      type: 'FOLLOW_AUTO_UPDATE_CONFIG',
      payload: { [key]: value },
    })
    if (res?.success) setConfig(res.data)
  }

  if (loading || !state || !config) {
    return (
      <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        加载中...
      </div>
    )
  }

  const isActive = state.status === 'running' || state.status === 'waiting'
  const isRunning = state.status === 'running'

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
        关注自动化
      </h3>

      {}
      <div style={{
        padding: '12px', borderRadius: 10, marginBottom: 12,
        background: isRunning ? 'rgba(34,197,94,0.06)' : 'var(--bg-primary)',
        border: `1px solid ${isRunning ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 10,
            background: statusColor(state.status).bg,
            color: statusColor(state.status).text,
            fontWeight: 600,
          }}>
            {statusLabel(state.status)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {state.todayDate}
          </span>
        </div>

        {}
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>
            <span>今日进度</span>
            <span>{state.dailyFollowed} / {state.dailyTarget}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: '#ff5722',
              width: `${Math.min(100, (state.dailyFollowed / state.dailyTarget) * 100)}%`,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {}
        {isRunning && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>
              <span>本轮会话</span>
              <span>{state.sessionFollowed} / {state.sessionTarget}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--border)' }}>
              <div style={{
                height: '100%', borderRadius: 3, background: '#22c55e',
                width: `${Math.min(100, (state.sessionFollowed / state.sessionTarget) * 100)}%`,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}

        {}
        {state.currentPhase && (
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            {state.currentPhase}
          </p>
        )}

        {}
        {state.nextSessionTime && state.status === 'waiting' && (
          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
            下一轮: {new Date(state.nextSessionTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
          关注模式
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              disabled={isActive}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 8, textAlign: 'left',
                border: `1px solid ${config.mode === m.id ? '#ff5722' : 'var(--border)'}`,
                background: config.mode === m.id ? 'rgba(255,87,34,0.06)' : 'transparent',
                cursor: isActive ? 'not-allowed' : 'pointer',
                opacity: isActive ? 0.6 : 1,
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 14, height: 14, borderRadius: '50%',
                border: `2px solid ${config.mode === m.id ? '#ff5722' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {config.mode === m.id && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5722' }} />
                )}
              </span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{m.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {}
      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 8 }}>
          高级配置
        </summary>
        <div style={{
          padding: '10px', borderRadius: 8,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <ConfigSlider
            label="每轮关注数" value={config.sessionLimit}
            min={4} max={20} step={2}
            onChange={(v) => handleConfigChange('sessionLimit', v)}
            disabled={isActive}
          />
          <ConfigSlider
            label="每日上限" value={config.dailyLimit}
            min={50} max={400} step={50}
            onChange={(v) => handleConfigChange('dailyLimit', v)}
            disabled={isActive}
          />
          <ConfigSlider
            label="详情页最低回帖" value={config.detailMinReplies}
            min={5} max={50} step={5}
            onChange={(v) => handleConfigChange('detailMinReplies', v)}
            disabled={isActive}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
            <span>活跃时段</span>
            <input
              type="number" min={0} max={23} value={config.activeHoursStart}
              disabled={isActive}
              onChange={(e) => handleConfigChange('activeHoursStart', Number(e.target.value))}
              style={{
                width: 44, padding: '3px 6px', borderRadius: 4, textAlign: 'center',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: 11,
              }}
            />
            <span>~</span>
            <input
              type="number" min={1} max={24} value={config.activeHoursEnd}
              disabled={isActive}
              onChange={(e) => handleConfigChange('activeHoursEnd', Number(e.target.value))}
              style={{
                width: 44, padding: '3px 6px', borderRadius: 4, textAlign: 'center',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: 11,
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>时</span>
          </div>
        </div>
      </details>

      {}
      {isActive ? (
        <button
          onClick={handlePause}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: '#f59e0b', color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          暂停自动化
        </button>
      ) : (
        <button
          onClick={handleStart}
          disabled={state.status === 'completed'}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: state.status === 'completed' ? '#666' : '#ff5722', color: '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: state.status === 'completed' ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {state.status === 'completed' ? `今日已完成 (${state.dailyFollowed})` : '启动自动化'}
        </button>
      )}

      {}
      {state.log.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            最近操作
          </p>
          <div style={{
            maxHeight: 150, overflowY: 'auto', borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            {state.log.slice(0, 20).map((entry, i) => (
              <div key={i} style={{
                padding: '6px 10px', fontSize: 11,
                borderBottom: i < state.log.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ color: 'var(--text-primary)' }}>
                  <span style={{ color: entry.success ? '#22c55e' : '#ef4444', marginRight: 4 }}>
                    {entry.success ? '✓' : '✗'}
                  </span>
                  @{entry.handle}
                </span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                  {entry.source === 'detail' ? '详情' : '首页'}
                  {' · '}
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {}
      <div style={{
        marginTop: 12, padding: '10px 12px', borderRadius: 8,
        background: 'rgba(255,87,34,0.05)', border: '1px solid rgba(255,87,34,0.1)',
        fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6,
      }}>
        <strong>工作原理:</strong> 自动滚动 X 首页，识别含"蓝V"关键词的帖子并关注。
        每轮关注 {config.sessionLimit} 人，每日上限 {config.dailyLimit} 人。
        约每小时随机启动一轮 (非整点)，模拟真人操作节奏。
        遇到 403 风控会自动停止。
      </div>
    </div>
  )
}


function ConfigSlider({ label, value, min, max, step, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled: boolean
}) {
  return (
    <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: '#ff5722', fontWeight: 600 }}>{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', marginTop: 3 }}
      />
    </label>
  )
}

function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'running': return { bg: 'rgba(34,197,94,0.1)', text: '#22c55e' }
    case 'waiting': return { bg: 'rgba(29,155,240,0.1)', text: '#1d9bf0' }
    case 'paused': return { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b' }
    case 'completed': return { bg: 'rgba(168,85,247,0.1)', text: '#a855f7' }
    default: return { bg: 'rgba(128,128,128,0.1)', text: '#888' }
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return '运行中'
    case 'waiting': return '等待下一轮'
    case 'paused': return '已暂停'
    case 'completed': return '今日完成'
    default: return '未启动'
  }
}
