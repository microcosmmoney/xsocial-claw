/**
 * 取关调度器 — 回关检查核心执行引擎
 *
 * 支持两种模式:
 *   方案A (api): 用 friends/ids + followers/ids 批量发现, unfollowUser API 取关
 *   方案B (page): 在"正在关注"页面滚动, 检测"关注了你"标签, 模拟真人取关
 *
 * 安全策略:
 *   - 取关间隔 30-90 秒 (高斯随机)
 *   - 每小时上限 30, 每日上限 200 (用户可调低)
 *   - 连续 3 次错误自动暂停
 *   - 遇 403 立即停止
 *   - 仅活跃时段 (8:00-23:00) 运行
 */

import { XSOCIAL_API, UNFOLLOW_LIMITS } from '@shared/constants'
import { STORAGE_KEYS } from '@shared/types'
import type { UnfollowTaskState, UnfollowConfig, NonFollowerEntry, UnfollowAction } from '@shared/types'
import { getXCookies, getFollowingIds, getFollowerIds, unfollowUser } from './x-api'
import { gaussianDelay, humanDelay, isActiveHours, sleep } from '@utils/delay'
import { logger } from '@utils/logger'

// ===== 内部状态 =====

let currentTask: UnfollowTaskState | null = null
let isRunning = false
let stopRequested = false

// ===== 公共 API =====

/** 获取当前任务状态 */
export function getUnfollowStatus(): UnfollowTaskState | null {
  return currentTask
}

/** 方案A: API 批量扫描发现非回关者 */
export async function scanViaApi(taskId: string, xScreenName: string, token: string): Promise<{
  nonFollowers: NonFollowerEntry[]
  totalFollowing: number
  totalFollowers: number
}> {
  const cookies = await getXCookies()
  if (!cookies) throw new Error('未登录 X，请先在浏览器打开 x.com 并登录')

  logger.info('[Unfollow] 方案A扫描开始: 拉取关注/粉丝 ID...')

  const followingIds = await getFollowingIds(cookies, (count) => {
    logger.info(`[Unfollow] 已获取 ${count} 个关注 ID`)
  })

  const followerIds = await getFollowerIds(cookies, (count) => {
    logger.info(`[Unfollow] 已获取 ${count} 个粉丝 ID`)
  })

  // 集合对比: 关注了但没被回关
  const followerSet = new Set(followerIds)
  const nonFollowerIds = followingIds.filter(id => !followerSet.has(id))

  const nonFollowers: NonFollowerEntry[] = nonFollowerIds.map(id => ({
    userId: id,
  }))

  logger.info(`[Unfollow] 扫描完成: 关注${followingIds.length}, 粉丝${followerIds.length}, 未回关${nonFollowers.length}`)

  // 上报服务端
  await reportScan(token, taskId, nonFollowers, followingIds.length, followerIds.length)

  return {
    nonFollowers,
    totalFollowing: followingIds.length,
    totalFollowers: followerIds.length,
  }
}

