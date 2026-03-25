// Developed by AI Agent


import { XSOCIAL_API, XSOCIAL_WS } from '@shared/constants'
import { STORAGE_KEYS } from '@shared/types'
import { logger } from '@utils/logger'
import { getXCookies, getAuthenticatedUser, getUserByScreenName, followUser, unfollowUser, createTweet, likeTweet, retweet, getFollowingIds, getFollowerIds } from './x-api'
import { scanViaApi, startApiUnfollow, pauseUnfollow, getUnfollowStatus, restoreState } from './unfollow-scheduler'
import { getFollowAutoState, getFollowAutoConfig, updateFollowAutoConfig, startFollowAutomation, pauseFollowAutomation, restoreFollowState } from './follow-automation'
import { getLikeAutoState, getLikeAutoConfig, setLikeAutoConfig, toggleLikeAuto, restoreLikeState } from './like-companion'
import { getModelState, getPresetModels, saveUserModel, removeUserModel, setActiveModel, testModel, callUserModel, hasActiveUserModel, restoreModelState } from './model-manager'


const SYNC_KEYS = ['device_id', 'device_name', 'node_code', 'is_bound', 'bound_user_id', 'xsocial_token'] as const


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
      logger.info(`[SW] 从 sync 恢复 ${Object.keys(toRestore).length} 项: ${Object.keys(toRestore).join(', ')}`)
    }
  } catch (err) {
    logger.error('[SW] sync 恢复失败:', err)
  }
}


async function saveToSync(data: Record<string, unknown>): Promise<void> {
  try {
    const syncData: Record<string, unknown> = {}
    for (const key of SYNC_KEYS) {
      if (key in data) syncData[key] = data[key]
    }
    if (Object.keys(syncData).length > 0) {
      await chrome.storage.sync.set(syncData)
    }
  } catch {  }
}


async function getOrCreateDeviceId(): Promise<string> {
  
  const local = await chrome.storage.local.get(STORAGE_KEYS.deviceId)
  if (local[STORAGE_KEYS.deviceId]) {
    return local[STORAGE_KEYS.deviceId]
  }

  const synced = await chrome.storage.sync.get(STORAGE_KEYS.deviceId)
  if (synced[STORAGE_KEYS.deviceId]) {
    
    await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: synced[STORAGE_KEYS.deviceId] })
    logger.info(`[SW] 从 sync 恢复 deviceId: ${synced[STORAGE_KEYS.deviceId]}`)
    return synced[STORAGE_KEYS.deviceId]
  }

  
  const deviceId = crypto.randomUUID()
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: deviceId })
  await saveToSync({ [STORAGE_KEYS.deviceId]: deviceId })
  logger.info(`[SW] 生成新 deviceId: ${deviceId}`)
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


