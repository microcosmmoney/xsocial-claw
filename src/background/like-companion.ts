// Developed by AI Agent


import type { LikeAutoConfig, LikeAutoState } from '@shared/types'
import { getXCookies, likeTweet } from './x-api'
import { logger } from '@utils/logger'


const DEFAULT_CONFIG: LikeAutoConfig = {
  enabled: false,
  dailyLimit: 50,
  probability: 0.3,
  minGapSec: 30,
}


let config: LikeAutoConfig = { ...DEFAULT_CONFIG }
let state: LikeAutoState = {
  enabled: false,
  dailyCount: 0,
  dailyLimit: 50,
  lastLikedAt: null,
  todayDate: new Date().toISOString().slice(0, 10),
}


export function getLikeAutoState(): LikeAutoState {
  return { ...state }
}

export function getLikeAutoConfig(): LikeAutoConfig {
  return { ...config }
}

export async function setLikeAutoConfig(partial: Partial<LikeAutoConfig>): Promise<void> {
  config = { ...config, ...partial }
  state.enabled = config.enabled
  state.dailyLimit = config.dailyLimit
  await saveState()
}

export async function toggleLikeAuto(enabled: boolean): Promise<void> {
  config.enabled = enabled
  state.enabled = enabled
  await saveState()
}


export async function tryCompanionLike(tabId: number): Promise<boolean> {
  
  if (!config.enabled) return false

  
  const today = new Date().toISOString().slice(0, 10)
  if (state.todayDate !== today) {
    state.dailyCount = 0
    state.todayDate = today
  }

  
  if (state.dailyCount >= config.dailyLimit) return false

  
  if (Math.random() > config.probability) return false

  
  if (state.lastLikedAt) {
    const gapSec = (Date.now() - state.lastLikedAt) / 1000
    if (gapSec < config.minGapSec) return false
  }

  
  try {
    const cookies = await getXCookies()
    if (!cookies) return false

    
    const tweetId = await pickRandomVisibleTweet(tabId)
    if (!tweetId) return false

    const result = await likeTweet(cookies, tweetId)
    if (result.success) {
      state.dailyCount++
      state.lastLikedAt = Date.now()
      await saveState()
      await incrementLikeKpi()
      logger.info(`[LikeCompanion] 伴随点赞成功 (今日 ${state.dailyCount}/${config.dailyLimit})`)
      return true
    }
  } catch (err) {
    logger.warn('[LikeCompanion] 点赞异常:', err)
  }

  return false
}


export async function restoreLikeState(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['like_auto_state', 'like_auto_config'])
    if (result.like_auto_config) {
      config = { ...DEFAULT_CONFIG, ...result.like_auto_config }
    }
    if (result.like_auto_state) {
      state = { ...state, ...result.like_auto_state }
      state.enabled = config.enabled
      state.dailyLimit = config.dailyLimit
      
      const today = new Date().toISOString().slice(0, 10)
      if (state.todayDate !== today) {
        state.dailyCount = 0
        state.todayDate = today
      }
    }
  } catch {  }
}


async function pickRandomVisibleTweet(tabId: number): Promise<string | null> {
  try {
    
    const res = await chrome.tabs.sendMessage(tabId, { type: 'LIKE_PICK_TWEET' })
    if (res?.success && res.data?.tweetId) {
      return res.data.tweetId
    }
  } catch {  }
  return null
}

async function saveState(): Promise<void> {
  try {
    await chrome.storage.local.set({
      like_auto_state: state,
      like_auto_config: config,
    })
  } catch {  }
}

async function incrementLikeKpi(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const store = await chrome.storage.local.get('daily_kpi')
    const kpi = store.daily_kpi || {}
    if (kpi.date !== today) {
      Object.keys(kpi).forEach(k => { if (k !== 'date') kpi[k] = 0 })
      kpi.date = today
    }
    kpi.likes = (kpi.likes || 0) + 1
    await chrome.storage.local.set({ daily_kpi: kpi })
  } catch {  }
}
