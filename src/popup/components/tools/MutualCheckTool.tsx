import React, { useState, useEffect } from 'react'
import type { MutualCheckResult, UnfollowPlanConfig } from '@shared/types'

type Phase = 'loading' | 'idle' | 'scanning' | 'result' | 'running'
type SubView = 'main' | 'history' | 'breakers'

interface MutualStatus {
  canScan: boolean
  cooldownUntil: string | null
  cooldownDays: number
  lastSnapshot: {
    totalFollowing: number
    totalFollowers: number
    mutualCount: number
    nonFollowerCount: number
    scannedAt: string
  } | null
  history: Array<{
    id: string
    totalFollowing: number
    totalFollowers: number
    mutualCount: number
    nonFollowerCount: number
    createdAt: string
  }>
  mutualBreakers: Array<{
    targetXId: string
    targetHandle: string | null
    unfollowMeCount: number
    lastUnfollowedAt: string | null
    iFollow: boolean
    followsMe: boolean
  }>
}

export default function MutualCheckTool() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [subView, setSubView] = useState<SubView>('main')
  const [status, setStatus] = useState<MutualStatus | null>(null)
  const [scanResult, setScanResult] = useState<MutualCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unfollowProgress, setUnfollowProgress] = useState<any>(null)

  const [planConfig, setPlanConfig] = useState<UnfollowPlanConfig>({
    hourlyRate: 15,
    totalDays: 7,
    activeHoursStart: 8,
    activeHoursEnd: 23,
  })

  // 初始加载: 获取服务端状态 + 本地缓存
  useEffect(() => {
    (async () => {
      // 检查进行中的取关任务
      const progressRes = await chrome.runtime.sendMessage({ type: 'TOOL_GET_UNFOLLOW_PROGRESS' })
      if (progressRes?.success && progressRes.data && ['running', 'paused'].includes(progressRes.data.status)) {
        setUnfollowProgress(progressRes.data)
        setPhase('running')
        return
      }

      // 从服务端获取状态
      const statusRes = await chrome.runtime.sendMessage({ type: 'TOOL_MUTUAL_STATUS' })
      if (statusRes?.success && statusRes.data) {
        setStatus(statusRes.data)
      }

      // 检查本地缓存结果
      const cachedRes = await chrome.runtime.sendMessage({ type: 'TOOL_GET_MUTUAL_RESULT' })
      if (cachedRes?.success && cachedRes.data) {
        setScanResult(cachedRes.data)
        setPhase('result')
      } else {
        setPhase('idle')
      }
    })()
  }, [])

  // 取关运行中轮询
  useEffect(() => {
    if (phase !== 'running') return
    const timer = setInterval(async () => {
      const res = await chrome.runtime.sendMessage({ type: 'TOOL_GET_UNFOLLOW_PROGRESS' })
      if (res?.success && res.data) {
        setUnfollowProgress(res.data)
        if (res.data.status === 'completed') { setPhase('idle'); clearInterval(timer) }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [phase])

  const handleScan = async () => {
    setPhase('scanning')
    setError(null)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'TOOL_MUTUAL_CHECK' })
      if (res?.success) {
        setScanResult(res.data)
        setPhase('result')
        // 刷新服务端状态
        const statusRes = await chrome.runtime.sendMessage({ type: 'TOOL_MUTUAL_STATUS' })
        if (statusRes?.success) setStatus(statusRes.data)
      } else {
        setError(res?.error || '扫描失败')
        setPhase('idle')
      }
    } catch (err: any) {
      setError(err.message)
      setPhase('idle')
    }
  }

  const handleStartPlan = async () => {
    if (!scanResult?.nonFollowers?.length) return
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TOOL_START_UNFOLLOW_PLAN',
        payload: { nonFollowers: scanResult.nonFollowers, config: planConfig },
      })
      if (res?.success) setPhase('running')
      else setError(res?.error || '启动失败')
    } catch (err: any) { setError(err.message) }
  }

  const handlePause = async () => {
    await chrome.runtime.sendMessage({ type: 'TOOL_PAUSE_UNFOLLOW' })
    setPhase('result')
  }

  if (phase === 'loading') {
    return <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>加载中...</div>
  }

  // ===== 子视图: 扫描历史 =====
  if (subView === 'history') {
    return (
      <div style={{ padding: '0 14px 14px' }}>
        <button onClick={() => setSubView('main')} style={backBtnStyle}>← 返回</button>
        <h3 style={headingStyle}>扫描历史</h3>
        {status?.history?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {status.history.map((h) => (
              <div key={h.id} style={{
                padding: '10px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border)', fontSize: 11,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {new Date(h.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                    {new Date(h.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4, color: 'var(--text-secondary)' }}>
                  <span>关注 <strong>{h.totalFollowing}</strong></span>
                  <span>粉丝 <strong>{h.totalFollowers}</strong></span>
                  <span>互关 <strong style={{ color: '#22c55e' }}>{h.mutualCount}</strong></span>
                  <span>未回关 <strong style={{ color: '#ef4444' }}>{h.nonFollowerCount}</strong></span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>暂无扫描记录</p>
        )}
      </div>
    )
  }

  // ===== 子视图: 反复取关者 =====
  if (subView === 'breakers') {
    const breakers = status?.mutualBreakers || []
    return (
      <div style={{ padding: '0 14px 14px' }}>
        <button onClick={() => setSubView('main')} style={backBtnStyle}>← 返回</button>
        <h3 style={headingStyle}>反复取关者</h3>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10, lineHeight: 1.5 }}>
          以下用户曾与你互关后反复取消关注 (3次以上)。建议谨慎对待，避免浪费关注名额。
        </p>
        {breakers.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {breakers.map((b) => (
              <div key={b.targetXId} style={{
                padding: '8px 10px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid rgba(239,68,68,0.15)', fontSize: 11,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {b.targetHandle ? `@${b.targetHandle}` : `ID: ${b.targetXId}`}
                  </span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, color: 'var(--text-tertiary)', fontSize: 10 }}>
                    <span>取关 {b.unfollowMeCount} 次</span>
                    {b.lastUnfollowedAt && (
                      <span>最近: {new Date(b.lastUnfollowedAt).toLocaleDateString('zh-CN')}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, fontSize: 10 }}>
                  <span style={{
                    padding: '2px 6px', borderRadius: 8,
                    background: b.iFollow ? 'rgba(29,155,240,0.1)' : 'transparent',
                    color: b.iFollow ? '#1d9bf0' : 'var(--text-tertiary)',
                    border: '1px solid ' + (b.iFollow ? 'rgba(29,155,240,0.2)' : 'var(--border)'),
                  }}>
                    {b.iFollow ? '我关注' : '未关注'}
                  </span>
                  <span style={{
                    padding: '2px 6px', borderRadius: 8,
                    background: b.followsMe ? 'rgba(34,197,94,0.1)' : 'transparent',
                    color: b.followsMe ? '#22c55e' : 'var(--text-tertiary)',
                    border: '1px solid ' + (b.followsMe ? 'rgba(34,197,94,0.2)' : 'var(--border)'),
                  }}>
                    {b.followsMe ? '回关了' : '未回关'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>暂无反复取关者</p>
        )}
      </div>
    )
  }

  // ===== 主视图 =====

  const activeHoursPerDay = planConfig.activeHoursEnd - planConfig.activeHoursStart
  const dailyCapacity = planConfig.hourlyRate * activeHoursPerDay
  const estimatedDays = scanResult ? Math.ceil(scanResult.nonFollowers.length / dailyCapacity) : 0
  const canScan = status?.canScan !== false
  const breakerCount = status?.mutualBreakers?.length || 0

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <h3 style={headingStyle}>互关检查</h3>

      {/* 快捷入口: 历史 + 反复取关者 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setSubView('history')} style={chipBtnStyle}>
          扫描历史 ({status?.history?.length || 0})
        </button>
        <button
          onClick={() => setSubView('breakers')}
          style={{
            ...chipBtnStyle,
            borderColor: breakerCount > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)',
            color: breakerCount > 0 ? '#ef4444' : 'var(--text-tertiary)',
            background: breakerCount > 0 ? 'rgba(239,68,68,0.05)' : 'transparent',
          }}
        >
          反复取关者 ({breakerCount})
        </button>
      </div>

      {/* 上次扫描摘要 */}
      {status?.lastSnapshot && (
        <div style={{
          padding: '10px', borderRadius: 8, marginBottom: 12,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>上次扫描</span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {new Date(status.lastSnapshot.scannedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
            <span>关注 <strong>{status.lastSnapshot.totalFollowing}</strong></span>
            <span>粉丝 <strong>{status.lastSnapshot.totalFollowers}</strong></span>
            <span>互关 <strong style={{ color: '#22c55e' }}>{status.lastSnapshot.mutualCount}</strong></span>
            <span>未回关 <strong style={{ color: '#ef4444' }}>{status.lastSnapshot.nonFollowerCount}</strong></span>
          </div>
        </div>
      )}

      {/* 扫描阶段 */}
      {(phase === 'idle' || phase === 'scanning') && (
        <>
          {!canScan && status?.cooldownUntil && (
            <div style={{
              marginBottom: 10, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)',
              fontSize: 11, color: '#f59e0b', lineHeight: 1.5,
            }}>
              <strong>冷却中</strong> — 下次可扫描: {new Date(status.cooldownUntil).toLocaleDateString('zh-CN')}
              <br />频繁扫描容易被 Twitter 识别为机器行为，建议至少间隔 {status.cooldownDays} 天。
            </div>
          )}

          <button
            onClick={handleScan}
            disabled={phase === 'scanning' || !canScan}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none',
              background: (!canScan || phase === 'scanning') ? '#666' : '#a855f7', color: '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: (!canScan || phase === 'scanning') ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {phase === 'scanning' ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span className="animate-spin" style={{
                  width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block',
                }} />
                扫描中... (可能需要数分钟)
              </span>
            ) : !canScan ? '冷却中' : '开始扫描'}
          </button>

          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.1)',
            fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6,
          }}>
            <strong style={{ color: '#ef4444' }}>风险提示:</strong> 扫描会拉取完整关注/粉丝列表 (最多5000/页)。
            频繁调用这类接口容易触发 Twitter 的自动化检测。系统强制最少间隔 {status?.cooldownDays || 7} 天。
            扫描结果会入库，每次扫描都会与上次对比，自动追踪反复取关的人。
          </div>
        </>
      )}

      {/* 扫描结果 */}
      {phase === 'result' && scanResult && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <StatCard label="关注" value={scanResult.totalFollowing} color="#1d9bf0" />
            <StatCard label="粉丝" value={scanResult.totalFollowers} color="#22c55e" />
            <StatCard label="互关" value={scanResult.mutualCount} color="#ff5722" />
            <StatCard label="未回关" value={scanResult.nonFollowers.length} color="#ef4444" />
          </div>

          {scanResult.nonFollowers.length > 0 && (
            <>
              <div style={{
                marginBottom: 12, padding: '12px', borderRadius: 8,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
              }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                  取关计划配置
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    每小时取关数量
                    <input type="range" min={5} max={30} step={5} value={planConfig.hourlyRate}
                      onChange={(e) => setPlanConfig(c => ({ ...c, hourlyRate: Number(e.target.value) }))}
                      style={{ width: '100%', marginTop: 4 }} />
                    <span style={{ float: 'right', color: '#ff5722', fontWeight: 600 }}>{planConfig.hourlyRate} 人/小时</span>
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    活跃时段
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      <input type="number" min={0} max={23} value={planConfig.activeHoursStart}
                        onChange={(e) => setPlanConfig(c => ({ ...c, activeHoursStart: Number(e.target.value) }))}
                        style={timeInputStyle} />
                      <span>至</span>
                      <input type="number" min={1} max={24} value={planConfig.activeHoursEnd}
                        onChange={(e) => setPlanConfig(c => ({ ...c, activeHoursEnd: Number(e.target.value) }))}
                        style={timeInputStyle} />
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>({activeHoursPerDay}h/天)</span>
                    </div>
                  </label>
                </div>
                <div style={{
                  marginTop: 10, padding: '8px', borderRadius: 6,
                  background: 'rgba(255,87,34,0.08)', fontSize: 11,
                  color: 'var(--text-secondary)', lineHeight: 1.5,
                }}>
                  {scanResult.nonFollowers.length} 人未回关 · 每日取关 {dailyCapacity} 人 ·
                  预计 <strong style={{ color: '#ff5722' }}>{estimatedDays}</strong> 天完成
                </div>
              </div>

              <button onClick={() => { handleStartPlan() }} style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                启动取关计划 ({scanResult.nonFollowers.length} 人)
              </button>
            </>
          )}

          {canScan && (
            <button onClick={handleScan} style={{
              width: '100%', marginTop: 8, padding: '10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              重新扫描
            </button>
          )}
        </>
      )}

      {/* 取关进行中 */}
      {phase === 'running' && unfollowProgress && (
        <>
          <div style={{ padding: '14px', borderRadius: 8, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>取关进行中</span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: unfollowProgress.status === 'running' ? 'rgba(34,197,94,0.1)' : 'rgba(255,165,0,0.1)',
                color: unfollowProgress.status === 'running' ? '#22c55e' : '#f59e0b',
              }}>
                {unfollowProgress.status === 'running' ? '运行中' : '已暂停'}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginBottom: 10 }}>
              <div style={{
                height: '100%', borderRadius: 3, background: '#ff5722',
                width: `${Math.min(100, (unfollowProgress.unfollowedCount / unfollowProgress.nonFollowerCount) * 100)}%`,
                transition: 'width 0.3s',
              }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span>已取关: <strong>{unfollowProgress.unfollowedCount}</strong></span>
              <span>总计: <strong>{unfollowProgress.nonFollowerCount}</strong></span>
              <span>失败: <strong style={{ color: '#ef4444' }}>{unfollowProgress.failedCount}</strong></span>
              <span>小时: <strong>{unfollowProgress.hourlyCount}</strong></span>
            </div>
          </div>
          <button onClick={handlePause} style={{
            width: '100%', marginTop: 10, padding: '10px', borderRadius: 8,
            border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.1)',
            color: '#f59e0b', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            暂停计划
          </button>
        </>
      )}

      {error && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#ef4444',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ===== 子组件 + 样式 =====

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '10px', borderRadius: 8, background: 'var(--bg-primary)',
      border: '1px solid var(--border)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'monospace' }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

const headingStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }

const backBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 0', marginBottom: 4,
  background: 'transparent', border: 'none', color: '#a855f7', fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit',
}

const chipBtnStyle: React.CSSProperties = {
  flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 11,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
  textAlign: 'center',
}

const timeInputStyle: React.CSSProperties = {
  width: 50, padding: '4px 8px', borderRadius: 4,
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', fontSize: 12, textAlign: 'center',
}