async function fetchDynamicConfig(): Promise<void> {
  try {
    const res = await fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/dynamic-config`)
    if (!res.ok) return
    const data = await res.json()
    
    await chrome.storage.local.set({ dynamic_config: data, dynamic_config_at: Date.now() })
    logger.info(`[SW] 动态配置已更新: ${Object.keys(data).join(', ')}`)
  } catch {
    
  }
}


let ws: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let activeTabId: number | null = null

// ===== 推特资料缓存 (由 content script DOM 感知驱动) =====
let cachedFullProfile: Record<string, unknown> | null = null

const EXT_VERSION = chrome.runtime.getManifest().version

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

    
    const recoverStore = await chrome.storage.local.get('recover_node_code')
    const recoverNodeCode = recoverStore.recover_node_code || undefined
    if (recoverNodeCode) await chrome.storage.local.remove('recover_node_code')

    
    let token: string | null = null
    if (!recoverNodeCode) {
      const boundStore = await chrome.storage.local.get('is_bound')
      token = boundStore.is_bound ? await getToken() : null
    }

    
    let xScreenName: string | undefined
    if (!recoverNodeCode) {
      try {
        const cookies = await getXCookies()
        if (cookies) {
          const xUser = await getAuthenticatedUser(cookies)
          if (xUser?.screenName) xScreenName = xUser.screenName
        }
      } catch {  }
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
    ws.onclose = null 
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


function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(async () => {
    if (ws?.readyState === WebSocket.OPEN) {
      
      let configVersion = 0
      try {
        const store = await chrome.storage.local.get('toolbox_config_version')
        configVersion = store.toolbox_config_version || 0
      } catch {  }

      // 携带 content script 感知到的推特资料缓存 (无 API 调用)
      if (!cachedFullProfile) {
        try {
          const cached = await chrome.storage.local.get('x_profile_full')
          cachedFullProfile = cached.x_profile_full || null
        } catch { /* ignore */ }
      }

      ws.send(JSON.stringify({
        type: 'ext:heartbeat',
        payload: {
          timestamp: Date.now(),
          version: EXT_VERSION,
          configVersion,
          ...(cachedFullProfile ? { xProfile: cachedFullProfile } : {}),
        },
      }))
    }
  }, 10_000)  
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}


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

      
      const taskStore = await chrome.storage.local.get('current_task')
      if (taskStore.current_task) {
        const ct = taskStore.current_task
        
        if (ct.steps && stepOrder > 1) {
          for (let i = 0; i < Math.min(stepOrder - 1, ct.steps.length); i++) {
            ct.steps[i].status = 'completed'
          }
        }
        ct.currentStep = stepOrder
        
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
          
          const result = await sendToActiveTab({ type: 'SNAPSHOT' })
          sendWS('step:result', {
            taskId,
            stepOrder,
            status: result?.success ? 'completed' : 'failed',
            result: result?.data || { snapshot: '', url: '', title: '' },
            error: result?.error,
          })
        } else if (action === 'action' || action === 'scroll') {
          
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
      
      break
    }

    
    case 'tool:command': {
      const { tool, action, config: toolConfig } = msg.payload || {}
      logger.info(`[WS] tool:command → ${tool}:${action}`)
      await handleToolCommand(tool, action, toolConfig)
      break
    }

    case 'tool:config-sync': {
      
      logger.info(`[WS] tool:config-sync → v${msg.payload?.configVersion}`)
      await applyToolConfig(msg.payload)
      break
    }

    
    case 'task:unfollow-scan': {
      const { taskId, xScreenName, scanMode, token } = msg.payload || {}
      logger.info(`[WS] 取关扫描: taskId=${taskId}, mode=${scanMode}`)

      if (scanMode === 'api') {
        
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
        
        try {
          await navigateActiveTab(`https://x.com/${xScreenName}/following`)
          await sleep(3000)
          
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
      logger.info(`[WS] 取关执行: taskId=${taskId}, mode=${scanMode}, startIndex=${startIndex}, count=${nonFollowers?.length}`)

      if (scanMode === 'page') {
        
        const result = await sendToActiveTab({
          type: 'UNFOLLOW_EXECUTE_PAGE',
          payload: { taskId, config, startIndex, token },
        })
        if (!result?.success) {
          sendWS('unfollow:error', { taskId, error: result?.error || 'Content script not ready' })
        }
      } else {
        
        startApiUnfollow(taskId, nonFollowers, config, startIndex || 0, token)
          .catch((err) => {
            sendWS('unfollow:error', { taskId, error: err.message })
          })
      }
      break
    }

    case 'task:unfollow-pause': {
      logger.info('[WS] 取关暂停')
      pauseUnfollow()
      
      await sendToActiveTab({ type: 'UNFOLLOW_PAUSE' })
      break
    }

    default: {
      logger.debug('[WS] Unhandled message type:', msg.type)
    }
  }
}


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


