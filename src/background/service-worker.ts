/**
 * xSocial v4 Chrome Extension — Background Service Worker
 *
 * v4 Architecture: Server (brain) + Browser (hands) = Smart Claw
 * - WebSocket persistent connection to xSocial WS server
 * - Receives task:execute / step:next commands, forwards to content script
 * - Reports execution results + accessibility tree snapshot via step:result
 * - Retains Twitter internal API capabilities from x-api.ts
 */

import { XSOCIAL_API, XSOCIAL_WS } from '@shared/constants'
import { STORAGE_KEYS } from '@shared/types'
import { logger } from '@utils/logger'
import { getXCookies, getAuthenticatedUser, followUser, unfollowUser, createTweet, likeTweet, retweet } from './x-api'
import { scanViaApi, startApiUnfollow, pauseUnfollow, getUnfollowStatus, restoreState } from './unfollow-scheduler'

// ===== Persistent Storage (chrome.storage.sync — survives uninstall/reinstall) =====

const SYNC_KEYS = ['device_id', 'device_name', 'node_code', 'is_bound', 'bound_user_id', 'xsocial_token'] as const

/** On startup, restore from sync to local (sync takes priority; local is cleared on reinstall but sync persists) */
async function restoreFromSync(): Promise<void> {
  try {
    const synced = await chrome.storage.sync.get(SYNC_KEYS as unknown as string[])
    const local = await chrome.storage.local.get(SYNC_KEYS as unknown as string[])

    const toRestore: Record<string, unknown> = {}
    for (const key of SYNC_KEYS) {
      if (synced[key] !== undefined && local[key] === undefined) {
        toRestore[key] = synced[key]
      }
    }

    if (Object.keys(toRestore).length > 0) {
      await chrome.storage.local.set(toRestore)
      logger.info(`[SW] Restored ${Object.keys(toRestore).length} items from sync: ${Object.keys(toRestore).join(', ')}`)
    }
  } catch (err) {
    logger.error('[SW] sync restore failed:', err)
  }
}

/** Sync critical data to chrome.storage.sync (persists across uninstall) */
async function saveToSync(data: Record<string, unknown>): Promise<void> {
  try {
    const syncData: Record<string, unknown> = {}
    for (const key of SYNC_KEYS) {
      if (key in data) syncData[key] = data[key]
    }
    if (Object.keys(syncData).length > 0) {
      await chrome.storage.sync.set(syncData)
    }
  } catch { /* sync write failure doesn't affect functionality */ }
}

// ===== Device ID Management =====

async function getOrCreateDeviceId(): Promise<string> {
  // Prefer local (fast), fall back to sync (reinstall recovery), generate new if none
  const local = await chrome.storage.local.get(STORAGE_KEYS.deviceId)
  if (local[STORAGE_KEYS.deviceId]) {
    return local[STORAGE_KEYS.deviceId]
  }

  const synced = await chrome.storage.sync.get(STORAGE_KEYS.deviceId)
  if (synced[STORAGE_KEYS.deviceId]) {
    // Restore from sync to local
    await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: synced[STORAGE_KEYS.deviceId] })
    logger.info(`[SW] Restored from sync: deviceId: ${synced[STORAGE_KEYS.deviceId]}`)
    return synced[STORAGE_KEYS.deviceId]
  }

  // Genuine first install: generate UUID, write to both local + sync
  const deviceId = crypto.randomUUID()
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: deviceId })
  await saveToSync({ [STORAGE_KEYS.deviceId]: deviceId })
  logger.info(`[SW] Generated new deviceId: ${deviceId}`)
  return deviceId
}

async function getDeviceName(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.deviceName)
  return result[STORAGE_KEYS.deviceName] || null
}

async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
  return result[STORAGE_KEYS.xsocialToken] || null
}

// ===== WebSocket Connection Management =====

let ws: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let activeTabId: number | null = null

const EXT_VERSION = '2.1.0'