/** 方案A: 启动/恢复 API 模式取关 */
export async function startApiUnfollow(
  taskId: string,
  nonFollowers: NonFollowerEntry[],
  config: UnfollowConfig,
  startIndex: number,
  token: string
): Promise<void> {
  if (isRunning) {
    logger.warn('[Unfollow] 已有任务在运行')
    return
  }

  const cookies = await getXCookies()
  if (!cookies) throw new Error('未登录 X')

  currentTask = {
    taskId,
    status: 'running',
    scanMode: 'api',
    xScreenName: '',
    nonFollowers,
    nonFollowerCount: nonFollowers.length,
    unfollowedCount: 0,
    failedCount: 0,
    lastProcessedIndex: startIndex,
    config,
    hourlyCount: 0,
    dailyCount: 0,
    recentActions: [],
  }

  isRunning = true
  stopRequested = false

  logger.info(`[Unfollow] API模式启动, 从第 ${startIndex} 个开始, 共 ${nonFollowers.length} 个目标`)

  const pendingActions: UnfollowAction[] = []

  try {
    for (let i = startIndex; i < nonFollowers.length; i++) {
      if (stopRequested) {
        logger.info('[Unfollow] 收到停止指令')
        break
      }

      // 活跃时段检查
      if (!isActiveHours()) {
        logger.info('[Unfollow] 非活跃时段, 暂停')
        currentTask.status = 'paused'
        break
      }

      // 频率检查
      if (currentTask.hourlyCount >= config.hourlyLimit) {
        logger.info(`[Unfollow] 达到每小时上限 ${config.hourlyLimit}`)
        currentTask.status = 'paused'
        break
      }
      if (currentTask.dailyCount >= config.dailyLimit) {
        logger.info(`[Unfollow] 达到每日上限 ${config.dailyLimit}`)
        currentTask.status = 'paused'
        break
      }

      const target = nonFollowers[i]
      const result = await unfollowUser(cookies, target.userId)

      const action: UnfollowAction = {
        userId: target.userId,
        screenName: target.screenName,
        success: result.success,
        timestamp: Date.now(),
        error: result.error,
      }
      pendingActions.push(action)
      currentTask.recentActions = [...currentTask.recentActions, action].slice(-20)

      if (result.success) {
        currentTask.unfollowedCount++
        currentTask.hourlyCount++
        currentTask.dailyCount++
        currentTask.lastProcessedIndex = i + 1
        logger.info(`[Unfollow] ✓ 取关 ${target.screenName || target.userId} (${currentTask.unfollowedCount}/${nonFollowers.length})`)
      } else {
        currentTask.failedCount++
        currentTask.lastProcessedIndex = i + 1
        logger.warn(`[Unfollow] ✗ 取关失败 ${target.userId}: ${result.error}`)

        // 403 → 立即停止
        if (result.error?.includes('403')) {
          logger.error('[Unfollow] 403 Forbidden — 立即停止')
          currentTask.status = 'paused'
          break
        }
      }

      // 定期上报进度
      if (pendingActions.length >= UNFOLLOW_LIMITS.progressReportInterval) {
        await reportProgress(token, taskId, currentTask, pendingActions)
        pendingActions.length = 0
      }

      // 保存到 storage (恢复用)
      await saveState()

      // 人类延迟
      if (i < nonFollowers.length - 1) {
        await humanDelay(config.delayMin, config.delayMax)
      }
    }

    // 全部完成
    if (currentTask.lastProcessedIndex >= nonFollowers.length) {
      currentTask.status = 'completed'
    }
  } catch (err: any) {
    logger.error('[Unfollow] 执行异常:', err)
    currentTask.status = 'error'
  } finally {
    // 上报剩余进度
    if (pendingActions.length > 0) {
      await reportProgress(token, taskId, currentTask, pendingActions)
    }
    isRunning = false
    await saveState()
  }
}

/** 暂停任务 */
export function pauseUnfollow(): void {
  stopRequested = true
  if (currentTask) {
    currentTask.status = 'paused'
  }
}

/** 恢复任务状态 (从 chrome.storage) */
export async function restoreState(): Promise<UnfollowTaskState | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.unfollowTask)
    const state = result[STORAGE_KEYS.unfollowTask]
    if (state) {
      currentTask = state
      return state
    }
  } catch {
    // ignore
  }
  return null
}

// ===== 内部方法 =====

async function saveState(): Promise<void> {
  if (currentTask) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.unfollowTask]: currentTask })
    } catch {
      // ignore
    }
  }
}

async function reportScan(
  token: string,
  taskId: string,
  nonFollowers: NonFollowerEntry[],
  totalFollowing: number,
  totalFollowers: number
): Promise<void> {
  try {
    await fetch(`${XSOCIAL_API}/api/market/manager/x-maintenance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ taskId, nonFollowers, totalFollowing, totalFollowers }),
    })
  } catch (err) {
    logger.warn('[Unfollow] 上报扫描结果失败:', err)
  }
}

async function reportProgress(
  token: string,
  taskId: string,
  state: UnfollowTaskState,
  actions: UnfollowAction[]
): Promise<void> {
  try {
    await fetch(`${XSOCIAL_API}/api/market/manager/x-maintenance/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        taskId,
        unfollowedCount: state.unfollowedCount,
        failedCount: state.failedCount,
        lastProcessedIndex: state.lastProcessedIndex,
        actionLog: actions,
        completed: state.status === 'completed',
      }),
    })
  } catch (err) {
    logger.warn('[Unfollow] 上报进度失败:', err)
  }
}
