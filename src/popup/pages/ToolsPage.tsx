import React, { useState, useEffect } from 'react'
import PostTool from '../components/tools/PostTool'

type View = 'dashboard' | 'post'

export default function ToolsPage() {
  const [view, setView] = useState<View>('dashboard')
  const [followState, setFollowState] = useState<any>(null)
  const [likeState, setLikeState] = useState<any>(null)
  const [unfollowState, setUnfollowState] = useState<any>(null)
  const [modelState, setModelState] = useState<any>(null)

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const [f, l, u, m] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'FOLLOW_AUTO_GET_STATE' }),
          chrome.runtime.sendMessage({ type: 'LIKE_AUTO_GET_STATE' }),
          chrome.runtime.sendMessage({ type: 'TOOL_GET_UNFOLLOW_PROGRESS' }),
          chrome.runtime.sendMessage({ type: 'MODEL_GET_STATE' }),
        ])
        if (f?.success) setFollowState(f.data?.state)
        if (l?.success) setLikeState(l.data)
        if (u?.success) setUnfollowState(u.data)
        if (m?.success) setModelState(m.data?.state)
      } catch { /* ignore */ }
    }
    fetch_()
    const timer = setInterval(fetch_, 3000)
    return () => clearInterval(timer)
  }, [])

  // 润色发帖 — 唯一可交互工具
  if (view === 'post') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <button onClick={() => setView('dashboard')} style={backBtnStyle}>
          ← 返回工具箱
        </button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <PostTool />
        </div>
      </div>
    )
  }

  // 状态仪表盘
  const fState = followState
  const lState = likeState?.state
  const lConfig = likeState?.config

  return (
    <div style={{ padding: '14px', flex: 1 }}>
      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>
        工具状态 · 配置请在平台工具箱中操作
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 关注自动化 */}
        <StatusRow
          label="关注自动化"
          status={fState?.status || 'idle'}
          detail={fState ? `今日 ${fState.dailyFollowed || 0}/${fState.dailyTarget || 200}` : '未启动'}
          subDetail={fState?.currentPhase || undefined}
        />

        {/* 点赞伴随 */}
        <StatusRow
          label="点赞伴随"
          status={lConfig?.enabled ? 'on' : 'off'}
          detail={lState ? `今日 ${lState.dailyCount || 0}/${lState.dailyLimit || 50}` : '已关闭'}
        />

        {/* 互关检查 */}
        <StatusRow
          label="互关检查"
          status={unfollowState?.status === 'running' ? 'running' : 'idle'}
          detail={unfollowState?.status === 'running'
            ? `取关中 ${unfollowState.unfollowedCount}/${unfollowState.nonFollowerCount}`
            : '等待指令'
          }
        />

        {/* AI 模型 */}
        <StatusRow
          label="AI 模型"
          status={modelState?.activeModelId ? 'on' : 'off'}
          detail={modelState?.activeModelId || '平台模型 (每日3次)'}
        />

        {/* 分隔线 */}
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

        {/* 润色发帖 — 唯一可点击进入的工具 */}
        <button
          onClick={() => setView('post')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 10px', borderRadius: 8,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#ff5722')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <span style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'rgba(255,87,34,0.1)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 15,
            flexShrink: 0, color: '#ff5722',
          }}>
            ✏
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>润色发帖</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>AI润色 + 语音输入 + 直接发帖</div>
          </div>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>→</span>
        </button>
      </div>

      {/* 提示 */}
      <div style={{
        marginTop: 12, padding: '8px 10px', borderRadius: 6,
        background: 'rgba(255,87,34,0.05)', border: '1px solid rgba(255,87,34,0.1)',
        fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5,
      }}>
        关注/点赞/互关检查/模型管理的配置和操控请在
        <strong style={{ color: '#ff5722' }}> xSocial 网站 → 工具箱 </strong>
        中完成。配置变更会自动同步到扩展。
      </div>
    </div>
  )
}

// 状态行组件
function StatusRow({ label, status, detail, subDetail }: {
  label: string; status: string; detail: string; subDetail?: string
}) {
  const dotColor = (() => {
    if (status === 'running' || status === 'on' || status === 'waiting') return '#22c55e'
    if (status === 'paused') return '#f59e0b'
    return '#555'
  })()

  return (
    <div style={{
      padding: '10px', borderRadius: 8,
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: dotColor,
        boxShadow: dotColor !== '#555' ? `0 0 6px ${dotColor}60` : 'none',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {subDetail && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subDetail}</div>}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>{detail}</span>
    </div>
  )
}

const backBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: 'transparent', border: 'none',
  color: '#ff5722', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
}