async function connectWS() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return

  try {
    ws = new WebSocket(XSOCIAL_WS)
  } catch (err) {
    logger.error('[WS] Failed to create WebSocket:', err)
    scheduleReconnect()
    return
  }

  ws.onopen = async () => {
    logger.info('[WS] Connected to xSocial')
    const deviceId = await getOrCreateDeviceId()
    const deviceName = await getDeviceName()

    // Check for manual recovery request (highest priority)
    const recoverStore = await chrome.storage.local.get('recover_node_code')
    const recoverNodeCode = recoverStore.recover_node_code || undefined
    if (recoverNodeCode) await chrome.storage.local.remove('recover_node_code')

    // When recoverNodeCode is set, don't send token - prevent token recovery from overriding manual recovery
    let token: string | null = null
    if (!recoverNodeCode) {
      const boundStore = await chrome.storage.local.get('is_bound')
      token = boundStore.is_bound ? await getToken() : null
    }

    // Get currently logged-in X user (for automatic node identification after reinstall)
    let xScreenName: string | undefined
    if (!recoverNodeCode) {
      try {
        const cookies = await getXCookies()
        if (cookies) {
          const xUser = await getAuthenticatedUser(cookies)
          if (xUser?.screenName) xScreenName = xUser.screenName
        }
      } catch { /* X not logged in */ }
    }

    ws!.send(JSON.stringify({
      type: 'ext:auth',
      payload: { version: EXT_VERSION, token: token || undefined, deviceId, deviceName, xScreenName: xScreenName || undefined, recoverNodeCode },
    }))
    startHeartbeat()
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string)
      handleWSMessage(msg)
    } catch (err) {
      logger.error('[WS] Failed to parse message:', err)
    }
  }

  ws.onclose = () => {
    logger.warn('[WS] Disconnected, reconnecting in 5s...')
    stopHeartbeat()
    scheduleReconnect()
  }

  ws.onerror = (err) => {
    logger.error('[WS] Error:', err)
  }
}

function disconnectWS() {
  stopHeartbeat()
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer)
    wsReconnectTimer = null
  }
  if (ws) {
    ws.onclose = null // prevent auto-reconnect
    ws.close()
    ws = null
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer)
  wsReconnectTimer = setTimeout(connectWS, 5000)
}

function sendWS(type: string, payload: any) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }))
  } else {
    logger.warn('[WS] Cannot send, not connected. type:', type)
  }
}

// ===== Heartbeat =====

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ext:heartbeat',
        payload: { timestamp: Date.now(), version: EXT_VERSION },
      }))
    }
  }, 10_000)  // 10s heartbeat, prevents MV3 service worker from sleeping and killing WS
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// ===== WebSocket Message Handling (server -> browser) =====

