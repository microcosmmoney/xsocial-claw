/**
 * 关注自动化引擎 — 三模式智能关注
 *
 * 模式 A (homepage): 首页滚动，发现含"蓝V"关键词的帖子，关注发帖者
 * 模式 B (detail):   首页找到回帖>20的蓝V帖 → 进入详情 → 滚到底 → 从底向上关注回帖者
 * 模式 C (mixed):    随机切换 A/B
 *
 * 安全策略:
 *   - 每次会话最多关注 12 人
 *   - 每日最多 200 人
 *   - 每小时随机时间启动 (避免整点)
 *   - 关注间停顿 (高斯随机 5-15 秒)
 *   - 详情页连续 5 个已关注 → 退出
 *   - 遇 403 立即停止
 */

import type { FollowMode, FollowAutoConfig, FollowSessionState, FollowLogEntry, ScannedTweet, ScannedReply } from '@shared/types'
import { BEARER_TOKEN } from '@shared/constants'
import { getXCookies, followByScreenName } from './x-api'
import { tryCompanionLike } from './like-companion'
import { gaussianDelay, humanDelay, isActiveHours, sleep } from '@utils/delay'
import { logger } from '@utils/logger'

// ===== 默认配置 =====

const DEFAULT_CONFIG: FollowAutoConfig = {
  mode: 'mixed',
  sessionLimit: 12,
  dailyLimit: 200,
  activeHoursStart: 8,
  activeHoursEnd: 23,
  detailMinReplies: 20,
  consecutiveFollowedExit: 5,
}

// ===== 内部状态 =====

let state: FollowSessionState = createEmptyState()
let config: FollowAutoConfig = { ...DEFAULT_CONFIG }
let running = false
let stopRequested = false
let schedulerTimer: ReturnType<typeof setTimeout> | null = null

function createEmptyState(): FollowSessionState {
  return {
    status: 'idle',
    mode: 'mixed',
    sessionFollowed: 0,
    sessionTarget: 12,
    dailyFollowed: 0,
    dailyTarget: 200,
    currentPhase: '',
    nextSessionTime: null,
    log: [],
    startedAt: null,
    todayDate: new Date().toISOString().slice(0, 10),
  }
}

// ===== 公共 API =====

export function getFollowAutoState(): FollowSessionState {
  return { ...state }
}

export function getFollowAutoConfig(): FollowAutoConfig {
  return { ...config }
}

export function updateFollowAutoConfig(partial: Partial<FollowAutoConfig>): void {
  config = { ...config, ...partial }
  state.sessionTarget = config.sessionLimit
  state.dailyTarget = config.dailyLimit
  state.mode = config.mode
  saveState()
}

/** 启动自动化 (开始调度) */
export async function startFollowAutomation(cfg?: Partial<FollowAutoConfig>): Promise<void> {
  if (cfg) updateFollowAutoConfig(cfg)

  // 日期变化 → 重置每日计数
  const today = new Date().toISOString().slice(0, 10)
  if (state.todayDate !== today) {
    state.dailyFollowed = 0
    state.todayDate = today
    state.log = []
  }

  if (state.dailyFollowed >= config.dailyLimit) {
    state.status = 'completed'
    state.currentPhase = `今日已达上限 ${config.dailyLimit}`
    saveState()
    return
  }

  state.status = 'waiting'
  state.currentPhase = '等待下一轮...'
  stopRequested = false
  saveState()

  // 立即开始第一轮
  scheduleNextSession(true)
}

/** 暂停自动化 */
export function pauseFollowAutomation(): void {
  stopRequested = true
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
  state.status = 'paused'
  state.currentPhase = '已暂停'
  state.nextSessionTime = null
  saveState()
}