async function getActiveXTab(): Promise<number | null> {
  
  const xTabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] })
  if (xTabs.length > 0 && xTabs[0].id) return xTabs[0].id

  
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


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      logger.error('[SW] Message handler error:', err)
      sendResponse({ success: false, error: err.message })
    })
  return true 
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

    case 'PROFILE_CHANGED': {
      // Content script 从页面 DOM 感知到用户资料变化 (零 API 调用)
      const p = message.payload
      if (p?.xScreenName) {
        cachedFullProfile = p
        await chrome.storage.local.set({ x_profile_full: p, x_profile_refreshed_at: Date.now() })
        logger.info(`[SW] 资料变化 (DOM): @${p.xScreenName} followers=${p.followersCount || '?'}`)
      }
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
            
            if (el.textContent && el.textContent.trim().length > 0) {
              return { success: true, skipped: true, existing: el.textContent.trim().slice(0, 30) }
            }
            el.focus()
            
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

    
    case 'GET_DEVICE_ID': {
      const deviceId = await getOrCreateDeviceId()
      const deviceName = await getDeviceName()
      return { success: true, data: { deviceId, deviceName } }
    }

    
    case 'SET_DEVICE_NAME': {
      const newName = message.payload?.name
      if (newName) {
        await chrome.storage.local.set({ [STORAGE_KEYS.deviceName]: newName })
      }
      return { success: true }
    }

    
    case 'MICROCOSM_LOGIN': {
      const { email: loginEmail, password: loginPwd } = message.payload || {}
      if (!loginEmail || !loginPwd) return { success: false, error: '请输入邮箱和密码' }

      try {
        const res = await fetch(`${XSOCIAL_API}/api/auth/extension-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', email: loginEmail, password: loginPwd }),
        })
        const data = await res.json()

        if (!res.ok || !data.token) {
          return { success: false, error: data.error || '登录失败' }
        }

        
        return { success: true, data: { token: data.token, nodes: data.nodes || [], userId: data.userId } }
      } catch (err: any) {
        return { success: false, error: err.message || '网络错误' }
      }
    }

    
    case 'GET_UNFOLLOW_STATUS': {
      const status = getUnfollowStatus()
      return { success: true, data: status }
    }

    
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
        
        await navigateActiveTab(`https://x.com/${xScreenName}/following`)
        await sleep(3000)
        const result = await sendToActiveTab({
          type: 'UNFOLLOW_SCAN_PAGE',
          payload: { taskId, xScreenName, token },
        })
        return result
      }
    }

    
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

    
    case 'UNFOLLOW_PAUSE': {
      pauseUnfollow()
      await sendToActiveTab({ type: 'UNFOLLOW_PAUSE' })
      return { success: true }
    }

    
    case 'LOGIN_VIA_XSOCIAL': {
      try {
        
        const tab = await chrome.tabs.create({ url: `${XSOCIAL_API}/login`, active: true })
        if (!tab.id) return { success: false, error: '无法打开标签页' }

        const loginTabId = tab.id

        
        const loginResult = await new Promise<any>((resolve, reject) => {
          let attempts = 0
          const maxAttempts = 120 

          const poll = setInterval(async () => {
            attempts++
            if (attempts > maxAttempts) {
              clearInterval(poll)
              reject(new Error('登录超时，请重试'))
              return
            }

            try {
              
              const tabInfo = await chrome.tabs.get(loginTabId)
              if (!tabInfo.url?.includes('xsocial.cc')) return 
              if (tabInfo.status !== 'complete') return 

              
              const [execResult] = await chrome.scripting.executeScript({
                target: { tabId: loginTabId },
                world: 'MAIN',
                func: async () => {
                  const accessToken = localStorage.getItem('mc_access_token')
                  if (!accessToken) return { error: 'not_logged_in' }

                  try {
                    
                    const tokenRes = await fetch('/api/auth/extension-token', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${accessToken}` },
                    })
                    const tokenData = await tokenRes.json()
                    if (!tokenData.token) return { error: tokenData.error || '获取 token 失败' }

                    
                    const nodesRes = await fetch('/api/market/manager/extensions', {
                      headers: { 'Authorization': `Bearer ${accessToken}` },
                    })
                    const nodesData = await nodesRes.json()

                    
                    const userStr = localStorage.getItem('mc_user')
                    const user = userStr ? JSON.parse(userStr) : null

                    return {
                      token: tokenData.token,
                      nodes: nodesData.data || [],
                      user,
                    }
                  } catch (err: any) {
                    return { error: err.message || '请求失败' }
                  }
                },
              })

              const data = execResult?.result
              if (data?.token) {
                clearInterval(poll)

                
                await chrome.storage.local.set({
                  [STORAGE_KEYS.xsocialToken]: data.token,
                })
                await saveToSync({ xsocial_token: data.token })

                
                try { chrome.tabs.remove(loginTabId) } catch {}

                resolve(data)
              }
            } catch {
              
            }
          }, 2500)

          
          const onRemoved = (closedTabId: number) => {
            if (closedTabId === loginTabId) {
              clearInterval(poll)
              chrome.tabs.onRemoved.removeListener(onRemoved)
              reject(new Error('登录页面已关闭'))
            }
          }
          chrome.tabs.onRemoved.addListener(onRemoved)
        })

        return { success: true, data: loginResult }
      } catch (err: any) {
        return { success: false, error: err.message || '登录失败' }
      }
    }

    
    case 'SELECT_NODE': {
      const { nodeCode: selectedCode, token: loginToken } = message.payload || {}
      if (!selectedCode) return { success: false, error: '请选择节点' }

      
      const updates: Record<string, unknown> = {
        node_code: selectedCode,
        is_bound: true,
      }
      if (loginToken) {
        updates[STORAGE_KEYS.xsocialToken] = loginToken
        updates.bound_user_id = 'pending' 
      }
      await chrome.storage.local.set(updates)
      await saveToSync({ node_code: selectedCode, is_bound: true, ...(loginToken ? { xsocial_token: loginToken } : {}) })

      
      await chrome.storage.local.set({ recover_node_code: selectedCode })
      disconnectWS()
      setTimeout(connectWS, 500)

      return { success: true }
    }

    
    case 'GET_NODE_STATUS': {
      const deviceId = await getOrCreateDeviceId()
      const deviceName = await getDeviceName()
      const store = await chrome.storage.local.get(['node_code', 'is_bound', 'bound_user_id', STORAGE_KEYS.xsocialToken, STORAGE_KEYS.xUserInfo])

      let isBound = !!store.is_bound
      const nodeCode = store.node_code || null

      
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
          
          if (data.xAccount) {
            xUser = data.xAccount
            await chrome.storage.local.set({ [STORAGE_KEYS.xUserInfo]: data.xAccount })
          }
        } catch {  }
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

    
    case 'GET_CURRENT_TASK': {
      const store = await chrome.storage.local.get('current_task')
      return { success: true, data: store.current_task || null }
    }

    
    case 'GET_TASK_HISTORY': {
      const store = await chrome.storage.local.get('task_history')
      return { success: true, data: store.task_history || [] }
    }

    
    case 'RECOVER_NODE': {
      const { oldNodeCode } = message.payload || {} as { oldNodeCode?: string }
      if (!oldNodeCode) return { success: false, error: '请输入节点ID' }
      try {
        
        const res = await fetch(`${XSOCIAL_API}/api/market/manager/extensions/status?nodeCode=${oldNodeCode}`)
        const data = await res.json()
        if (!data.bound) return { success: false, error: `节点 ${oldNodeCode} 不存在或未绑定` }
        
        await chrome.storage.local.set({
          recover_node_code: oldNodeCode,
          node_code: oldNodeCode.toUpperCase(),
          is_bound: true,
        })
        await saveToSync({ node_code: oldNodeCode.toUpperCase(), is_bound: true })
        
        disconnectWS()
        setTimeout(connectWS, 500)
        return { success: true }
      } catch {
        return { success: false, error: '网络错误' }
      }
    }

    
    case 'GET_KPI': {
      const store = await chrome.storage.local.get('daily_kpi')
      return { success: true, data: store.daily_kpi || {} }
    }

    
    case 'RELAY_TO_TAB': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, message.payload)
        } catch {  }
      }
      return { success: true }
    }

    
    case 'FOLLOW_AUTO_GET_STATE': {
      return { success: true, data: { state: getFollowAutoState(), config: getFollowAutoConfig() } }
    }

    case 'FOLLOW_AUTO_START': {
      const { config: startConfig } = message.payload || {}
      await startFollowAutomation(startConfig)
      return { success: true, data: getFollowAutoState() }
    }

    case 'FOLLOW_AUTO_PAUSE': {
      pauseFollowAutomation()
      return { success: true, data: getFollowAutoState() }
    }

    case 'FOLLOW_AUTO_UPDATE_CONFIG': {
      updateFollowAutoConfig(message.payload || {})
      return { success: true, data: getFollowAutoConfig() }
    }

    
    case 'LIKE_AUTO_GET_STATE': {
      return { success: true, data: { state: getLikeAutoState(), config: getLikeAutoConfig() } }
    }

    case 'LIKE_AUTO_TOGGLE': {
      const { enabled } = message.payload || {}
      await toggleLikeAuto(!!enabled)
      return { success: true, data: getLikeAutoState() }
    }

    case 'LIKE_AUTO_UPDATE_CONFIG': {
      await setLikeAutoConfig(message.payload || {})
      return { success: true, data: { state: getLikeAutoState(), config: getLikeAutoConfig() } }
    }

    
    case 'MODEL_GET_STATE': {
      return { success: true, data: { state: getModelState(), presets: getPresetModels() } }
    }

    case 'MODEL_SAVE_KEY': {
      const { modelId: saveId, apiKey: saveKey } = message.payload || {}
      if (!saveId || !saveKey) return { success: false, error: '缺少参数' }
      try {
        await saveUserModel(saveId, saveKey.trim())
        return { success: true, data: getModelState() }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    case 'MODEL_REMOVE': {
      const { modelId: removeId } = message.payload || {}
      if (!removeId) return { success: false, error: '缺少 modelId' }
      await removeUserModel(removeId)
      return { success: true, data: getModelState() }
    }

    case 'MODEL_SET_ACTIVE': {
      const { modelId: activateId } = message.payload || {}
      try {
        await setActiveModel(activateId || null)
        return { success: true, data: getModelState() }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    case 'MODEL_TEST': {
      const { modelId: testId } = message.payload || {}
      if (!testId) return { success: false, error: '缺少 modelId' }
      const testResult = await testModel(testId)
      return { success: true, data: { ...testResult, state: getModelState() } }
    }

    
    case 'TOOL_FOLLOW': {
      const { screenName: followTarget } = message.payload || {}
      if (!followTarget) return { success: false, error: '请输入用户名' }

      const cookies = await getXCookies()
      if (!cookies) return { success: false, error: '未登录 X，请先在浏览器打开 x.com' }

      
      const targetUser = await getUserByScreenName(cookies, followTarget.replace(/^@/, ''))
      if (!targetUser) return { success: false, error: `找不到用户 @${followTarget}` }

      const result = await followUser(cookies, targetUser.id)
      if (result.success) {
        await incrementKpi('follows')
      }
      return { success: result.success, data: targetUser, error: result.error }
    }

    
    case 'TOOL_LIKE': {
      const { tweetUrl } = message.payload || {}
      if (!tweetUrl) return { success: false, error: '请输入推文链接' }

      
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/)
      if (!tweetIdMatch) return { success: false, error: '无效的推文链接，需包含 /status/数字' }
      const extractedTweetId = tweetIdMatch[1]

      const cookies = await getXCookies()
      if (!cookies) return { success: false, error: '未登录 X' }

      const likeResult = await likeTweet(cookies, extractedTweetId)
      if (likeResult.success) {
        await incrementKpi('likes')
      }
      return { success: likeResult.success, error: likeResult.success ? undefined : '点赞失败' }
    }

    
    case 'TOOL_MUTUAL_STATUS': {
      const store = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
      const token = store[STORAGE_KEYS.xsocialToken]
      if (!token) return { success: false, error: '未登录 xSocial' }

      try {
        const res = await fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/mutual-check?action=status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        return { success: res.ok, data, error: data.error }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    
    case 'TOOL_MUTUAL_CHECK': {
      const cookies = await getXCookies()
      if (!cookies) return { success: false, error: '未登录 X' }

      const store = await chrome.storage.local.get([STORAGE_KEYS.xsocialToken, STORAGE_KEYS.xUserInfo])
      const token = store[STORAGE_KEYS.xsocialToken]
      const xUser = store[STORAGE_KEYS.xUserInfo]

      
      if (token) {
        try {
          const statusRes = await fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/mutual-check?action=status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const statusData = await statusRes.json()
          if (!statusData.canScan) {
            return {
              success: false,
              error: `扫描冷却中，下次可扫描: ${new Date(statusData.cooldownUntil).toLocaleDateString('zh-CN')}`,
              data: { cooldown: true, cooldownUntil: statusData.cooldownUntil },
            }
          }
        } catch {  }
      }

      const startTime = Date.now()
      try {
        const followingIds = await getFollowingIds(cookies)
        const followerIds = await getFollowerIds(cookies)

        const followerSet = new Set(followerIds)
        const nonFollowerIds = followingIds.filter(id => !followerSet.has(id))

        const result = {
          totalFollowing: followingIds.length,
          totalFollowers: followerIds.length,
          nonFollowers: nonFollowerIds.map(id => ({ userId: id })),
          mutualCount: followingIds.length - nonFollowerIds.length,
          scanTime: Date.now() - startTime,
        }

        
        await chrome.storage.local.set({ mutual_check_result: result })
        await incrementKpi('followChecks')

        
        if (token) {
          fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/mutual-check`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              xScreenName: xUser?.screenName || '',
              followingIds,
              followerIds,
              scanDurationMs: result.scanTime,
            }),
          }).catch(() => {  })
        }

        return { success: true, data: result }
      } catch (err: any) {
        return { success: false, error: err.message || '扫描失败' }
      }
    }

    
    case 'TOOL_GET_MUTUAL_RESULT': {
      const cached = await chrome.storage.local.get('mutual_check_result')
      return { success: true, data: cached.mutual_check_result || null }
    }

    
    case 'TOOL_START_UNFOLLOW_PLAN': {
      const { nonFollowers: planTargets, config: planConfig } = message.payload || {}
      if (!planTargets?.length) return { success: false, error: '无取关目标' }

      
      const hourlyRate = planConfig?.hourlyRate || 15
      const activeHours = (planConfig?.activeHoursEnd || 23) - (planConfig?.activeHoursStart || 8)
      const dailyLimit = hourlyRate * activeHours

      
      const intervalSec = Math.max(30, Math.floor(3600 / hourlyRate))
      const unfollowConfig = {
        delayMin: intervalSec * 1000 * 0.7,
        delayMax: intervalSec * 1000 * 1.3,
        hourlyLimit: hourlyRate,
        dailyLimit,
      }

      const store = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
      const token = store[STORAGE_KEYS.xsocialToken] || ''

      const taskId = `unfollow-plan-${Date.now()}`
      try {
        
        startApiUnfollow(taskId, planTargets, unfollowConfig, 0, token)
        return { success: true, data: { taskId, totalTargets: planTargets.length, dailyLimit, hourlyRate } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    
    case 'TOOL_PAUSE_UNFOLLOW': {
      pauseUnfollow()
      return { success: true }
    }

    
    case 'TOOL_GET_UNFOLLOW_PROGRESS': {
      const unfollowState = getUnfollowStatus()
      return { success: true, data: unfollowState }
    }

    
    case 'TOOL_POST_STATUS': {
      const store = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
      const token = store[STORAGE_KEYS.xsocialToken]
      if (!token) return { success: false, error: '未登录 xSocial' }
      try {
        const res = await fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/ai-post`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        return { success: res.ok, data: await res.json() }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }

    
    case 'TOOL_AI_POLISH': {
      const { text, targetLength = 280, style = 'casual', language = 'zh' } = message.payload || {}
      if (!text || text.trim().length < 5) return { success: false, error: '输入内容不能少于5个字' }

      const styleMap: Record<string, string> = {
        casual: '随意自然', professional: '专业严谨', humorous: '幽默风趣', provocative: '犀利直接',
      }
      const langDesc = language === 'en' ? '英文' : '中文'

      
      if (hasActiveUserModel()) {
        try {
          const prompt = `你是社交媒体文案润色专家。润色以下内容为约${targetLength}字的${langDesc}推文，风格${styleMap[style] || '随意自然'}。保留核心观点，去口头禅，不加hashtag和表情，直接输出润色内容。\n\n原文:\n${text.trim()}`
          const polished = await callUserModel(prompt, { maxTokens: Math.max(800, targetLength * 2) })
          const cleaned = polished.replace(/^["「『]|["」』]$/g, '').replace(/^(润色[后]?[：:]\s*)/i, '').trim()
          return {
            success: true,
            data: {
              text: cleaned, originalLength: text.trim().length, polishedLength: cleaned.length,
              source: 'user_model', remaining: null, dailyLimit: null,
            },
          }
        } catch (err: any) {
          
          return {
            success: false,
            error: `你配置的 AI 模型出错: ${err.message}`,
            data: { source: 'user_model', modelError: true },
          }
        }
      }

      
      const store = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
      const token = store[STORAGE_KEYS.xsocialToken]
      if (!token) return { success: false, error: '未登录 xSocial' }

      try {
        const res = await fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/ai-post`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ text, targetLength, style, language }),
        })
        const data = await res.json()
        if (!res.ok) return { success: false, error: data.error || 'AI 润色失败', data }
        return { success: true, data: { ...data, source: 'platform' } }
      } catch (err: any) {
        return { success: false, error: err.message || 'AI 润色失败' }
      }
    }

    
    case 'TOOL_DIRECT_POST': {
      const { text: postText } = message.payload || {}
      if (!postText?.trim()) return { success: false, error: '帖子内容不能为空' }

      const cookies = await getXCookies()
      if (!cookies) return { success: false, error: '未登录 X' }

      const tweetResult = await createTweet(cookies, postText.trim())
      if (tweetResult.success) {
        await incrementKpi('posts')
      }
      return {
        success: tweetResult.success,
        data: { tweetId: tweetResult.tweetId },
        error: tweetResult.error,
      }
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` }
  }
}


async function incrementKpi(field: string): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const store = await chrome.storage.local.get('daily_kpi')
    const kpi = store.daily_kpi || {}
    
    if (kpi.date !== today) {
      Object.keys(kpi).forEach(k => { if (k !== 'date') kpi[k] = 0 })
      kpi.date = today
    }
    kpi[field] = (kpi[field] || 0) + 1
    await chrome.storage.local.set({ daily_kpi: kpi })
  } catch {  }
}


async function handleToolCommand(tool: string, action: string, config?: any): Promise<void> {
  switch (tool) {
    case 'follow':
      if (config) updateFollowAutoConfig(config)
      if (action === 'start') startFollowAutomation(config)
      if (action === 'pause') pauseFollowAutomation()
      break
    case 'like':
      if (action === 'toggle' && config) toggleLikeAuto(config.enabled)
      if (action === 'sync' && config) setLikeAutoConfig(config)
      break
    case 'mutual-check':
      if (action === 'scan') {
        
        const cookies = await getXCookies()
        if (cookies) {
          const followingIds = await getFollowingIds(cookies)
          const followerIds = await getFollowerIds(cookies)
          const followerSet = new Set(followerIds)
          const nonFollowerIds = followingIds.filter(id => !followerSet.has(id))
          await chrome.storage.local.set({
            mutual_check_result: {
              totalFollowing: followingIds.length,
              totalFollowers: followerIds.length,
              nonFollowers: nonFollowerIds.map(id => ({ userId: id })),
              mutualCount: followingIds.length - nonFollowerIds.length,
              scanTime: 0,
            },
          })
          
          const store = await chrome.storage.local.get([STORAGE_KEYS.xsocialToken, STORAGE_KEYS.xUserInfo])
          if (store[STORAGE_KEYS.xsocialToken]) {
            fetch(`${XSOCIAL_API}/api/market/follow-pool/extension/mutual-check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store[STORAGE_KEYS.xsocialToken]}` },
              body: JSON.stringify({ xScreenName: store[STORAGE_KEYS.xUserInfo]?.screenName || '', followingIds, followerIds, scanDurationMs: 0 }),
            }).catch(() => {})
          }
        }
      }
      if (action === 'start-unfollow' && config) {
        const cachedResult = await chrome.storage.local.get('mutual_check_result')
        const nonFollowers = cachedResult.mutual_check_result?.nonFollowers || []
        if (nonFollowers.length > 0) {
          const hourlyRate = config.hourlyRate || 15
          const activeHours = (config.activeHoursEnd || 23) - (config.activeHoursStart || 8)
          const intervalSec = Math.max(30, Math.floor(3600 / hourlyRate))
          const store = await chrome.storage.local.get(STORAGE_KEYS.xsocialToken)
          startApiUnfollow(`unfollow-plan-${Date.now()}`, nonFollowers,
            { delayMin: intervalSec * 700, delayMax: intervalSec * 1300, hourlyLimit: hourlyRate, dailyLimit: hourlyRate * activeHours },
            0, store[STORAGE_KEYS.xsocialToken] || '')
        }
      }
      if (action === 'pause-unfollow') pauseUnfollow()
      break
    case 'model':
      if (action === 'sync' && config) {
        
        if (config.activeModelId !== undefined) setActiveModel(config.activeModelId)
        if (config.userModels) {
          for (const m of config.userModels) {
            if (m.modelId && m.apiKey) saveUserModel(m.modelId, m.apiKey)
          }
        }
      }
      break
  }
}

async function applyToolConfig(fullConfig: any): Promise<void> {
  if (!fullConfig) return
  
  await chrome.storage.local.set({ toolbox_config_version: fullConfig.configVersion || 0 })

  
  if (fullConfig.follow) updateFollowAutoConfig(fullConfig.follow)
  if (fullConfig.like) setLikeAutoConfig(fullConfig.like)
  if (fullConfig.model) {
    if (fullConfig.model.activeModelId !== undefined) setActiveModel(fullConfig.model.activeModelId)
    if (fullConfig.model.userModels) {
      for (const m of fullConfig.model.userModels) {
        if (m.modelId && m.apiKey) saveUserModel(m.modelId, m.apiKey)
      }
    }
  }

  logger.info(`[SW] 工具箱配置已同步 v${fullConfig.configVersion}`)
}


chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch(() => {  })


chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.info('[SW] Extension installed — restoring from sync...')
    await restoreFromSync()
    
    
    await chrome.storage.local.set({ is_bound: false, bound_user_id: null })
    logger.info('[SW] 重装: 已清除绑定状态，需要重新登录选择节点')
  } else if (details.reason === 'update') {
    logger.info(`[SW] Extension updated to v${chrome.runtime.getManifest().version}`)
  }
  connectWS()
})

chrome.runtime.onStartup.addListener(async () => {
  logger.info('[SW] Browser started')
  await restoreFromSync()
  await restoreFollowState()
  await restoreLikeState()
  await restoreModelState()
  fetchDynamicConfig() 
  connectWS()
})


chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('[Keepalive] WS disconnected, reconnecting...')
      connectWS()
    }
  }
})


chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  if (details.url.includes('x.com') || details.url.includes('twitter.com')) {
    logger.debug('[SW] SPA navigation:', details.url)
  }
})


async function moveTaskToHistory(status: 'completed' | 'aborted') {
  const store = await chrome.storage.local.get(['current_task', 'task_history', 'task_summary'])
  const current = store.current_task
  if (!current) {
    logger.warn('[SW] moveTaskToHistory: current_task 为空，无法移入历史')
    return
  }
  logger.info(`[SW] moveTaskToHistory: ${current.taskId}, steps=${current.steps?.length}, summary=${store.task_summary ? 'yes' : 'no'}`)

  
  if (current.steps) {
    for (const step of current.steps) {
      if (step.status === 'running') step.status = status === 'completed' ? 'completed' : 'failed'
      if (step.status === 'pending') step.status = status === 'completed' ? 'completed' : 'skipped'
    }
  }

  
  const summary = store.task_summary || null
  const completedTask = { ...current, status, completedAt: Date.now(), summary }

  const history = store.task_history || []
  history.unshift(completedTask)
  if (history.length > 50) history.length = 50

  
  await chrome.storage.local.set({
    current_task: completedTask,
    task_history: history,
  })
  await chrome.storage.local.remove('task_summary')

  
  setTimeout(async () => {
    await chrome.storage.local.remove('current_task')
  }, 10_000)
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


restoreFromSync().then(() => connectWS())

logger.info('[SW] Service Worker v4 started')
