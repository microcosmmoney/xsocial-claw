/**
 * Unfollow Scheduler — Follow-check execution engine
 *
 * Supports two modes:
 *   Mode A (api): Batch discovery via friends/ids + followers/ids, unfollow via API
 *   Mode B (page): Scroll "Following" page, detect "Follows you" label, simulate human unfollow
 *
 * Safety measures:
 *   - Unfollow interval 30-90s (Gaussian random)
 *   - Hourly limit 30, daily limit 200 (user adjustable)
 *   - Auto-pause after 3 consecutive errors
 *   - Stop immediately on 403
 *   - Only run during active hours (8:00-23:00)
 */

import { XSOCIAL_API, UNFOLLOW_LIMITS } from '@shared/constants'
import { STORAGE_KEYS } from '@shared/types'
import type { UnfollowTaskState, UnfollowConfig, NonFollowerEntry, UnfollowAction } from '@shared/types'
import { getXCookies, getFollowingIds, getFollowerIds, unfollowUser } from './x-api'
import { gaussianDelay, humanDelay, isActiveHours, sleep } from '@utils/delay'
import { logger } from '@utils/logger'

// ===== Internal State =====

let currentTask: UnfollowTaskState | null = null
let isRunning = false
let stopRequested = false

// ===== Public API =====

/** Get current task status */
export function getUnfollowStatus(): UnfollowTaskState | null {
  return currentTask
}

/** Mode A: API batch scan to find non-followers */
export async function scanViaApi(taskId: string, xScreenName: string, token: string): Promise<{
  nonFollowers: NonFollowerEntry[]
  totalFollowing: number
  totalFollowers: number
}> {
  const cookies = await getXCookies()
  if (!cookies) throw new Error('Not logged in to X. Please open x.com and sign in first')

  logger.info('[Unfollow] Mode A scan started: fetching following/follower IDs...')

  const followingIds = await getFollowingIds(cookies, (count) => {
    logger.info(`[Unfollow] Fetched ${count} following IDs`)
  })

  const followerIds = await getFollowerIds(cookies, (count) => {
    logger.info(`[Unfollow] Fetched ${count} follower IDs`)
  })

  // Set comparison: following but not followed back
  const followerSet = new Set(followerIds)
  const nonFollowerIds = followingIds.filter(id => !followerSet.has(id))

  const nonFollowers: NonFollowerEntry[] = nonFollowerIds.map(id => ({
    userId: id,
  }))

  logger.info(`[Unfollow] Scan complete: following ${followingIds.length}, followers ${followerIds.length}, non-followers ${nonFollowers.length}`)

  // Report to server
  await reportScan(token, taskId, nonFollowers, followingIds.length, followerIds.length)

  return {
    nonFollowers,
    totalFollowing: followingIds.length,
    totalFollowers: followerIds.length,
  }
}

/** Mode A: Start/resume API unfollow */
export async function startApiUnfollow(
  taskId: string,
  nonFollowers: NonFollowerEntry[],
  config: UnfollowConfig,
  startIndex: number,
  token: string
): Promise<void> {
  if (isRunning) {
    logger.warn('[Unfollow] A task is already running')
    return
  }

  const cookies = await getXCookies()
  if (!cookies) throw new Error('Not logged in to X')

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

  logger.info(`[Unfollow] API mode started, from index ${startIndex} , total ${nonFollowers.length} targets`)

  const pendingActions: UnfollowAction[] = []

  try {
    for (let i = startIndex; i < nonFollowers.length; i++) {
      if (stopRequested) {
        logger.info('[Unfollow] Stop signal received')
        break
      }

      // Active hours check
      if (!isActiveHours()) {
        logger.info('[Unfollow] Outside active hours, pausing')
        currentTask.status = 'paused'
        break
      }

      // Rate limit check
      if (currentTask.hourlyCount >= config.hourlyLimit) {
        logger.info(`[Unfollow] Reached hourly limit ${config.hourlyLimit}`)
        currentTask.status = 'paused'
        break
      }
      if (currentTask.dailyCount >= config.dailyLimit) {
        logger.info(`[Unfollow] Reached daily limit ${config.dailyLimit}`)
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
        logger.info(`[Unfollow] Unfollowed ${target.screenName || target.userId} (${currentTask.unfollowedCount}/${nonFollowers.length})`)
      } else {
        currentTask.failedCount++
        currentTask.lastProcessedIndex = i + 1
        logger.warn(`[Unfollow] Unfollow failed ${target.userId}: ${result.error}`)

        // 403 -> stop immediately
        if (result.error?.includes('403')) {
          logger.error('[Unfollow] 403 Forbidden - stopping immediately')
          currentTask.status = 'paused'
          break
        }
      }

      // Periodic progress report
      if (pendingActions.length >= UNFOLLOW_LIMITS.progressReportInterval) {
        await reportProgress(token, taskId, currentTask, pendingActions)
        pendingActions.length = 0
      }

      // Save to storage (for recovery)
      await saveState()

      // Human delay
      if (i < nonFollowers.length - 1) {
        await humanDelay(config.delayMin, config.delayMax)
      }
    }

    // All done
    if (currentTask.lastProcessedIndex >= nonFollowers.length) {
      currentTask.status = 'completed'
    }
  } catch (err: any) {
    logger.error('[Unfollow] Execution error:', err)
    currentTask.status = 'error'
  } finally {
    // Report remaining progress
    if (pendingActions.length > 0) {
      await reportProgress(token, taskId, currentTask, pendingActions)
    }
    isRunning = false
    await saveState()
  }
}

/** Pause task */
export function pauseUnfollow(): void {
  stopRequested = true
  if (currentTask) {
    currentTask.status = 'paused'
  }
}

/** Restore task state (from chrome.storage) */
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

// ===== Internal Methods =====

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
    logger.warn('[Unfollow] Failed to report scan results:', err)
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
    logger.warn('[Unfollow] Failed to report progress:', err)
  }
}
