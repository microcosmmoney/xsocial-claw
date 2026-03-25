// Developed by AI Agent
import React, { useState, useEffect } from 'react'
import type { ModelManagerState, PresetModelDef, UserModelConfig } from '@shared/types'


const MODEL_INFO: Record<string, {
  region: 'overseas' | 'china'
  pricing: string
  freeQuota?: string
  registerUrl: string
  registerTip: string
}> = {
  'gemini-2.5-flash': {
    region: 'overseas',
    pricing: '$0.15/1M input, $0.60/1M output',
    freeQuota: '免费额度: 1500次/天 (Flash-Lite), Flash 需付费',
    registerUrl: 'https://aistudio.google.com/apikey',
    registerTip: '访问 Google AI Studio 一键获取 Key',
  },
  'gemini-2.5-flash-lite': {
    region: 'overseas',
    pricing: '完全免费',
    freeQuota: '1500次/天, 15次/分钟, 适合轻度使用',
    registerUrl: 'https://aistudio.google.com/apikey',
    registerTip: '访问 Google AI Studio 一键获取 Key',
  },
  'gpt-4o-mini': {
    region: 'overseas',
    pricing: '$0.15/1M input, $0.60/1M output',
    registerUrl: 'https://platform.openai.com/api-keys',
    registerTip: '注册 OpenAI 账号, 新用户有 $5 免费额度',
  },
  'deepseek-v3': {
    region: 'china',
    pricing: '¥1/1M input, ¥2/1M output (约 $0.28/1M)',
    freeQuota: '新用户赠送 500万 Token (约 $1.4)',
    registerUrl: 'https://platform.deepseek.com/',
    registerTip: '注册即送 500万 Token, 性价比极高',
  },
  'glm-4-flash': {
    region: 'china',
    pricing: '完全免费',
    freeQuota: '不限量免费, 128K上下文, 中文效果优秀',
    registerUrl: 'https://open.bigmodel.cn/',
    registerTip: '注册智谱开放平台, Flash 模型完全免费',
  },
  'groq-llama-3.3-70b': {
    region: 'overseas',
    pricing: '完全免费',
    freeQuota: '约 14000 tokens/分钟, 超高速推理',
    registerUrl: 'https://console.groq.com/keys',
    registerTip: '注册 Groq 即可使用, Llama 3.3 完全免费',
  },
  'qwen-plus': {
    region: 'china',
    pricing: '¥0.8/1M input, ¥2/1M output',
    freeQuota: '新用户赠送 100万 Token 免费额度',
    registerUrl: 'https://dashscope.console.aliyun.com/',
    registerTip: '注册阿里云百炼平台, 获取 DashScope API Key',
  },
}

