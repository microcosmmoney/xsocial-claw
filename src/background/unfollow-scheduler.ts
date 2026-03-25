// Developed by AI Agent


import { XSOCIAL_API, UNFOLLOW_LIMITS } from '@shared/constants'
import { STORAGE_KEYS } from '@shared/types'
import type { UnfollowTaskState, UnfollowConfig, NonFollowerEntry, UnfollowAction } from '@shared/types'
import { getXCookies, getFollowingIds, getFollowerIds, unfollowUser } from './x-api'
import { gaussianDelay, humanDelay, isActiveHours, sleep } from '@utils/delay'
import { logger } from '@utils/logger'


let currentTask: UnfollowTaskState | null = null
let isRunning = false
let stopRequested = false


export function getUnfollowStatus(): UnfollowTaskState | null {
  return currentTask
}


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

  
  const followerSet = new Set(followerIds)
  const nonFollowerIds = followingIds.filter(id => !followerSet.has(id))

  const nonFollowers: NonFollowerEntry[] = nonFollowerIds.map(id => ({
    userId: id,
  }))

  logger.info(`[Unfollow] 扫描完成: 关注${followingIds.length}, 粉丝${followerIds.length}, 未回关${nonFollowers.length}`)

  
  await reportScan(token, taskId, nonFollowers, followingIds.length, followerIds.length)

  return {
    nonFollowers,
    totalFollowing: followingIds.length,
    totalFollowers: followerIds.length,
  }
}


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

      
      if (!isActiveHours()) {
        logger.info('[Unfollow] 非活跃时段, 暂停')
        currentTask.status = 'paused'
        break
      }

      
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

        
        if (result.error?.includes('403')) {
          logger.error('[Unfollow] 403 Forbidden — 立即停止')
          currentTask.status = 'paused'
          break
        }
      }

      
      if (pendingActions.length >= UNFOLLOW_LIMITS.progressReportInterval) {
        await reportProgress(token, taskId, currentTask, pendingActions)
        pendingActions.length = 0
      }

      
      await saveState()

      
      if (i < nonFollowers.length - 1) {
        await humanDelay(config.delayMin, config.delayMax)
      }
    }

    
    if (currentTask.lastProcessedIndex >= nonFollowers.length) {
      currentTask.status = 'completed'
    }
  } catch (err: any) {
    logger.error('[Unfollow] 执行异常:', err)
    currentTask.status = 'error'
  } finally {
    
    if (pendingActions.length > 0) {
      await reportProgress(token, taskId, currentTask, pendingActions)
    }
    isRunning = false
    await saveState()
  }
}


export function pauseUnfollow(): void {
  stopRequested = true
  if (currentTask) {
    currentTask.status = 'paused'
  }
}


export async function restoreState(): Promise<UnfollowTaskState | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.unfollowTask)
    const state = result[STORAGE_KEYS.unfollowTask]
    if (state) {
      currentTask = state
      return state
    }
  } catch {
    
  }
  return null
}


async function saveState(): Promise<void> {
  if (currentTask) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.unfollowTask]: currentTask })
    } catch {
      
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