async function handleWSMessage(msg: { type: string; payload?: any }) {
  switch (msg.type) {
    case 'auth:ok':
    case 'auth:result': {
      if (msg.payload?.success === false) {
        logger.error('[WS] Auth failed:', msg.payload?.error)
        break
      }
      const { nodeCode, bound, userId, token: newToken } = msg.payload || {}
      if (nodeCode) {
        const data: Record<string, unknown> = { node_code: nodeCode, is_bound: !!bound, bound_user_id: userId || null }
        // Server may auto-issue new token after reinstall
        if (newToken) {
          data[STORAGE_KEYS.xsocialToken] = newToken
          logger.info('[WS] Token restored from server')
        }
        await chrome.storage.local.set(data)
        await saveToSync(newToken
          ? { node_code: nodeCode, is_bound: !!bound, bound_user_id: userId, xsocial_token: newToken }
          : { node_code: nodeCode, is_bound: !!bound, bound_user_id: userId }
        )
      }
      logger.info(`[WS] Authenticated: ${nodeCode || '?'}, bound=${bound}`)
      break
    }

    case 'auth:error': {
      logger.error('[WS] Auth failed:', msg.payload?.error)
      break
    }

    case 'bind:complete': {
      const { token, nodeCode: nc, userId: uid } = msg.payload || {}
      if (token) {
        const data: Record<string, unknown> = {
          [STORAGE_KEYS.xsocialToken]: token,
          node_code: nc,
          is_bound: true,
          bound_user_id: uid,
        }
        await chrome.storage.local.set(data)
        await saveToSync({ xsocial_token: token, node_code: nc, is_bound: true, bound_user_id: uid })
      }
      logger.info(`[WS] Node bound! nodeCode=${nc}`)
      break
    }

    case 'task:execute': {
      const { taskId, steps, mode, title, taskType } = msg.payload || {}
      logger.info(`[WS] Task received: ${taskId}, mode=${mode}, steps=${steps?.length}`)

      // Store current task for popup display
      await chrome.storage.local.set({
        current_task: {
          taskId, title: title || taskType || 'Task',
          taskType: taskType || 'unknown', mode,
          steps: (steps || []).map((s: any) => ({ action: s.action, description: s.description, status: 'pending' })),
          currentStep: 0, status: 'running', startedAt: Date.now(),
        },
      })

      if (steps?.[0]?.action === 'navigate') {
        try {
          await navigateActiveTab(steps[0].config.url)
          await sleep(3000)
          const result = await sendToActiveTab({ type: 'SNAPSHOT' })
          sendWS('step:result', {
            taskId,
            stepOrder: 1,
            status: 'completed',
            result: result?.data || { snapshot: '', url: '', title: '' },
          })
        } catch (err: any) {
          sendWS('step:result', {
            taskId,
            stepOrder: 1,
            status: 'failed',
            error: err.message || 'Navigation failed',
          })
        }
      }
      break
    }

    case 'step:next': {
      const { taskId, stepOrder, action, config } = msg.payload || {}
      logger.info(`[WS] Step ${stepOrder}: ${action}`)

      // Update current step in popup
      const taskStore = await chrome.storage.local.get('current_task')
      if (taskStore.current_task) {
        const ct = taskStore.current_task
        // Mark previous steps as completed
        if (ct.steps && stepOrder > 1) {
          for (let i = 0; i < Math.min(stepOrder - 1, ct.steps.length); i++) {
            ct.steps[i].status = 'completed'
          }
        }
        ct.currentStep = stepOrder
        // Dynamically add steps
        while (ct.steps.length < stepOrder) {
          ct.steps.push({ action, description: msg.payload?.description || action, status: 'pending' })
        }
        if (ct.steps[stepOrder - 1]) {
          ct.steps[stepOrder - 1] = { action, description: msg.payload?.description || action, status: 'running' }
        }
        await chrome.storage.local.set({ current_task: ct })
      }

      try {
        if (action === 'navigate') {
          await navigateActiveTab(config.url)
          await sleep(3000)
          const result = await sendToActiveTab({ type: 'SNAPSHOT' })
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: 'completed',
            result: result?.data || { snapshot: '', url: '', title: '' },
          })
        } else if (action === 'scan') {
          // Pure perception - content-script snapshot
          const result = await sendToActiveTab({ type: 'SNAPSHOT' })
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: result?.success ? 'completed' : 'failed',
            result: result?.data || { snapshot: '', url: '', title: '' },
            error: result?.error,
          })
        } else if (action === 'action' || action === 'scroll') {
          // Execute action -> content-script executes and returns new snapshot
          const actionPayload = action === 'scroll'
            ? { type: 'scroll', pixels: config?.amount || 600 }
            : config
          logger.info(`[WS] Sending ACTION to content-script:`, JSON.stringify(actionPayload))
          const result = await sendToActiveTab({ type: 'ACTION', payload: actionPayload })
          logger.info(`[WS] Content-script response:`, JSON.stringify({ success: result?.success, error: result?.error, hasData: !!result?.data }))
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: result?.success !== false ? 'completed' : 'failed',
            result: result?.data || { snapshot: '', url: '', title: '' },
            error: result?.error,
          })
        } else if (action === 'screenshot') {
          const dataUrl = await chrome.tabs.captureVisibleTab(
            undefined as any,
            { format: 'jpeg', quality: 70 }
          )
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: 'completed',
            result: { imageBase64: dataUrl },
          })
        } else if (action === 'x-api') {
          // Direct Twitter API operations (bypass content script)
          const result = await executeXApiAction(config)
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: result.success ? 'completed' : 'failed',
            result: result.data || {},
            error: result.error,
          })
        } else {
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: 'failed',
            error: `Unknown action: ${action}`,
          })
        }
      } catch (err: any) {
        logger.error(`[WS] Step ${stepOrder} error:`, err)
        sendWS('step:result', {
          taskId,
          stepOrder,
          status: 'failed',
          error: err.message || 'Step execution failed',
        })
      }

      // Update current step in popup as completed
      const taskAfter = await chrome.storage.local.get('current_task')
      if (taskAfter.current_task?.steps) {
        const ct = taskAfter.current_task
        for (const s of ct.steps) {
          if (s.status === 'running') s.status = 'completed'
        }
        await chrome.storage.local.set({ current_task: ct })
      }
      break
    }

    case 'step:done': {
      logger.info(`[WS] Task completed: ${msg.payload?.taskId}`)
      // Save AI summary (if available)
      if (msg.payload?.summary) {
        await chrome.storage.local.set({ task_summary: msg.payload.summary })
      }
      await moveTaskToHistory('completed')
      break
    }

    case 'step:abort': {
      logger.warn(`[WS] Task aborted: ${msg.payload?.taskId}, reason: ${msg.payload?.reason}`)
      await moveTaskToHistory('aborted')
      break
    }

    case 'pong': {
      // Server heartbeat response, ignore
      break
    }

    // ===== Unfollow Tasks (Follow Check) =====

    case 'task:unfollow-scan': {
      const { taskId, xScreenName, scanMode, token } = msg.payload || {}
      logger.info(`[WS] Unfollow scan: taskId=${taskId}, mode=${scanMode}`)

      if (scanMode === 'api') {
        // Mode A: API batch scan
        try {
          const result = await scanViaApi(taskId, xScreenName, token)
          sendWS('unfollow:scan-complete', {
            taskId,
            nonFollowerCount: result.nonFollowers.length,
            totalFollowing: result.totalFollowing,
            totalFollowers: result.totalFollowers,
          })
        } catch (err: any) {
          sendWS('unfollow:scan-error', { taskId, error: err.message })
        }
      } else {
        // Mode B: Page scroll - navigate to "Following" page first
        try {
          await navigateActiveTab(`https://x.com/${xScreenName}/following`)
          await sleep(3000)
          // Notify content-script to start scroll scan
          const result = await sendToActiveTab({
            type: 'UNFOLLOW_SCAN_PAGE',
            payload: { taskId, xScreenName, token },
          })
          if (result?.success) {
            sendWS('unfollow:scan-started', { taskId, mode: 'page' })
          } else {
            sendWS('unfollow:scan-error', { taskId, error: result?.error || 'Content script not ready' })
          }
        } catch (err: any) {
          sendWS('unfollow:scan-error', { taskId, error: err.message })
        }
      }
      break
    }

    case 'task:unfollow-execute': {
      const { taskId, nonFollowers, config, startIndex, token, scanMode } = msg.payload || {}
      logger.info(`[WS] Unfollow execution: taskId=${taskId}, mode=${scanMode}, startIndex=${startIndex}, count=${nonFollowers?.length}`)

      if (scanMode === 'page') {
        // Mode B: Page scroll unfollow -> content-script executes
        const result = await sendToActiveTab({
          type: 'UNFOLLOW_EXECUTE_PAGE',
          payload: { taskId, config, startIndex, token },
        })
        if (!result?.success) {
          sendWS('unfollow:error', { taskId, error: result?.error || 'Content script not ready' })
        }
      } else {
        // Mode A: API unfollow
        startApiUnfollow(taskId, nonFollowers, config, startIndex || 0, token)
          .catch((err) => {
            sendWS('unfollow:error', { taskId, error: err.message })
          })
      }
      break
    }

    case 'task:unfollow-pause': {
      logger.info('[WS] Unfollow paused')
      pauseUnfollow()
      // Also notify content-script to stop (Mode B)
      await sendToActiveTab({ type: 'UNFOLLOW_PAUSE' })
      break
    }

    default: {
      logger.debug('[WS] Unhandled message type:', msg.type)
    }
  }
}