/** 恢复状态 (从 storage) */
export async function restoreFollowState(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('follow_auto_state')
    if (result.follow_auto_state) {
      state = { ...createEmptyState(), ...result.follow_auto_state }
      // 日期变化 → 重置
      const today = new Date().toISOString().slice(0, 10)
      if (state.todayDate !== today) {
        state.dailyFollowed = 0
        state.todayDate = today
        state.log = []
      }
    }
    const cfgResult = await chrome.storage.local.get('follow_auto_config')
    if (cfgResult.follow_auto_config) {
      config = { ...DEFAULT_CONFIG, ...cfgResult.follow_auto_config }
    }
  } catch { /* ignore */ }
}

// ===== 调度器 =====

function scheduleNextSession(immediate = false): void {
  if (stopRequested) return

  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  if (immediate) {
    // 首次启动: 延迟 3-10 秒后开始 (不那么突兀)
    const delay = gaussianDelay(3_000, 10_000)
    state.nextSessionTime = Date.now() + delay
    state.currentPhase = `${Math.ceil(delay / 1000)}秒后开始...`
    saveState()
    schedulerTimer = setTimeout(() => runSession(), delay)
    return
  }

  // 在当前小时的随机偏移位置调度下一轮
  // 基础间隔 45-75 分钟 (高斯分布, 均值 60 分钟)
  const baseInterval = gaussianDelay(45 * 60_000, 75 * 60_000)
  // 再叠加 0-10 分钟随机漂移 (打散整点)
  const jitter = Math.floor(Math.random() * 10 * 60_000)
  const totalDelay = baseInterval + jitter

  state.nextSessionTime = Date.now() + totalDelay
  state.status = 'waiting'
  state.currentPhase = `下一轮: ${new Date(state.nextSessionTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  saveState()

  logger.info(`[FollowAuto] 下一轮调度: ${Math.ceil(totalDelay / 60_000)} 分钟后`)
  schedulerTimer = setTimeout(() => runSession(), totalDelay)
}

// ===== 会话执行 =====

async function runSession(): Promise<void> {
  if (stopRequested || running) return

  // 检查活跃时段
  if (!isActiveHours(config.activeHoursStart, config.activeHoursEnd)) {
    logger.info('[FollowAuto] 非活跃时段, 跳过')
    state.currentPhase = '非活跃时段，等待中'
    scheduleNextSession()
    return
  }

  // 检查每日上限
  if (state.dailyFollowed >= config.dailyLimit) {
    state.status = 'completed'
    state.currentPhase = `今日已达上限 ${config.dailyLimit}`
    saveState()
    return
  }

  running = true
  state.status = 'running'
  state.sessionFollowed = 0
  state.startedAt = Date.now()
  saveState()

  try {
    // 决定本轮模式
    const sessionMode = pickSessionMode()
    logger.info(`[FollowAuto] 会话开始, 模式: ${sessionMode}`)

    if (sessionMode === 'homepage') {
      await runHomepageMode()
    } else {
      await runDetailMode()
    }
  } catch (err: any) {
    logger.error('[FollowAuto] 会话异常:', err)
    state.currentPhase = `异常: ${err.message}`
  } finally {
    running = false
    state.startedAt = null

    if (!stopRequested && state.dailyFollowed < config.dailyLimit) {
      scheduleNextSession()
    } else if (state.dailyFollowed >= config.dailyLimit) {
      state.status = 'completed'
      state.currentPhase = `今日已完成 ${state.dailyFollowed}/${config.dailyLimit}`
    }

    saveState()
    await incrementKpi('follows', state.sessionFollowed)
  }
}

function pickSessionMode(): 'homepage' | 'detail' {
  if (config.mode === 'homepage') return 'homepage'
  if (config.mode === 'detail') return 'detail'
  // mixed: 60% homepage, 40% detail (首页更快)
  return Math.random() < 0.6 ? 'homepage' : 'detail'
}

// ===== 模式 A: 首页滚动关注 =====

async function runHomepageMode(): Promise<void> {
  state.currentPhase = '首页滚动中...'
  saveState()

  const cookies = await getXCookies()
  if (!cookies) {
    state.currentPhase = '未登录 X'
    return
  }

  // 确保在首页
  const tabId = await ensureHomePage()
  if (!tabId) {
    state.currentPhase = '无法打开 X 首页'
    return
  }

  const followedHandles = new Set<string>()
  let scrollRounds = 0
  const maxScrollRounds = 30 // 最多滚 30 屏

  while (state.sessionFollowed < config.sessionLimit && scrollRounds < maxScrollRounds && !stopRequested) {
    // 扫描当前可见推文
    const scanRes = await sendToTab(tabId, { type: 'FOLLOW_SCAN_TWEETS' })
    if (!scanRes?.success) break

    const tweets: ScannedTweet[] = scanRes.data || []

    // 找含"蓝V"关键词的帖子
    const blueVTweets = tweets.filter(t => t.hasBlueVKeyword && !followedHandles.has(t.handle))

    for (const tweet of blueVTweets) {
      if (state.sessionFollowed >= config.sessionLimit || stopRequested) break
      if (followedHandles.has(tweet.handle)) continue

      state.currentPhase = `首页关注 @${tweet.handle}...`
      saveState()

      const result = await followByScreenName(cookies, tweet.handle)
      followedHandles.add(tweet.handle)

      const entry: FollowLogEntry = {
        handle: tweet.handle,
        success: result.success,
        source: 'homepage',
        timestamp: Date.now(),
        error: result.error,
      }
      addLog(entry)

      if (result.success) {
        state.sessionFollowed++
        state.dailyFollowed++
      }

      // 403 → 立即停止
      if (result.error?.includes('403')) {
        state.currentPhase = '403 风控, 立即停止'
        return
      }

      // 关注间停顿 (5-15 秒, 高斯分布)
      if (state.sessionFollowed < config.sessionLimit) {
        const pause = gaussianDelay(5_000, 15_000)
        state.currentPhase = `等待 ${Math.ceil(pause / 1000)}s...`
        saveState()
        await sleep(pause)

        // 伴随点赞 (概率触发)
        await tryCompanionLike(tabId)
      }
    }

    // 滚动一屏
    const scrollRes = await sendToTab(tabId, { type: 'FOLLOW_SCROLL_DOWN' })
    scrollRounds++

    if (scrollRes?.data?.atBottom) {
      logger.info('[FollowAuto] 已到页面底部')
      break
    }

    // 滚动后等一下 (模拟阅读)
    await sleep(gaussianDelay(1_500, 3_000))
  }

  state.currentPhase = `首页关注完成: ${state.sessionFollowed}/${config.sessionLimit}`
}

// ===== 模式 B: 详情页关注 =====

async function runDetailMode(): Promise<void> {
  state.currentPhase = '寻找蓝V互关帖...'
  saveState()

  const cookies = await getXCookies()
  if (!cookies) {
    state.currentPhase = '未登录 X'
    return
  }

  const tabId = await ensureHomePage()
  if (!tabId) {
    state.currentPhase = '无法打开 X 首页'
    return
  }

  let scrollRounds = 0
  const maxScrollRounds = 40
  let enteredDetailCount = 0

  while (state.sessionFollowed < config.sessionLimit && scrollRounds < maxScrollRounds && !stopRequested) {
    // 扫描推文
    const scanRes = await sendToTab(tabId, { type: 'FOLLOW_SCAN_TWEETS' })
    if (!scanRes?.success) break

    const tweets: ScannedTweet[] = scanRes.data || []

    // 找蓝V帖且回帖 >= 20
    const targetTweet = tweets.find(t =>
      t.hasBlueVKeyword &&
      t.replyCount >= config.detailMinReplies &&
      t.tweetLinkRef
    )

    if (targetTweet) {
      logger.info(`[FollowAuto] 发现目标帖: @${targetTweet.handle} (${targetTweet.replyCount} 回帖)`)
      state.currentPhase = `进入 @${targetTweet.handle} 的帖子...`
      saveState()

      // 进入详情页
      const enterRes = await sendToTab(tabId, {
        type: 'FOLLOW_ENTER_DETAIL',
        payload: { ref: targetTweet.tweetLinkRef },
      })

      if (enterRes?.success) {
        enteredDetailCount++

        // 在详情页执行关注
        await runDetailPageFollows(tabId, cookies)

        // 回到首页
        state.currentPhase = '返回首页...'
        saveState()
        await sendToTab(tabId, { type: 'FOLLOW_GO_HOME' })
        await sleep(gaussianDelay(2_000, 4_000))
      }
    } else {
      // 没找到目标帖 → 在 mixed 模式下随机做几个首页关注
      if (config.mode === 'mixed' && Math.random() < 0.3) {
        const blueVTweet = tweets.find(t => t.hasBlueVKeyword)
        if (blueVTweet) {
          state.currentPhase = `顺手关注 @${blueVTweet.handle}...`
          saveState()
          const result = await followByScreenName(cookies, blueVTweet.handle)
          addLog({ handle: blueVTweet.handle, success: result.success, source: 'homepage', timestamp: Date.now(), error: result.error })
          if (result.success) { state.sessionFollowed++; state.dailyFollowed++ }
          if (result.error?.includes('403')) return
          await sleep(gaussianDelay(5_000, 15_000))
        }
      }
    }

    // 继续滚动
    const scrollRes = await sendToTab(tabId, { type: 'FOLLOW_SCROLL_DOWN' })
    scrollRounds++
    if (scrollRes?.data?.atBottom) break
    await sleep(gaussianDelay(1_500, 3_000))
  }

  state.currentPhase = `详情模式完成: ${state.sessionFollowed}/${config.sessionLimit}, 进入${enteredDetailCount}个帖子`
}

/** 在详情页内: 滚到底 → 从底部往上关注回帖者 */
async function runDetailPageFollows(tabId: number, cookies: any): Promise<void> {
  // 1. 人类模式滚到底部
  state.currentPhase = '详情页: 滚动到底部...'
  saveState()
  await sendToTab(tabId, { type: 'FOLLOW_SCROLL_TO_BOTTOM' })
  await sleep(gaussianDelay(1_000, 2_000))

  // 2. 扫描回帖者 (已按底→顶排序)
  const repliesRes = await sendToTab(tabId, { type: 'FOLLOW_SCAN_REPLIES' })
  if (!repliesRes?.success) return

  const replies: ScannedReply[] = repliesRes.data || []
  if (replies.length === 0) return

  logger.info(`[FollowAuto] 详情页发现 ${replies.length} 个回帖者`)

  // 3. 批量查询关注状态 (100人/批)
  const handles = replies.map(r => r.handle)
  const alreadyFollowing = await batchCheckFollowing(cookies, handles)

  // 4. 从底部向上关注
  let consecutiveFollowed = 0

  for (const reply of replies) {
    if (state.sessionFollowed >= config.sessionLimit || stopRequested) break

    // 已关注检测
    if (alreadyFollowing.has(reply.handle)) {
      consecutiveFollowed++
      if (consecutiveFollowed >= config.consecutiveFollowedExit) {
        logger.info(`[FollowAuto] 连续 ${consecutiveFollowed} 个已关注, 退出详情页`)
        state.currentPhase = `连续${consecutiveFollowed}个已关注, 退出`
        saveState()
        return
      }
      continue
    }

    consecutiveFollowed = 0 // 重置连续计数

    // 滚动到该回帖位置 (人看得到)
    await sendToTab(tabId, { type: 'FOLLOW_SCROLL_TO', payload: { ref: reply.articleRef } })

    state.currentPhase = `详情页关注 @${reply.handle}...`
    saveState()

    const result = await followByScreenName(cookies, reply.handle)
    addLog({ handle: reply.handle, success: result.success, source: 'detail', timestamp: Date.now(), error: result.error })

    if (result.success) {
      state.sessionFollowed++
      state.dailyFollowed++
    }

    if (result.error?.includes('403')) {
      state.currentPhase = '403 风控, 停止'
      return
    }

    // 关注间停顿
    if (state.sessionFollowed < config.sessionLimit) {
      const pause = gaussianDelay(5_000, 15_000)
      state.currentPhase = `等待 ${Math.ceil(pause / 1000)}s...`
      saveState()
      await sleep(pause)

      // 伴随点赞 (概率触发)
      await tryCompanionLike(tabId)
    }
  }
}

// ===== 工具函数 =====

/** 批量检查哪些 handle 已经在关注列表 */
async function batchCheckFollowing(cookies: any, handles: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  try {
    // 先通过 screen_name 解析出 userId (批量)
    // 用 lookupFriendships 检查关系 — 但它需要 userId
    // 简化: 用 users/show 逐个查太慢; 改用 lookupFriendships 的 screen_name 模式
    // Twitter API 的 friendships/lookup 也支持 screen_name 参数
    const batchSize = 100
    for (let i = 0; i < handles.length; i += batchSize) {
      const batch = handles.slice(i, i + batchSize)
      const params = new URLSearchParams({ screen_name: batch.join(',') })
      try {
        const resp = await fetch(
          `https://x.com/i/api/1.1/friendships/lookup.json?${params}`,
          {
            method: 'GET',
            headers: {
              authorization: `Bearer ${BEARER_TOKEN}`,
              'x-csrf-token': cookies.ct0,
              cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
              'x-twitter-active-user': 'yes',
            },
          }
        )
        if (resp.ok) {
          const data = await resp.json()
          for (const item of data) {
            if (item.connections?.includes('following')) {
              result.add(item.screen_name?.toLowerCase())
            }
          }
        }
      } catch { /* ignore batch error */ }
      if (i + batchSize < handles.length) await sleep(1000)
    }
  } catch (err) {
    logger.warn('[FollowAuto] 批量查询关注状态失败:', err)
  }
  // 返回的 set 用小写比较
  return result
}

