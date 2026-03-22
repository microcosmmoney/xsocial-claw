import React, { useState, useEffect } from 'react'
import type { LikeAutoState, LikeAutoConfig } from '@shared/types'

export default function LikeTool() {
  const [state, setState] = useState<LikeAutoState | null>(null)
  const [config, setConfig] = useState<LikeAutoConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'LIKE_AUTO_GET_STATE' })
        if (res?.success && res.data) {
          setState(res.data.state)
          setConfig(res.data.config)
        }
      } catch { /* ignore */ }
      setLoading(false)
    }
    fetch_()
    const timer = setInterval(fetch_, 3000)
    return () => clearInterval(timer)
  }, [])

  const handleToggle = async () => {
    if (!config) return
    const res = await chrome.runtime.sendMessage({
      type: 'LIKE_AUTO_TOGGLE',
      payload: { enabled: !config.enabled },
    })
    if (res?.success) {
      setState(res.data)
      setConfig(c => c ? { ...c, enabled: !c.enabled } : c)
    }
  }

  const handleConfigChange = async (key: string, value: number) => {
    const res = await chrome.runtime.sendMessage({
      type: 'LIKE_AUTO_UPDATE_CONFIG',
      payload: { [key]: value },
    })
    if (res?.success) {
      setState(res.data.state)
      setConfig(res.data.config)
    }
  }

  if (loading || !state || !config) {
    return <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>加载中...</div>
  }

  const progressPct = state.dailyLimit > 0 ? Math.min(100, (state.dailyCount / state.dailyLimit) * 100) : 0

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
        点赞伴随
      </h3>

      {/* 总开关 */}
      <div style={{
        padding: '14px', borderRadius: 10, marginBottom: 12,
        background: config.enabled ? 'rgba(249,24,128,0.06)' : 'var(--bg-primary)',
        border: `1px solid ${config.enabled ? 'rgba(249,24,128,0.2)' : 'var(--border)'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {config.enabled ? '已开启' : '已关闭'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {config.enabled
              ? `执行其他操作时随机点赞 (${Math.round(config.probability * 100)}% 概率)`
              : '开启后在关注/浏览时随机附带点赞'
            }
          </div>
        </div>
        <button
          onClick={handleToggle}
          style={{
            width: 48, height: 26, borderRadius: 13, border: 'none',
            background: config.enabled ? '#f91880' : '#555',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: config.enabled ? 25 : 3,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>

      {/* 今日统计 */}
      <div style={{
        padding: '12px', borderRadius: 8, marginBottom: 12,
        background: 'var(--bg-primary)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <span>今日点赞</span>
          <span>
            <strong style={{ color: '#f91880', fontSize: 14 }}>{state.dailyCount}</strong>
            <span style={{ color: 'var(--text-tertiary)' }}> / {state.dailyLimit}</span>
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--border)' }}>
          <div style={{
            height: '100%', borderRadius: 3, background: '#f91880',
            width: `${progressPct}%`, transition: 'width 0.3s',
          }} />
        </div>
        {state.lastLikedAt && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
            上次点赞: {new Date(state.lastLikedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        )}
      </div>

      {/* 参数配置 */}
      <div style={{
        padding: '12px', borderRadius: 8, marginBottom: 12,
        background: 'var(--bg-primary)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>每日上限</span>
            <span style={{ color: '#f91880', fontWeight: 600 }}>{config.dailyLimit}</span>
          </div>
          <input type="range" min={10} max={100} step={10} value={config.dailyLimit}
            onChange={(e) => handleConfigChange('dailyLimit', Number(e.target.value))}
            style={{ width: '100%', marginTop: 3 }} />
        </label>

        <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>伴随概率</span>
            <span style={{ color: '#f91880', fontWeight: 600 }}>{Math.round(config.probability * 100)}%</span>
          </div>
          <input type="range" min={0.1} max={0.8} step={0.1} value={config.probability}
            onChange={(e) => handleConfigChange('probability', Number(e.target.value))}
            style={{ width: '100%', marginTop: 3 }} />
        </label>

        <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>最小间隔</span>
            <span style={{ color: '#f91880', fontWeight: 600 }}>{config.minGapSec}秒</span>
          </div>
          <input type="range" min={15} max={120} step={15} value={config.minGapSec}
            onChange={(e) => handleConfigChange('minGapSec', Number(e.target.value))}
            style={{ width: '100%', marginTop: 3 }} />
        </label>
      </div>

      {/* 说明 */}
      <div style={{
        padding: '10px 12px', borderRadius: 8,
        background: 'rgba(249,24,128,0.05)', border: '1px solid rgba(249,24,128,0.1)',
        fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6,
      }}>
        <strong>工作原理:</strong> 这不是独立的点赞任务，而是在执行关注、浏览等操作时，
        以 {Math.round(config.probability * 100)}% 的概率随机对当前可见推文点赞。
        每日上限 {config.dailyLimit} 个，两次点赞至少间隔 {config.minGapSec} 秒。
        Twitter 未公开点赞限制，但自动化点赞是封号主因之一，请保持保守设置。
      </div>
    </div>
  )
}
