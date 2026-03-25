// Developed by AI Agent


import type { ModelManagerState, UserModelConfig, PresetModelDef } from '@shared/types'
import { PRESET_MODELS as FALLBACK_PRESETS } from '@shared/constants'
import { logger } from '@utils/logger'

const STORAGE_KEY = 'model_manager'


let state: ModelManagerState = {
  activeModelId: null,
  userModels: [],
}


export function getModelState(): ModelManagerState {
  return { ...state, userModels: state.userModels.map(m => ({ ...m })) }
}


export async function getPresetModels(): Promise<PresetModelDef[]> {
  try {
    const store = await chrome.storage.local.get('dynamic_config')
    if (store.dynamic_config?.presetModels?.length) {
      return store.dynamic_config.presetModels
    }
  } catch {  }
  return FALLBACK_PRESETS
}

function getPresetModelsSync(): PresetModelDef[] {
  
  return FALLBACK_PRESETS
}


export async function saveUserModel(modelId: string, apiKey: string): Promise<void> {
  const preset = FALLBACK_PRESETS.find(m => m.id === modelId)
  if (!preset) throw new Error(`未知模型: ${modelId}`)

  const existing = state.userModels.find(m => m.modelId === modelId)
  if (existing) {
    existing.apiKey = apiKey
    existing.lastError = undefined
    existing.lastErrorAt = undefined
    existing.testOk = undefined
    existing.lastTestedAt = undefined
  } else {
    state.userModels.push({
      modelId,
      apiKey,
      addedAt: Date.now(),
    })
  }
  await persistState()
}


export async function removeUserModel(modelId: string): Promise<void> {
  state.userModels = state.userModels.filter(m => m.modelId !== modelId)
  if (state.activeModelId === modelId) state.activeModelId = null
  await persistState()
}


export async function setActiveModel(modelId: string | null): Promise<void> {
  if (modelId && !state.userModels.find(m => m.modelId === modelId)) {
    throw new Error('请先添加 API Key')
  }
  state.activeModelId = modelId
  await persistState()
}


export async function testModel(modelId: string): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const userModel = state.userModels.find(m => m.modelId === modelId)
  if (!userModel) return { ok: false, error: '未配置该模型的 Key' }

  const preset = FALLBACK_PRESETS.find(m => m.id === modelId)
  if (!preset) return { ok: false, error: '未知模型' }

  const start = Date.now()
  try {
    const result = await callModelDirect(preset, userModel.apiKey, '请回复"OK"两个字', { maxTokens: 50 })
    const latencyMs = Date.now() - start
    userModel.testOk = true
    userModel.lastTestedAt = Date.now()
    userModel.lastError = undefined
    userModel.lastErrorAt = undefined
    await persistState()
    return { ok: true, latencyMs }
  } catch (err: any) {
    const errorMsg = parseModelError(err)
    userModel.testOk = false
    userModel.lastTestedAt = Date.now()
    userModel.lastError = errorMsg
    userModel.lastErrorAt = Date.now()
    await persistState()
    return { ok: false, error: errorMsg }
  }
}


export async function callUserModel(prompt: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  if (!state.activeModelId) throw new Error('未激活自有模型')

  const userModel = state.userModels.find(m => m.modelId === state.activeModelId)
  if (!userModel) throw new Error('未配置该模型的 Key')

  const preset = FALLBACK_PRESETS.find(m => m.id === state.activeModelId)
  if (!preset) throw new Error('未知模型')

  try {
    const result = await callModelDirect(preset, userModel.apiKey, prompt, opts)
    
    if (userModel.lastError) {
      userModel.lastError = undefined
      userModel.lastErrorAt = undefined
      await persistState()
    }
    return result
  } catch (err: any) {
    const errorMsg = parseModelError(err)
    userModel.lastError = errorMsg
    userModel.lastErrorAt = Date.now()
    await persistState()
    throw new Error(errorMsg)
  }
}


export function hasActiveUserModel(): boolean {
  return !!state.activeModelId && !!state.userModels.find(m => m.modelId === state.activeModelId)
}


export async function restoreModelState(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    if (result[STORAGE_KEY]) {
      state = { ...state, ...result[STORAGE_KEY] }
    }
  } catch {  }
}


async function callModelDirect(
  preset: PresetModelDef,
  apiKey: string,
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  if (preset.provider === 'gemini') {
    return callGemini(preset, apiKey, prompt, opts)
  } else {
    return callOpenAICompatible(preset, apiKey, prompt, opts)
  }
}

async function callGemini(
  preset: PresetModelDef,
  apiKey: string,
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const url = `${preset.baseUrl}/models/${preset.modelId}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts?.temperature ?? 0.7,
        maxOutputTokens: opts?.maxTokens ?? preset.maxTokens,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ModelApiError(res.status, text)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('模型返回内容为空')
  return text
}

async function callOpenAICompatible(
  preset: PresetModelDef,
  apiKey: string,
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const url = `${preset.baseUrl}/v1/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: preset.modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? preset.maxTokens,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ModelApiError(res.status, text)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('模型返回内容为空')
  return text
}


class ModelApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`API ${status}`)
  }
}

function parseModelError(err: any): string {
  if (err instanceof ModelApiError) {
    const { status, body } = err
    if (status === 401 || status === 403) return 'API Key 无效或已过期，请检查后重新输入'
    if (status === 429) return '请求过于频繁或额度已用完，请稍后重试或充值'
    if (status === 404) return '模型不存在或 API 地址有误'
    if (status >= 500) return '模型服务暂时不可用，请稍后重试'
    
    try {
      const parsed = JSON.parse(body)
      const msg = parsed.error?.message || parsed.message || parsed.detail
      if (msg) return `模型错误: ${String(msg).slice(0, 120)}`
    } catch {  }
    return `模型请求失败 (HTTP ${status})`
  }
  return err?.message || '未知错误'
}

async function persistState(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state })
  } catch {  }
}