export default function ModelManagerPage() {
  const [modelState, setModelState] = useState<ModelManagerState | null>(null)
  const [presets, setPresets] = useState<PresetModelDef[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ modelId: string; ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    (async () => {
      const res = await chrome.runtime.sendMessage({ type: 'MODEL_GET_STATE' })
      if (res?.success) {
        setModelState(res.data.state)
        setPresets(res.data.presets)
      }
      setLoading(false)
    })()
  }, [])

  const handleSaveKey = async (modelId: string) => {
    if (!keyInput.trim()) return
    const res = await chrome.runtime.sendMessage({
      type: 'MODEL_SAVE_KEY',
      payload: { modelId, apiKey: keyInput.trim() },
    })
    if (res?.success) {
      setModelState(res.data)
      setEditingId(null)
      setKeyInput('')
    }
  }

  const handleRemove = async (modelId: string) => {
    const res = await chrome.runtime.sendMessage({ type: 'MODEL_REMOVE', payload: { modelId } })
    if (res?.success) setModelState(res.data)
  }

  const handleActivate = async (modelId: string | null) => {
    const res = await chrome.runtime.sendMessage({ type: 'MODEL_SET_ACTIVE', payload: { modelId } })
    if (res?.success) setModelState(res.data)
  }

  const handleTest = async (modelId: string) => {
    setTesting(modelId)
    setTestResult(null)
    const res = await chrome.runtime.sendMessage({ type: 'MODEL_TEST', payload: { modelId } })
    if (res?.success) {
      setModelState(res.data.state)
      setTestResult({
        modelId,
        ok: res.data.ok,
        msg: res.data.ok ? `连通! ${res.data.latencyMs}ms` : res.data.error,
      })
    }
    setTesting(null)
  }

  if (loading || !modelState) {
    return <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>加载中...</div>
  }

  const userModelMap = new Map(modelState.userModels.map(m => [m.modelId, m]))
  const chinaModels = presets.filter(p => MODEL_INFO[p.id]?.region === 'china')
  const overseasModels = presets.filter(p => MODEL_INFO[p.id]?.region === 'overseas')

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        AI 模型管理
      </h3>
      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
        配置自有模型后，AI 润色不再消耗平台次数。推荐先试免费模型!
      </p>

      {}
      <div style={{
        padding: '10px 12px', borderRadius: 8, marginBottom: 14,
        background: modelState.activeModelId ? 'rgba(34,197,94,0.06)' : 'rgba(29,155,240,0.06)',
        border: `1px solid ${modelState.activeModelId ? 'rgba(34,197,94,0.2)' : 'rgba(29,155,240,0.2)'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--text-secondary)' }}>当前: </span>
          <strong style={{ color: modelState.activeModelId ? '#22c55e' : '#1d9bf0' }}>
            {modelState.activeModelId
              ? presets.find(p => p.id === modelState.activeModelId)?.name || modelState.activeModelId
              : '平台模型 (每日3次)'
            }
          </strong>
        </div>
        {modelState.activeModelId && (
          <button onClick={() => handleActivate(null)} style={{
            padding: '3px 10px', borderRadius: 10, fontSize: 10, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            切回平台
          </button>
        )}
      </div>

      {}
      <SectionTitle title="国内模型" subtitle="注册即用, 多个提供免费额度" />
      {chinaModels.map(p => (
        <ModelCard
          key={p.id}
          preset={p}
          info={MODEL_INFO[p.id]}
          userConfig={userModelMap.get(p.id)}
          isActive={modelState.activeModelId === p.id}
          isEditing={editingId === p.id}
          keyInput={editingId === p.id ? keyInput : ''}
          testing={testing === p.id}
          testResult={testResult?.modelId === p.id ? testResult : null}
          onEdit={() => { setEditingId(p.id); setKeyInput(userModelMap.get(p.id)?.apiKey || '') }}
          onKeyChange={setKeyInput}
          onSave={() => handleSaveKey(p.id)}
          onCancel={() => { setEditingId(null); setKeyInput('') }}
          onRemove={() => handleRemove(p.id)}
          onActivate={() => handleActivate(p.id)}
          onTest={() => handleTest(p.id)}
        />
      ))}

      {}
      <SectionTitle title="国外模型" subtitle="需科学上网, 部分有免费额度" />
      {overseasModels.map(p => (
        <ModelCard
          key={p.id}
          preset={p}
          info={MODEL_INFO[p.id]}
          userConfig={userModelMap.get(p.id)}
          isActive={modelState.activeModelId === p.id}
          isEditing={editingId === p.id}
          keyInput={editingId === p.id ? keyInput : ''}
          testing={testing === p.id}
          testResult={testResult?.modelId === p.id ? testResult : null}
          onEdit={() => { setEditingId(p.id); setKeyInput(userModelMap.get(p.id)?.apiKey || '') }}
          onKeyChange={setKeyInput}
          onSave={() => handleSaveKey(p.id)}
          onCancel={() => { setEditingId(null); setKeyInput('') }}
          onRemove={() => handleRemove(p.id)}
          onActivate={() => handleActivate(p.id)}
          onTest={() => handleTest(p.id)}
        />
      ))}
    </div>
  )
}


function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 8, marginTop: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 6 }}>{subtitle}</span>
    </div>
  )
}

function ModelCard({ preset, info, userConfig, isActive, isEditing, keyInput, testing, testResult,
  onEdit, onKeyChange, onSave, onCancel, onRemove, onActivate, onTest,
}: {
  preset: PresetModelDef
  info?: typeof MODEL_INFO[string]
  userConfig?: UserModelConfig
  isActive: boolean
  isEditing: boolean
  keyInput: string
  testing: boolean
  testResult: { ok: boolean; msg: string } | null
  onEdit: () => void
  onKeyChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  onRemove: () => void
  onActivate: () => void
  onTest: () => void
}) {
  const hasKey = !!userConfig
  const hasError = userConfig?.lastError

  return (
    <div style={{
      marginBottom: 8, padding: '10px', borderRadius: 8,
      background: 'var(--bg-primary)',
      border: `1px solid ${isActive ? '#22c55e' : hasError ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
    }}>
      {}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{preset.name}</span>
        {preset.free && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>免费</span>
        )}
        {isActive && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 600 }}>使用中</span>
        )}
        {hasKey && !isActive && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'rgba(29,155,240,0.1)', color: '#1d9bf0' }}>已配置</span>
        )}
      </div>

      {}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: 6 }}>
        {info?.pricing && <div>价格: {info.pricing}</div>}
        {info?.freeQuota && <div style={{ color: '#22c55e' }}>{info.freeQuota}</div>}
      </div>

      {}
      {hasError && !isEditing && (
        <div style={{
          padding: '6px 8px', borderRadius: 6, marginBottom: 6,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
          fontSize: 10, color: '#ef4444', lineHeight: 1.4,
        }}>
          {userConfig!.lastError}
        </div>
      )}

      {}
      {testResult && (
        <div style={{
          padding: '6px 8px', borderRadius: 6, marginBottom: 6,
          background: testResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          fontSize: 10, color: testResult.ok ? '#22c55e' : '#ef4444',
        }}>
          {testResult.msg}
        </div>
      )}

      {}
      {isEditing ? (
        <div style={{ marginBottom: 6 }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => onKeyChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
            placeholder="粘贴你的 API Key"
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 6, boxSizing: 'border-box',
              border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: 11, outline: 'none', fontFamily: 'monospace',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={onSave} style={{ ...smallBtnStyle, background: '#22c55e', color: '#fff', border: 'none' }}>保存</button>
            <button onClick={onCancel} style={smallBtnStyle}>取消</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {hasKey ? (
            <>
              {!isActive && <button onClick={onActivate} style={{ ...smallBtnStyle, background: 'rgba(34,197,94,0.1)', color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)' }}>激活</button>}
              <button onClick={onTest} disabled={testing} style={smallBtnStyle}>
                {testing ? '测试中...' : '测试'}
              </button>
              <button onClick={onEdit} style={smallBtnStyle}>修改Key</button>
              <button onClick={onRemove} style={{ ...smallBtnStyle, color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }}>删除</button>
            </>
          ) : (
            <button onClick={onEdit} style={{ ...smallBtnStyle, background: 'rgba(29,155,240,0.1)', color: '#1d9bf0', borderColor: 'rgba(29,155,240,0.3)' }}>添加 Key</button>
          )}
          {info?.registerUrl && (
            <button
              onClick={() => chrome.tabs.create({ url: info.registerUrl })}
              style={{ ...smallBtnStyle, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }}
            >
              去注册
            </button>
          )}
        </div>
      )}

      {}
      {info?.registerTip && !isEditing && (
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {info.registerTip}
        </div>
      )}
    </div>
  )
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 500,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
}