// ===== Twitter API Direct Operations (via x-api.ts) =====

async function executeXApiAction(
  config: { operation: string; [key: string]: any }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const cookies = await getXCookies()
  if (!cookies) return { success: false, error: 'Not logged in to X (Twitter)' }

  switch (config.operation) {
    case 'follow':
      return followUser(cookies, config.userId)
    case 'unfollow':
      return unfollowUser(cookies, config.userId)
    case 'tweet':
      return createTweet(cookies, config.text, config.mediaIds)
    case 'like':
      return likeTweet(cookies, config.tweetId)
    case 'retweet':
      return retweet(cookies, config.tweetId)
    default:
      return { success: false, error: `Unknown x-api operation: ${config.operation}` }
  }
}

// ===== Tab Management =====

async function getActiveXTab(): Promise<number | null> {
  // Prefer existing X/Twitter tab
  const xTabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] })
  if (xTabs.length > 0 && xTabs[0].id) return xTabs[0].id

  // Fallback to any active tab
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true })
  if (activeTabs.length > 0 && activeTabs[0].id) return activeTabs[0].id

  return null
}

async function navigateActiveTab(url: string) {
  let tabId = await getActiveXTab()
  if (!tabId) {
    const tab = await chrome.tabs.create({ url, active: true })
    tabId = tab.id!
  } else {
    await chrome.tabs.update(tabId, { url, active: true })
  }
  activeTabId = tabId

  // Wait for page load with timeout
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 15_000)

    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        clearTimeout(timeout)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function sendToActiveTab(message: any): Promise<any> {
  const tabId = activeTabId || await getActiveXTab()
  if (!tabId) return { success: false, error: 'No active tab' }
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    logger.error('[SW] sendToActiveTab error:', err)
    return { success: false, error: 'Content script not ready' }
  }
}