/** 确保有一个 x.com 的 tab 并在首页 */
async function ensureHomePage(): Promise<number | null> {
  // 找现有 x.com tab
  const xTabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] })
  if (xTabs.length > 0 && xTabs[0].id) {
    // 如果不在首页, 导航到首页
    const tab = xTabs[0]
    if (!tab.url?.includes('/home')) {
      await chrome.tabs.update(tab.id!, { url: 'https://x.com/home' })
      await waitForTabLoad(tab.id!)
    }
    return tab.id!
  }

  // 创建新 tab
  const newTab = await chrome.tabs.create({ url: 'https://x.com/home', active: false })
  if (newTab.id) {
    await waitForTabLoad(newTab.id)
    return newTab.id
  }
  return null
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 15_000)

    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        clearTimeout(timeout)
        // 额外等一下让 content script 注入
        setTimeout(resolve, 1500)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function sendToTab(tabId: number, message: any): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    logger.error('[FollowAuto] sendToTab error:', err)
    return { success: false, error: 'Content script not ready' }
  }
}

function addLog(entry: FollowLogEntry): void {
  state.log = [entry, ...state.log].slice(0, 50)
  saveState()
}

async function saveState(): Promise<void> {
  try {
    await chrome.storage.local.set({
      follow_auto_state: state,
      follow_auto_config: config,
    })
  } catch { /* ignore */ }
}

async function incrementKpi(field: string, count: number): Promise<void> {
  if (count <= 0) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const store = await chrome.storage.local.get('daily_kpi')
    const kpi = store.daily_kpi || {}
    if (kpi.date !== today) {
      Object.keys(kpi).forEach(k => { if (k !== 'date') kpi[k] = 0 })
      kpi.date = today
    }
    kpi[field] = (kpi[field] || 0) + count
    await chrome.storage.local.set({ daily_kpi: kpi })
  } catch { /* ignore */ }
}
