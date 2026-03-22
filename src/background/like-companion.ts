/**
 * 点赞伴随模块 — 全局开关，随机附带在其他操作中
 *
 * 不独立运行，在关注/回帖/滚动时以一定概率触发点赞。
 * 点赞目标: 当前页面可见的推文。
 *
 * 安全策略:
 *   - 每日上限 50 (Twitter 无公开限制, 但自动化是封号主因, 极度保守)
 *   - 伴随概率 30% (不是每次操作都点赞)
 *   - 两次点赞间隔至少 30 秒
 *   - 随机选择可见推文点赞 (不全点, 模拟真人挑着看)
 */

import type { LikeAutoConfig, LikeAutoState } from '@shared/types'
import { getXCookies, likeTweet } from './x-api'
import { logger } from '@utils/logger'

// ===== 默认配置 =====

const DEFAULT_CONFIG: LikeAutoConfig = {
  enabled: false,
  dailyLimit: 50,
  probability: 0.3,
  minGapSec: 30,
}

// ===== 内部状态 =====

let config: LikeAutoConfig = { ...DEFAULT_CONFIG }
let state: LikeAutoState = {
  enabled: false,
  dailyCount: 0,
  dailyLimit: 50,
  lastLikedAt: null,
  todayDate: new Date().toISOString().slice(0, 10),
}

// ===== 公共 API =====

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

/**
 * 尝试伴随点赞 — 其他模块 (follow-automation 等) 在操作间调用此函数
 *
 * @param tabId - 当前操作的 x.com tab ID
 * @returns true if a like was performed
 */
export async function tryCompanionLike(tabId: number): Promise<boolean> {
  // 前置检查
  if (!config.enabled) return false

  // 日期切换 → 重置
  const today = new Date().toISOString().slice(0, 10)
  if (state.todayDate !== today) {
    state.dailyCount = 0
    state.todayDate = today
  }

  // 每日上限
  if (state.dailyCount >= config.dailyLimit) return false

  // 概率判定
  if (Math.random() > config.probability) return false

  // 间隔检查
  if (state.lastLikedAt) {
    const gapSec = (Date.now() - state.lastLikedAt) / 1000
    if (gapSec < config.minGapSec) return false
  }

  // 执行点赞
  try {
    const cookies = await getXCookies()
    if (!cookies) return false

    // 从页面获取可见推文的 tweet ID
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

/** 恢复状态 (启动时调用) */
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
      // 日期切换
      const today = new Date().toISOString().slice(0, 10)
      if (state.todayDate !== today) {
        state.dailyCount = 0
        state.todayDate = today
      }
    }
  } catch { /* ignore */ }
}

// ===== 内部函数 =====

/** 从页面可见推文中随机选一个的 tweet ID */
async function pickRandomVisibleTweet(tabId: number): Promise<string | null> {
  try {
    // 让 content script 扫描可见推文
    const res = await chrome.tabs.sendMessage(tabId, { type: 'LIKE_PICK_TWEET' })
    if (res?.success && res.data?.tweetId) {
      return res.data.tweetId
    }
  } catch { /* content script not ready */ }
  return null
}

async function saveState(): Promise<void> {
  try {
    await chrome.storage.local.set({
      like_auto_state: state,
      like_auto_config: config,
    })
  } catch { /* ignore */ }
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
  } catch { /* ignore */ }
}