// ===== Chrome Message Router (popup / content script -> service worker) =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      logger.error('[SW] Message handler error:', err)
      sendResponse({ success: false, error: err.message })
    })
  return true // keep async channel open
})

async function handleMessage(
  message: { type: string; payload?: any },
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'GET_COOKIES': {
      const cookies = await getXCookies()
      return { success: !!cookies, data: cookies ? { cookies } : null }
    }

    case 'URL_CHANGED': {
      logger.debug('[SW] URL changed:', message.payload?.url)
      return { success: true }
    }

    case 'CONNECT_WS': {
      await connectWS()
      return { success: true }
    }

    case 'DISCONNECT_WS': {
      disconnectWS()
      return { success: true }
    }

    case 'GET_WS_STATUS': {
      return {
        success: true,
        data: {
          connected: ws?.readyState === WebSocket.OPEN,
          readyState: ws?.readyState ?? -1,
        },
      }
    }

    // Execute paste in MAIN world (Draft.js only recognizes input in MAIN world)
    case 'EXECUTE_IN_MAIN_WORLD': {
      const tabId = activeTabId || (await chrome.tabs.query({ url: 'https://x.com/*' }))?.[0]?.id
      if (!tabId) return { success: false, error: 'No x.com tab' }
      const textToType = message.payload?.text || ''
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (text: string) => {
            const el = document.querySelector('[contenteditable="true"]') as HTMLElement
            if (!el) return { success: false, error: 'No contenteditable found' }
            // Check if content already exists (prevent duplicate input)
            if (el.textContent && el.textContent.trim().length > 0) {
              return { success: true, skipped: true, existing: el.textContent.trim().slice(0, 30) }
            }
            el.focus()
            // Paste directly, don't clear (clearing breaks Draft.js state)
            const dt = new DataTransfer()
            dt.setData('text/plain', text)
            el.dispatchEvent(new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            }))
            return { success: true }
          },
          args: [textToType],
        })
        return results?.[0]?.result || { success: true }
      } catch (err: any) {
        logger.error('[SW] MAIN world execute error:', err)
        return { success: false, error: err.message }
      }
    }

    // Device ID query
    case 'GET_DEVICE_ID': {
      const deviceId = await getOrCreateDeviceId()
      const deviceName = await getDeviceName()
      return { success: true, data: { deviceId, deviceName } }
    }

    // Device rename
    case 'SET_DEVICE_NAME': {
      const newName = message.payload?.name
      if (newName) {
        await chrome.storage.local.set({ [STORAGE_KEYS.deviceName]: newName })
      }
      return { success: true }
    }

    // ===== Email/password login (extension -> xSocial -> Microcosm auth chain) =====
    // Note: Login only verifies identity + gets node list, doesn't store token or trigger WS reconnect
    // Token is stored and reconnected only after user selects a node (SELECT_NODE)
    case 'MICROCOSM_LOGIN': {
      const { email: loginEmail, password: loginPwd } = message.payload || {}
      if (!loginEmail || !loginPwd) return { success: false, error: 'Please enter email and password' }

      try {
        const res = await fetch(`${XSOCIAL_API}/api/auth/extension-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', email: loginEmail, password: loginPwd }),
        })
        const data = await res.json()

        if (!res.ok || !data.token) {
          return { success: false, error: data.error || 'Login failed' }
        }

        // Don't store token yet! Wait until user selects a node
        // Prevent auto-binding new node during WS heartbeat/reconnect
        return { success: true, data: { token: data.token, nodes: data.nodes || [], userId: data.userId } }
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error' }
      }
    }

    // Unfollow status query (popup -> service-worker)
    case 'GET_UNFOLLOW_STATUS': {
      const status = getUnfollowStatus()
      return { success: true, data: status }
    }

    // Unfollow scan (popup -> service-worker, direct execution without WS)
    case 'UNFOLLOW_SCAN': {
      const { taskId, xScreenName, scanMode, token } = message.payload || {}
      if (scanMode === 'api') {
        try {
          const result = await scanViaApi(taskId, xScreenName, token)
          return { success: true, data: result }
        } catch (err: any) {
          return { success: false, error: err.message }
        }
      } else {
        // Mode B: Navigate to following page, content-script scans autonomously
        await navigateActiveTab(`https://x.com/${xScreenName}/following`)
        await sleep(3000)
        const result = await sendToActiveTab({
          type: 'UNFOLLOW_SCAN_PAGE',
          payload: { taskId, xScreenName, token },
        })
        return result
      }
    }

    // Unfollow execution (popup -> service-worker, direct execution without WS)
    case 'UNFOLLOW_EXECUTE': {
      const { taskId, nonFollowers: nf, config: cfg, startIndex: si, token: tk, scanMode: sm } = message.payload || {}
      if (sm === 'page') {
        const result = await sendToActiveTab({
          type: 'UNFOLLOW_EXECUTE_PAGE',
          payload: { taskId, config: cfg, startIndex: si, token: tk },
        })
        return result
      } else {
        startApiUnfollow(taskId, nf, cfg, si || 0, tk).catch(() => {})
        return { success: true }
      }
    }

    // Unfollow paused (popup → service-worker)
    case 'UNFOLLOW_PAUSE': {
      pauseUnfollow()
      await sendToActiveTab({ type: 'UNFOLLOW_PAUSE' })
      return { success: true }
    }

    // ===== OAuth Login: Open xSocial website -> Microcosm OAuth -> extract token =====
    case 'LOGIN_VIA_XSOCIAL': {
      try {
        // Open xSocial login page
        const tab = await chrome.tabs.create({ url: `${XSOCIAL_API}/login`, active: true })
        if (!tab.id) return { success: false, error: 'Unable to open tab' }

        const loginTabId = tab.id

        // Poll: wait for user to complete OAuth login, then extract token
        const loginResult = await new Promise<any>((resolve, reject) => {
          let attempts = 0
          const maxAttempts = 120 // 5 min timeout (2.5s × 120)

          const poll = setInterval(async () => {
            attempts++
            if (attempts > maxAttempts) {
              clearInterval(poll)
              reject(new Error('Login timed out, please try again'))
              return
            }

            try {
              // Check if tab still exists + is on xsocial.cc (after OAuth callback)
              const tabInfo = await chrome.tabs.get(loginTabId)
              if (!tabInfo.url?.includes('xsocial.cc')) return // Still on Microcosm login page
              if (tabInfo.status !== 'complete') return // Page still loading

              // Extract Microcosm access token from page localStorage
              const [execResult] = await chrome.scripting.executeScript({
                target: { tabId: loginTabId },
                world: 'MAIN',
                func: async () => {
                  const accessToken = localStorage.getItem('mc_access_token')
                  if (!accessToken) return { error: 'not_logged_in' }

                  try {
                    // Exchange Microcosm token for extension token
                    const tokenRes = await fetch('/api/auth/extension-token', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${accessToken}` },
                    })
                    const tokenData = await tokenRes.json()
                    if (!tokenData.token) return { error: tokenData.error || 'Failed to get token' }

                    // Also fetch user's extension node list
                    const nodesRes = await fetch('/api/market/manager/extensions', {
                      headers: { 'Authorization': `Bearer ${accessToken}` },
                    })
                    const nodesData = await nodesRes.json()

                    // Get user info
                    const userStr = localStorage.getItem('mc_user')
                    const user = userStr ? JSON.parse(userStr) : null

                    return {
                      token: tokenData.token,
                      nodes: nodesData.data || [],
                      user,
                    }
                  } catch (err: any) {
                    return { error: err.message || 'Request failed' }
                  }
                },
              })

              const data = execResult?.result
              if (data?.token) {
                clearInterval(poll)

                // Store token
                await chrome.storage.local.set({
                  [STORAGE_KEYS.xsocialToken]: data.token,
                })
                await saveToSync({ xsocial_token: data.token })

                // Close login tab
                try { chrome.tabs.remove(loginTabId) } catch {}

                resolve(data)
              }
            } catch {
              // Tab may be navigating, ignore
            }
          }, 2500)

          // Clean up when user manually closes tab
          const onRemoved = (closedTabId: number) => {
            if (closedTabId === loginTabId) {
              clearInterval(poll)
              chrome.tabs.onRemoved.removeListener(onRemoved)
              reject(new Error('Login page was closed'))
            }
          }
          chrome.tabs.onRemoved.addListener(onRemoved)
        })

        return { success: true, data: loginResult }
      } catch (err: any) {
        return { success: false, error: err.message || 'Login failed' }
      }
    }

    // ===== Select Node to Restore Connection =====
    case 'SELECT_NODE': {
      const { nodeCode: selectedCode, token: loginToken } = message.payload || {}
      if (!selectedCode) return { success: false, error: 'Please select a node' }

      // Set is_bound + token + nodeCode immediately (prevent popup polling from seeing unbound state)
      const updates: Record<string, unknown> = {
        node_code: selectedCode,
        is_bound: true,
      }
      if (loginToken) {
        updates[STORAGE_KEYS.xsocialToken] = loginToken
        updates.bound_user_id = 'pending' // WS auth:result will update to real value
      }
      await chrome.storage.local.set(updates)
      await saveToSync({ node_code: selectedCode, is_bound: true, ...(loginToken ? { xsocial_token: loginToken } : {}) })

      // Restore via WS: store recover_node_code then reconnect
      await chrome.storage.local.set({ recover_node_code: selectedCode })
      disconnectWS()
      setTimeout(connectWS, 500)

      return { success: true }
    }

    // Popup: query node status
    case 'GET_NODE_STATUS': {
      const deviceId = await getOrCreateDeviceId()
      const deviceName = await getDeviceName()
      const store = await chrome.storage.local.get(['node_code', 'is_bound', 'bound_user_id', STORAGE_KEYS.xsocialToken, STORAGE_KEYS.xUserInfo])

      let isBound = !!store.is_bound
      const nodeCode = store.node_code || null

      // Fetch latest status + bound X account info from server
      let xUser = store[STORAGE_KEYS.xUserInfo] || null
      if (nodeCode) {
        try {
          const res = await fetch(`${XSOCIAL_API}/api/market/manager/extensions/status?nodeCode=${nodeCode}`)
          const data = await res.json()
          if (data.bound && !isBound) {
            isBound = true
            await chrome.storage.local.set({ is_bound: true })
            disconnectWS()
            setTimeout(connectWS, 500)
          }
          // Server returned bound X account info -> cache locally
          if (data.xAccount) {
            xUser = data.xAccount
            await chrome.storage.local.set({ [STORAGE_KEYS.xUserInfo]: data.xAccount })
          }
        } catch { /* Query failed, use local cache */ }
      }

      return {
        success: true,
        data: {
          deviceId,
          deviceName,
          nodeCode,
          isBound,
          userId: store.bound_user_id || null,
          hasToken: !!store[STORAGE_KEYS.xsocialToken],
          xUser,
          wsConnected: ws?.readyState === WebSocket.OPEN,
        },
      }
    }

    // Popup: query current task
    case 'GET_CURRENT_TASK': {
      const store = await chrome.storage.local.get('current_task')
      return { success: true, data: store.current_task || null }
    }

    // Popup: query task history
    case 'GET_TASK_HISTORY': {
      const store = await chrome.storage.local.get('task_history')
      return { success: true, data: store.task_history || [] }
    }

    // Popup: manual old node ID recovery
    case 'RECOVER_NODE': {
      const { oldNodeCode } = message.payload || {} as { oldNodeCode?: string }
      if (!oldNodeCode) return { success: false, error: 'Please enter a node ID' }
      try {
        // Check if this nodeCode exists on server
        const res = await fetch(`${XSOCIAL_API}/api/market/manager/extensions/status?nodeCode=${oldNodeCode}`)
        const data = await res.json()
        if (!data.bound) return { success: false, error: `Node ${oldNodeCode} does not exist or is not bound` }
        // Set is_bound + nodeCode immediately (prevent popup from seeing unbound state)
        await chrome.storage.local.set({
          recover_node_code: oldNodeCode,
          node_code: oldNodeCode.toUpperCase(),
          is_bound: true,
        })
        await saveToSync({ node_code: oldNodeCode.toUpperCase(), is_bound: true })
        // Disconnect and reconnect, WS auth will include recoverNodeCode
        disconnectWS()
        setTimeout(connectWS, 500)
        return { success: true }
      } catch {
        return { success: false, error: 'Network error' }
      }
    }

    // Popup: query KPI
    case 'GET_KPI': {
      const store = await chrome.storage.local.get('daily_kpi')
      return { success: true, data: store.daily_kpi || {} }
    }

    // Relay popup messages to content script
    case 'RELAY_TO_TAB': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, message.payload)
        } catch { /* content script not loaded */ }
      }
      return { success: true }
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` }
  }
}

// ===== Sidebar — Click icon to open Side Panel =====

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch(() => { /* Older Chrome versions don't support this */ })

// ===== Lifecycle Events =====

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.info('[SW] Extension installed — restoring from sync...')
    await restoreFromSync()
    // After reinstall: clear bound state, force login -> node selection flow
    // Token kept in sync (not deleted), but is_bound=false prevents WS from sending token
    await chrome.storage.local.set({ is_bound: false, bound_user_id: null })
    logger.info('[SW] Reinstall: bound state cleared, login and node selection required')
  } else if (details.reason === 'update') {
    logger.info(`[SW] Extension updated to v${chrome.runtime.getManifest().version}`)
  }
  connectWS()
})

chrome.runtime.onStartup.addListener(async () => {
  logger.info('[SW] Browser started')
  await restoreFromSync()
  connectWS()
})

// ===== Keepalive — Prevent MV3 service worker from sleeping =====
// MV3 service worker sleeps after 30s of inactivity, killing WebSocket
// Use chrome.alarms every 25s to keep alive
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Check WS connection, reconnect if disconnected
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('[Keepalive] WS disconnected, reconnecting...')
      connectWS()
    }
  }
})

// SPA navigation detection
chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  if (details.url.includes('x.com') || details.url.includes('twitter.com')) {
    logger.debug('[SW] SPA navigation:', details.url)
  }
})

// ===== Task History Management =====

async function moveTaskToHistory(status: 'completed' | 'aborted') {
  const store = await chrome.storage.local.get(['current_task', 'task_history', 'task_summary'])
  const current = store.current_task
  if (!current) {
    logger.warn('[SW] moveTaskToHistory: current_task is empty, cannot move to history')
    return
  }
  logger.info(`[SW] moveTaskToHistory: ${current.taskId}, steps=${current.steps?.length}, summary=${store.task_summary ? 'yes' : 'no'}`)

  // Mark all steps with final status
  if (current.steps) {
    for (const step of current.steps) {
      if (step.status === 'running') step.status = status === 'completed' ? 'completed' : 'failed'
      if (step.status === 'pending') step.status = status === 'completed' ? 'completed' : 'skipped'
    }
  }

  // Attach AI summary to task record
  const summary = store.task_summary || null
  const completedTask = { ...current, status, completedAt: Date.now(), summary }

  const history = store.task_history || []
  history.unshift(completedTask)
  if (history.length > 50) history.length = 50

  // Keep current_task for 10s so popup can see completed state, then auto-clear
  await chrome.storage.local.set({
    current_task: completedTask,
    task_history: history,
  })
  await chrome.storage.local.remove('task_summary')

  // Auto-clear current_task after 10s (let history page take over)
  setTimeout(async () => {
    await chrome.storage.local.remove('current_task')
  }, 10_000)
}

// ===== Utility =====

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ===== Auto-connect on service worker startup =====
restoreFromSync().then(() => connectWS())

logger.info('[SW] Service Worker v4 started')
