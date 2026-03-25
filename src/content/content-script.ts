import { logger } from '@utils/logger'

/**
 * Content Script — v4.2 浏览器 Agent 感知+执行层
 *
 * 注入到 x.com / twitter.com 页面 (ISOLATED world)
 *
 * 核心能力:
 *   1. snapshot() — 针对 Twitter data-testid 结构的 DOM 遍历
 *   2. executeAction() — click/type/press 原子操作 (isTrusted:true)
 *   3. 消息处理 — 接收 background service-worker 指令
 *
 * 设计原则:
 *   - 不用 CDP (避免黄色 debugger 提示条)
 *   - 针对 Twitter 实际 DOM 结构优化 (data-testid)
 *   - 滚动用键盘 j/k (Twitter 原生快捷键)
 */

// ===== Ref 管理 =====

const refMap = new Map<string, Element>()
let refCounter = 0

function resetRefs(): void {
  refMap.clear()
  refCounter = 0
}

function assignRef(el: Element): string {
  const ref = `e${++refCounter}`
  refMap.set(ref, el)
  return ref
}

// ===== Snapshot — Twitter 专用 DOM 提取 =====

function getSnapshot(): { snapshot: string; elementCount: number } {
  resetRefs()
  const lines: string[] = []

  // 1. 导航栏 (简化)
  const nav = document.querySelector('nav[role="navigation"]')
  if (nav) {
    const navLinks = nav.querySelectorAll('a[href]')
    for (const link of navLinks) {
      const text = (link as HTMLElement).innerText?.trim()
      if (text && text.length < 50) {
        const ref = assignRef(link)
        lines.push(`link "${text}" [ref=${ref}]`)
      }
    }
  }

  // 2. 发帖框
  const composeBox = document.querySelector('[data-testid="tweetTextarea_0"]')
  if (composeBox) {
    const ref = assignRef(composeBox)
    lines.push(`textbox "发帖框" [ref=${ref}]`)
  }

  // 3. Tab 切换 (为你推荐 / 正在关注)
  const tabList = document.querySelector('[role="tablist"]')
  if (tabList) {
    const tabs = tabList.querySelectorAll('[role="tab"]')
    for (const tab of tabs) {
      const text = (tab as HTMLElement).innerText?.trim()
      if (text) {
        const ref = assignRef(tab)
        const selected = tab.getAttribute('aria-selected') === 'true' ? ' [selected]' : ''
        lines.push(`tab "${text}"${selected} [ref=${ref}]`)
      }
    }
  }

  // 3.5 Profile 页面 — 关注/取关按钮
  const followBtn = document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]') as HTMLElement
  if (followBtn) {
    const ref = assignRef(followBtn)
    const isFollowing = followBtn.getAttribute('data-testid')?.includes('unfollow')
    const label = isFollowing ? '正在关注' : '关注'
    lines.push(`button "${label}" [ref=${ref}]`)
  }

  // 4. 推文列表 — 核心内容
  const tweets = document.querySelectorAll('[data-testid="tweet"]')
  for (const tweet of tweets) {
    const tweetRef = assignRef(tweet)
    const tweetLines: string[] = []

    // 用户名 + handle + 时间 + 可点击的 profile 链接
    const userNameEl = tweet.querySelector('[data-testid="User-Name"]')
    if (userNameEl) {
      const userName = (userNameEl as HTMLElement).innerText?.replace(/\n/g, ' ').trim()
      // 检测蓝V认证 (verified badge)
      const isVerified = !!(userNameEl.querySelector('[data-testid="icon-verified"]') ||
                           userNameEl.querySelector('svg[aria-label*="认证"]') ||
                           userNameEl.querySelector('svg[aria-label*="Verified"]') ||
                           userNameEl.querySelector('svg[aria-label*="verified"]'))
      const badge = isVerified ? ' [蓝V]' : ''
      if (userName) tweetLines.push(`  user "${userName}"${badge}`)
      // 提取用户 profile 链接
      const profileLink = userNameEl.querySelector('a[href]') as HTMLAnchorElement
      if (profileLink && !profileLink.href.includes('/status/')) {
        const profileRef = assignRef(profileLink)
        const handle = profileLink.getAttribute('href')?.replace('/', '@') || ''
        tweetLines.push(`  link "用户主页 ${handle}" [ref=${profileRef}]`)
      }
    }

    // 推文正文
    const tweetText = tweet.querySelector('[data-testid="tweetText"]')
    if (tweetText) {
      const text = (tweetText as HTMLElement).innerText?.trim()
      if (text) {
        const textRef = assignRef(tweetText)
        tweetLines.push(`  text "${text.slice(0, 280)}" [ref=${textRef}]`)
      }
    }

    // 图片
    const images = tweet.querySelectorAll('[data-testid="tweetPhoto"] img')
    for (const img of images) {
      const alt = img.getAttribute('alt') || '图片'
      tweetLines.push(`  img "${alt.slice(0, 100)}"`)
    }

    // 互动按钮
    const replyBtn = tweet.querySelector('[data-testid="reply"]')
    if (replyBtn) {
      const replyRef = assignRef(replyBtn)
      const count = replyBtn.getAttribute('aria-label') || ''
      tweetLines.push(`  button "回复 ${count}" [ref=${replyRef}]`)
    }

    const retweetBtn = tweet.querySelector('[data-testid="retweet"]')
    if (retweetBtn) {
      const rtRef = assignRef(retweetBtn)
      const count = retweetBtn.getAttribute('aria-label') || ''
      tweetLines.push(`  button "转发 ${count}" [ref=${rtRef}]`)
    }

    const likeBtn = tweet.querySelector('[data-testid="like"]') || tweet.querySelector('[data-testid="unlike"]')
    if (likeBtn) {
      const likeRef = assignRef(likeBtn)
      const count = likeBtn.getAttribute('aria-label') || ''
      const liked = likeBtn.getAttribute('data-testid') === 'unlike' ? ' [已赞]' : ''
      tweetLines.push(`  button "点赞 ${count}${liked}" [ref=${likeRef}]`)
    }

    const bookmarkBtn = tweet.querySelector('[data-testid="bookmark"]')
    if (bookmarkBtn) {
      const bmRef = assignRef(bookmarkBtn)
      tweetLines.push(`  button "收藏" [ref=${bmRef}]`)
    }

    // 推文链接 (用于点击进入详情)
    const tweetLink = tweet.querySelector('a[href*="/status/"]')
    if (tweetLink) {
      const linkRef = assignRef(tweetLink)
      const href = tweetLink.getAttribute('href') || ''
      tweetLines.push(`  link "${href}" [ref=${linkRef}]`)
    }

    if (tweetLines.length > 0) {
      lines.push(`article "推文" [ref=${tweetRef}]`)
      lines.push(...tweetLines)
    }
  }

  // 4.5 Hover Card 弹窗 — #layers 里的悬停用户卡片
  const layersEl = document.getElementById('layers')
  if (layersEl) {
    const followBtnInLayers = layersEl.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]') as HTMLElement
    if (followBtnInLayers) {
      const ref = assignRef(followBtnInLayers)
      const isFollowing = followBtnInLayers.getAttribute('data-testid')?.includes('unfollow')
      // 尝试获取用户名
      const nameEl = layersEl.querySelector('a[role="link"] span') || layersEl.querySelector('[dir="ltr"] span')
      const name = (nameEl as HTMLElement)?.textContent?.trim() || ''
      lines.push(`hovercard "${name}"`)
      lines.push(`  button "${isFollowing ? '正在关注' : '关注'}" [ref=${ref}]`)
    }
  }

  // 5. 右侧栏 — 趋势
  const trending = document.querySelector('[aria-label="时间线：趋势"]') ||
                   document.querySelector('[data-testid="trend"]')?.closest('section')
  if (trending) {
    const trends = trending.querySelectorAll('[data-testid="trend"]')
    if (trends.length > 0) {
      lines.push(`region "趋势"`)
      for (const trend of Array.from(trends).slice(0, 5)) {
        const text = (trend as HTMLElement).innerText?.replace(/\n/g, ' ').trim().slice(0, 80)
        if (text) {
          const ref = assignRef(trend)
          lines.push(`  link "${text}" [ref=${ref}]`)
        }
      }
    }
  }

  // 6. 右侧栏 — 推荐关注
  const whoToFollow = document.querySelector('[data-testid="UserCell"]')?.closest('aside')
  if (whoToFollow) {
    const users = whoToFollow.querySelectorAll('[data-testid="UserCell"]')
    if (users.length > 0) {
      lines.push(`region "推荐关注"`)
      for (const user of Array.from(users).slice(0, 3)) {
        const text = (user as HTMLElement).innerText?.replace(/\n/g, ' ').trim().slice(0, 60)
        if (text) {
          const ref = assignRef(user)
          lines.push(`  generic "${text}" [ref=${ref}]`)
        }
      }
    }
  }

  // 7. 对话框/弹窗 (回复框等)
  const dialogs = document.querySelectorAll('[role="dialog"]')
  for (const dialog of dialogs) {
    const dialogRef = assignRef(dialog)
    lines.push(`dialog [ref=${dialogRef}]`)
    // 对话框内的输入框
    const inputs = dialog.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"]')
    for (const input of inputs) {
      const ref = assignRef(input)
      const placeholder = input.getAttribute('aria-label') || input.getAttribute('placeholder') || '输入框'
      lines.push(`  textbox "${placeholder}" [ref=${ref}]`)
    }
    // 对话框内的按钮
    const buttons = dialog.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
    for (const btn of buttons) {
      const ref = assignRef(btn)
      lines.push(`  button "发送" [ref=${ref}]`)
    }
  }

  // 8. 页面信息
  const pageInfo = `[page] url=${location.href} title=${document.title}`
  lines.push(pageInfo)

  return { snapshot: lines.join('\n'), elementCount: refCounter }
}

// ===== Action 执行 — 原子操作 =====

interface ActionConfig {
  type: 'click' | 'type' | 'press' | 'scroll' | 'hover'
  ref?: string
  text?: string
  key?: string
  pixels?: number
  humanDelay?: boolean
}

async function executeAction(config: ActionConfig): Promise<{ success: boolean; error?: string; hoverCardFound?: boolean; autoFollowed?: boolean; alreadyFollowing?: boolean }> {
  const { type, ref, text, key, pixels, humanDelay } = config

  // scroll — 最简单直接的滚动
  if (type === 'scroll') {
    const amount = pixels || 600
    console.log(`[xSocial] scroll executing: ${amount}px`)
    // 方法1: scrollingElement (最通用)
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop += amount
      console.log(`[xSocial] scrollingElement.scrollTop = ${document.scrollingElement.scrollTop}`)
    }
    // 方法2: documentElement
    document.documentElement.scrollTop += amount
    // 方法3: body
    document.body.scrollTop += amount
    // 方法4: window
    window.scrollBy(0, amount)
    await sleep(500)
    return { success: true }
  }

  // press — 通用键盘按键
  if (type === 'press') {
    const keyStr = key || 'Enter'

    // PageDown/PageUp/ArrowDown — 用真实滚动代替 (dispatchEvent 是 isTrusted:false)
    if (keyStr === 'PageDown' || keyStr === 'ArrowDown' || keyStr === 'j') {
      console.log('[xSocial] press PageDown → scrollIntoView next tweet')
      const tweets = document.querySelectorAll('[data-testid="tweet"]')
      const viewMid = window.innerHeight / 2
      let target: Element | null = null
      for (const t of tweets) {
        if (t.getBoundingClientRect().top > viewMid) { target = t; break }
      }
      if (!target && tweets.length > 0) target = tweets[tweets.length - 1]
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        document.scrollingElement && (document.scrollingElement.scrollTop += 500)
      }
      await sleep(400)
      return { success: true }
    }

    if (keyStr === 'PageUp' || keyStr === 'ArrowUp' || keyStr === 'k') {
      document.scrollingElement && (document.scrollingElement.scrollTop -= 500)
      await sleep(400)
      return { success: true }
    }

    // 其他按键正常 dispatch
    const parts = keyStr.split('+')
    const keyName = parts.pop()!
    const mods = parts.map(m => m.toLowerCase())
    const keyTarget = ref ? refMap.get(ref) || document.activeElement || document.body : document.activeElement || document.body

    for (const evType of ['keydown', 'keypress', 'keyup'] as const) {
      keyTarget.dispatchEvent(new KeyboardEvent(evType, {
        key: keyName, code: keyName,
        ctrlKey: mods.includes('ctrl'),
        shiftKey: mods.includes('shift'),
        metaKey: mods.includes('meta'),
        altKey: mods.includes('alt'),
        bubbles: true, cancelable: true,
      }))
    }
    return { success: true }
  }

  // 特殊 ref: __tweetButton__ — 自动找发送按钮
  if (ref === '__tweetButton__' && type === 'click') {
    const sendBtn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') as HTMLElement
    if (!sendBtn) return { success: false, error: '找不到发送按钮' }
    logger.info(`[Content] 自动点击发送按钮: ${sendBtn.textContent?.trim()}`)
    sendBtn.click()
    await sleep(500)
    return { success: true }
  }

  // click / type — 需要 ref
  if (!ref) return { success: false, error: 'ref is required' }
  const el = refMap.get(ref)
  if (!el) return { success: false, error: `ref ${ref} not found` }

  if (type === 'hover') {
    const htmlEl = el as HTMLElement
    // 模拟鼠标悬停 — 触发 Twitter 的 hover card
    const rect = htmlEl.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }
    htmlEl.dispatchEvent(new MouseEvent('mouseover', opts))
    htmlEl.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }))
    // pointerenter 也发一下 (React 17+ 可能监听 pointer 事件)
    htmlEl.dispatchEvent(new PointerEvent('pointerover', { ...opts, bubbles: true }))
    htmlEl.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }))
    logger.info(`[Content] hover 完成: ${htmlEl.tagName} at (${Math.round(cx)}, ${Math.round(cy)})`)
    // 等弹窗渲染 (Twitter hover card 有延迟)
    await sleep(1500)
    // 检查 #layers 里有没有弹出关注按钮
    const layersCheck = document.getElementById('layers')
    const hcBtn = layersCheck?.querySelector('[data-testid$="-follow"]') as HTMLElement
    const hcUnfollow = layersCheck?.querySelector('[data-testid$="-unfollow"]')
    logger.info(`[Content] hover card 检测: layers=${!!layersCheck}, followBtn=${!!hcBtn}, unfollowBtn=${!!hcUnfollow}`)
    if (hcBtn && !hcUnfollow) {
      // 弹窗里有关注按钮且未关注 → 直接点击关注
      hcBtn.click()
      logger.info(`[Content] hover card 自动点击关注!`)
      await sleep(800)
      // 点空白区域关闭弹窗
      document.body.click()
      await sleep(300)
      return { success: true, hoverCardFound: true, autoFollowed: true }
    }
    return { success: true, hoverCardFound: !!hcBtn || !!hcUnfollow, alreadyFollowing: !!hcUnfollow }
  }

  if (type === 'click') {
    const htmlEl = el as HTMLElement

    // ---- 安全检查: 弹窗已打开时禁止再点回复/转发按钮 ----
    const isReplyBtn = htmlEl.closest('[data-testid="reply"]') ||
                       htmlEl.textContent?.includes('回复') ||
                       htmlEl.getAttribute('aria-label')?.includes('回复') ||
                       htmlEl.getAttribute('aria-label')?.includes('Reply')
    if (isReplyBtn) {
      const dialogOpen = document.querySelector('[role="dialog"]') ||
                         window.location.pathname.includes('/compose/')
      if (dialogOpen) {
        logger.warn('[Content] ⛔ 回复弹窗已打开, 禁止再次点击回复按钮')
        return { success: false, error: '回复弹窗已打开, 禁止重复点击回复按钮' }
      }
    }

    htmlEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(humanDelay ? randomInt(300, 600) : 100)
    htmlEl.click()

    // ---- 点击后验证 ----
    await sleep(300)
    logger.info('[Content] click 完成:', htmlEl.tagName, htmlEl.textContent?.slice(0, 30))
    return { success: true }
  }

  if (type === 'type') {
    logger.info('[Content] type: 请求 service-worker 在 MAIN world 执行 paste')
    // content-script (isolated world) 无法让 Draft.js 识别输入
    // 必须在 MAIN world 执行, 通过 service-worker 的 chrome.scripting.executeScript 实现
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'EXECUTE_IN_MAIN_WORLD',
        payload: { text }
      }, (response) => {
        logger.info('[Content] MAIN world 执行结果:', response)
        resolve(response || { success: true })
      })
    })
  }

  return { success: false, error: `Unknown action: ${type}` }
}

// ===== 工具 =====

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ===== 方案B: 页面滚动取关引擎 =====

let unfollowScanRunning = false
let unfollowExecRunning = false
let unfollowStopRequested = false

interface PageNonFollower {
  userId?: string
  screenName: string
  displayName: string
  cellElement: Element
}

/**
 * 方案B 扫描: 在"正在关注"页面自动滚动，找出没有"关注了你"标签的人
 */
async function scanFollowingPage(taskId: string, xScreenName: string, token: string): Promise<void> {
  unfollowScanRunning = true
  unfollowStopRequested = false

  const nonFollowers: Array<{ screenName: string; displayName: string }> = []
  const seenHandles = new Set<string>()
  let noNewCount = 0

  logger.info('[Unfollow-Page] 开始页面滚动扫描...')

  while (!unfollowStopRequested) {
    // 扫描当前可见的用户卡片
    const cells = document.querySelectorAll('[data-testid="UserCell"]')
    let foundNew = false

    for (const cell of cells) {
      const linkEl = cell.querySelector('a[role="link"][href^="/"]') as HTMLAnchorElement
      if (!linkEl) continue

      const href = linkEl.getAttribute('href') || ''
      const handle = href.replace(/^\//, '').split('/')[0]
      if (!handle || seenHandles.has(handle)) continue

      seenHandles.add(handle)
      foundNew = true

      const nameEl = cell.querySelector('[dir="ltr"] span') as HTMLElement
      const displayName = nameEl?.textContent?.trim() || handle

      // 检查是否有"关注了你" / "Follows you" 标签
      const cellText = (cell as HTMLElement).innerText || ''
      const followsYou = cellText.includes('关注了你') || cellText.includes('Follows you')

      if (!followsYou) {
        nonFollowers.push({ screenName: handle, displayName })
        logger.info(`[Unfollow-Page] 发现未回关: @${handle}`)
      }
    }

    if (!foundNew) {
      noNewCount++
      if (noNewCount > 5) {
        logger.info('[Unfollow-Page] 连续5次滚动无新用户, 扫描结束')
        break
      }
    } else {
      noNewCount = 0
    }

    // 滚动加载更多
    window.scrollBy(0, 800)
    await sleep(randomInt(1000, 3000))
  }

  logger.info(`[Unfollow-Page] 扫描完成: 共检查 ${seenHandles.size} 人, 发现 ${nonFollowers.length} 个未回关`)

  // 上报结果到服务端
  try {
    await fetch(`https://xsocial.cc/api/market/manager/x-maintenance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        taskId,
        nonFollowers: nonFollowers.map(nf => ({
          userId: '',
          screenName: nf.screenName,
          displayName: nf.displayName,
        })),
        totalFollowing: seenHandles.size,
        totalFollowers: 0,
      }),
    })
  } catch (err) {
    logger.warn('[Unfollow-Page] 上报扫描结果失败:', err)
  }

  // 通知 service-worker
  chrome.runtime.sendMessage({
    type: 'UNFOLLOW_SCAN_DONE',
    payload: { taskId, nonFollowerCount: nonFollowers.length, totalScanned: seenHandles.size },
  }).catch(() => {})

  unfollowScanRunning = false
}

/**
 * 方案B 执行: 在"正在关注"页面滚动并取关没有"关注了你"的人
 * 真人模式: 滚动 → 检测 → 点"正在关注"按钮 → 确认取关 → 等待 → 继续
 */
async function executePageUnfollow(
  taskId: string,
  config: { delayMin: number; delayMax: number; hourlyLimit: number; dailyLimit: number },
  startIndex: number,
  token: string
): Promise<void> {
  unfollowExecRunning = true
  unfollowStopRequested = false

  const seenHandles = new Set<string>()
  let unfollowedCount = 0
  let failedCount = 0
  let processedIndex = startIndex
  let hourlyCount = 0
  let dailyCount = 0
  let noNewCount = 0
  const actions: Array<{ userId: string; screenName: string; success: boolean; timestamp: number; error?: string }> = []

  // 先滚动到之前处理的位置 (粗略跳过)
  if (startIndex > 0) {
    logger.info(`[Unfollow-Page] 跳过前 ${startIndex} 个已处理的用户...`)
    for (let skip = 0; skip < startIndex; skip++) {
      window.scrollBy(0, 100)
      if (skip % 20 === 0) await sleep(500)
    }
    await sleep(1000)
  }

  logger.info(`[Unfollow-Page] 开始页面取关, 从第 ${startIndex} 个开始`)

  while (!unfollowStopRequested) {
    // 检查频率限制
    if (hourlyCount >= config.hourlyLimit) {
      logger.info(`[Unfollow-Page] 达到每小时上限 ${config.hourlyLimit}, 暂停`)
      break
    }
    if (dailyCount >= config.dailyLimit) {
      logger.info(`[Unfollow-Page] 达到每日上限 ${config.dailyLimit}, 暂停`)
      break
    }

    // 扫描当前可见的用户卡片
    const cells = document.querySelectorAll('[data-testid="UserCell"]')
    let foundAction = false

    for (const cell of cells) {
      if (unfollowStopRequested) break
      if (hourlyCount >= config.hourlyLimit || dailyCount >= config.dailyLimit) break

      const linkEl = cell.querySelector('a[role="link"][href^="/"]') as HTMLAnchorElement
      if (!linkEl) continue

      const href = linkEl.getAttribute('href') || ''
      const handle = href.replace(/^\//, '').split('/')[0]
      if (!handle || seenHandles.has(handle)) continue

      seenHandles.add(handle)
      processedIndex++

      const cellText = (cell as HTMLElement).innerText || ''
      const followsYou = cellText.includes('关注了你') || cellText.includes('Follows you')

      if (followsYou) continue // 互关, 跳过

      // 找到未回关的人 → 取关
      foundAction = true

      // 找到"正在关注"按钮
      const followingBtn = cell.querySelector('[data-testid$="-unfollow"]') as HTMLElement
      if (!followingBtn) {
        logger.warn(`[Unfollow-Page] @${handle} 没找到取关按钮, 跳过`)
        failedCount++
        continue
      }

      // 滚动到可见位置
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await sleep(randomInt(500, 1000))

      // 点击"正在关注"按钮
      followingBtn.click()
      logger.info(`[Unfollow-Page] 点击取关按钮: @${handle}`)
      await sleep(randomInt(500, 1000))

      // 等待确认弹窗并点击确认
      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement
      if (confirmBtn) {
        confirmBtn.click()
        logger.info(`[Unfollow-Page] ✓ 确认取关 @${handle}`)
        unfollowedCount++
        hourlyCount++
        dailyCount++

        actions.push({
          userId: '',
          screenName: handle,
          success: true,
          timestamp: Date.now(),
        })
      } else {
        logger.warn(`[Unfollow-Page] 未出现确认弹窗, 可能已自动取关或失败`)
        // 有些情况下点按钮直接取关，没有确认弹窗
        unfollowedCount++
        hourlyCount++
        dailyCount++

        actions.push({
          userId: '',
          screenName: handle,
          success: true,
          timestamp: Date.now(),
        })
      }

      await sleep(300)

      // 定期上报进度
      if (actions.length >= 5) {
        reportPageProgress(token, taskId, unfollowedCount, failedCount, processedIndex, actions.splice(0))
      }

      // 人类延迟
      const delay = gaussianDelay(config.delayMin, config.delayMax)
      logger.info(`[Unfollow-Page] 等待 ${(delay / 1000).toFixed(1)}s...`)
      await sleep(delay)
    }

    if (!foundAction) {
      noNewCount++
      if (noNewCount > 8) {
        logger.info('[Unfollow-Page] 连续8次滚动无新目标, 任务完成')
        break
      }
    } else {
      noNewCount = 0
    }

    // 滚动加载更多
    window.scrollBy(0, 600)
    await sleep(randomInt(1000, 2000))
  }

  // 上报剩余进度
  if (actions.length > 0) {
    reportPageProgress(token, taskId, unfollowedCount, failedCount, processedIndex, actions.splice(0))
  }

  // 报告完成
  const completed = noNewCount > 8
  try {
    await fetch(`https://xsocial.cc/api/market/manager/x-maintenance/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        taskId,
        unfollowedCount,
        failedCount,
        lastProcessedIndex: processedIndex,
        completed,
      }),
    })
  } catch {}

  logger.info(`[Unfollow-Page] 本轮结束: 取关 ${unfollowedCount}, 失败 ${failedCount}`)
  unfollowExecRunning = false
}

function gaussianDelay(min: number, max: number): number {
  const mean = (min + max) / 2
  const stdDev = (max - min) / 4
  const u1 = Math.random(), u2 = Math.random()
  let val = mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev
  return Math.round(Math.max(min, Math.min(max, val)))
}

function reportPageProgress(
  token: string, taskId: string,
  unfollowedCount: number, failedCount: number,
  lastProcessedIndex: number,
  actionLog: any[]
) {
  fetch(`https://xsocial.cc/api/market/manager/x-maintenance/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ taskId, unfollowedCount, failedCount, lastProcessedIndex, actionLog }),
  }).catch(() => {})
}

// ===== 消息处理 =====

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => {
      logger.error('[Content] Error:', err)
      sendResponse({ success: false, error: err.message || String(err) })
    })
  return true
})

async function handleMessage(message: { type: string; payload?: any }) {
  switch (message.type) {
    case 'SNAPSHOT': {
      const result = getSnapshot()
      return {
        success: true,
        data: {
          snapshot: result.snapshot,
          elementCount: result.elementCount,
          url: location.href,
          title: document.title,
        },
      }
    }

    case 'ACTION': {
      const actionResult = await executeAction(message.payload)
      if (!actionResult.success) {
        return { success: false, error: actionResult.error, data: { url: location.href, title: document.title } }
      }
      await sleep(message.payload?.waitAfter || 600)
      const snap = getSnapshot()
      return {
        success: true,
        autoFollowed: actionResult.autoFollowed || false,
        data: {
          snapshot: snap.snapshot,
          elementCount: snap.elementCount,
          url: location.href,
          title: document.title,
          autoFollowed: actionResult.autoFollowed || false,
        },
      }
    }

    case 'GET_PAGE_INFO':
      return { success: true, data: { url: location.href, title: document.title } }

    // ===== 点赞伴随: 随机选一个可见推文 =====

    case 'LIKE_PICK_TWEET': {
      const allTweets = document.querySelectorAll('[data-testid="tweet"]')
      // 筛选: 在视口内 + 有 status 链接 + 未点赞
      const candidates: string[] = []
      for (const tweet of allTweets) {
        const rect = tweet.getBoundingClientRect()
        if (rect.top < 0 || rect.bottom > window.innerHeight) continue // 不在视口
        // 检查是否已点赞 (data-testid="unlike" 表示已赞)
        const likeBtn = tweet.querySelector('[data-testid="like"]')
        if (!likeBtn) continue // 已赞或无按钮
        // 提取 tweet ID
        const statusLink = tweet.querySelector('a[href*="/status/"]') as HTMLAnchorElement
        if (!statusLink) continue
        const m = statusLink.href.match(/status\/(\d+)/)
        if (m) candidates.push(m[1])
      }
      if (candidates.length === 0) return { success: false, error: 'No likeable tweets visible' }
      // 随机选一个
      const picked = candidates[Math.floor(Math.random() * candidates.length)]
      return { success: true, data: { tweetId: picked } }
    }

    // ===== 关注自动化: 页面扫描 =====

    // 扫描当前可见时间线推文，提取蓝V帖信息
    case 'FOLLOW_SCAN_TWEETS': {
      const tweets = document.querySelectorAll('[data-testid="tweet"]')
      const results: Array<{
        handle: string
        displayName: string
        text: string
        hasBlueVKeyword: boolean
        replyCount: number
        tweetUrl: string
        tweetLinkRef: string
      }> = []

      for (const tweet of tweets) {
        // 提取 handle
        const userNameEl = tweet.querySelector('[data-testid="User-Name"]')
        if (!userNameEl) continue
        const profileLink = userNameEl.querySelector('a[href^="/"]') as HTMLAnchorElement
        if (!profileLink || profileLink.href.includes('/status/')) continue
        const handle = (profileLink.getAttribute('href') || '').replace(/^\//, '').split('/')[0]
        if (!handle) continue

        const displayNameSpan = userNameEl.querySelector('span') as HTMLElement
        const displayName = displayNameSpan?.textContent?.trim() || handle

        // 提取正文
        const textEl = tweet.querySelector('[data-testid="tweetText"]') as HTMLElement
        const text = textEl?.innerText?.trim() || ''

        // 检测"蓝V"关键词
        const hasBlueVKeyword = /蓝[Vv]/.test(text)

        // 提取回帖数 — aria-label 格式: "123 Replies" 或 "123 条回复"
        const replyBtn = tweet.querySelector('[data-testid="reply"]')
        let replyCount = 0
        if (replyBtn) {
          const label = replyBtn.getAttribute('aria-label') || ''
          const m = label.match(/(\d[\d,.]*)\s/)
          if (m) {
            replyCount = parseInt(m[1].replace(/[,.]/g, ''), 10) || 0
          }
        }

        // 推文详情链接
        const tweetLink = tweet.querySelector('a[href*="/status/"]') as HTMLAnchorElement
        const tweetUrl = tweetLink?.getAttribute('href') || ''
        const tweetLinkRef = tweetLink ? assignRef(tweetLink) : ''

        results.push({ handle, displayName, text: text.slice(0, 200), hasBlueVKeyword, replyCount, tweetUrl, tweetLinkRef })
      }

      return { success: true, data: results }
    }

    // 人类模式滚动一屏 (随机速度，非匀速)
    case 'FOLLOW_SCROLL_DOWN': {
      const scrollAmount = randomInt(500, 800)
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' })
      await sleep(randomInt(800, 1500))
      // 返回是否已到页面底部
      const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 200)
      return { success: true, data: { atBottom, scrollY: window.scrollY } }
    }

    // 点击进入推文详情页
    case 'FOLLOW_ENTER_DETAIL': {
      const { ref: detailRef } = message.payload || {}
      if (!detailRef) return { success: false, error: '缺少 ref' }
      const linkEl = refMap.get(detailRef) as HTMLElement
      if (!linkEl) return { success: false, error: `ref ${detailRef} not found` }
      linkEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await sleep(randomInt(300, 600))
      linkEl.click()
      // 等待页面切换
      await sleep(randomInt(1500, 2500))
      return { success: true, data: { url: location.href } }
    }

    // 详情页: 人类模式滚动到底部 (分段滚动，每段停顿)
    case 'FOLLOW_SCROLL_TO_BOTTOM': {
      let prevScrollY = -1
      let stuckCount = 0
      const maxScrolls = 50 // 安全上限
      for (let i = 0; i < maxScrolls; i++) {
        const scrollAmt = randomInt(400, 700)
        window.scrollBy({ top: scrollAmt, behavior: 'smooth' })
        await sleep(randomInt(600, 1200))

        // 偶尔停久一点 (20% 概率), 模拟阅读
        if (Math.random() < 0.2) {
          await sleep(randomInt(1000, 2500))
        }

        // 检测是否到底
        if (Math.abs(window.scrollY - prevScrollY) < 5) {
          stuckCount++
          if (stuckCount >= 3) break // 连续3次没动 = 到底了
        } else {
          stuckCount = 0
        }
        prevScrollY = window.scrollY
      }
      return { success: true, data: { scrollY: window.scrollY } }
    }

    // 详情页: 扫描回帖者 (从底部往上)
    case 'FOLLOW_SCAN_REPLIES': {
      const tweetArticles = document.querySelectorAll('[data-testid="tweet"]')
      // 第一个 article 是原帖，其余是回帖; 转为数组后反转 (底部优先)
      const replyArticles = Array.from(tweetArticles).slice(1).reverse()
      const replies: Array<{
        handle: string
        displayName: string
        articleRef: string
      }> = []
      const seenHandles = new Set<string>()

      for (const article of replyArticles) {
        const userNameEl = article.querySelector('[data-testid="User-Name"]')
        if (!userNameEl) continue
        const profileLink = userNameEl.querySelector('a[href^="/"]') as HTMLAnchorElement
        if (!profileLink || profileLink.href.includes('/status/')) continue
        const handle = (profileLink.getAttribute('href') || '').replace(/^\//, '').split('/')[0]
        if (!handle || seenHandles.has(handle)) continue
        seenHandles.add(handle)

        const nameSpan = userNameEl.querySelector('span') as HTMLElement
        const displayName = nameSpan?.textContent?.trim() || handle
        const articleRef = assignRef(article)

        replies.push({ handle, displayName, articleRef })
      }

      return { success: true, data: replies }
    }

    // 滚动到指定 article ref 位置 (让人能看到)
    case 'FOLLOW_SCROLL_TO': {
      const { ref: scrollRef } = message.payload || {}
      if (!scrollRef) return { success: false, error: '缺少 ref' }
      const el = refMap.get(scrollRef) as HTMLElement
      if (!el) return { success: false, error: `ref ${scrollRef} not found` }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await sleep(randomInt(400, 800))
      return { success: true }
    }

    // 返回首页 (点击 Home 链接)
    case 'FOLLOW_GO_HOME': {
      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement
      if (homeLink) {
        homeLink.click()
        await sleep(randomInt(1500, 2500))
        return { success: true }
      }
      // 备选: 直接导航
      window.location.href = 'https://x.com/home'
      await sleep(2000)
      return { success: true }
    }

    // ===== 方案B: 页面滚动取关 =====

    case 'UNFOLLOW_SCAN_PAGE': {
      const { taskId, xScreenName, token } = message.payload || {}
      if (unfollowScanRunning) return { success: false, error: '扫描已在运行' }
      // 异步执行，不阻塞消息回调
      scanFollowingPage(taskId, xScreenName, token)
      return { success: true, message: '扫描已启动' }
    }

    case 'UNFOLLOW_EXECUTE_PAGE': {
      const { taskId, config, startIndex, token } = message.payload || {}
      if (unfollowExecRunning) return { success: false, error: '取关已在运行' }
      executePageUnfollow(taskId, config, startIndex || 0, token)
      return { success: true, message: '取关已启动' }
    }

    case 'UNFOLLOW_PAUSE': {
      unfollowStopRequested = true
      return { success: true }
    }

    default:
      return { success: false, error: `Unknown: ${message.type}` }
  }
}

// ===== URL 变化监听 (Twitter SPA) =====

let currentUrl = location.href
const urlObserver = new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href
    resetRefs()
    chrome.runtime.sendMessage({ type: 'URL_CHANGED', payload: { url: location.href } }).catch(() => {})
  }
})
urlObserver.observe(document.body, { childList: true, subtree: true })

// ===== 推特资料 DOM 感知 (零 API 调用) =====
// 直接从页面 DOM 提取当前登录用户信息，推特自己渲染的数据
// 定期扫描，发现变化时通知 service worker

let lastProfileHash = ''

function extractProfileFromDOM(): Record<string, unknown> | null {
  try {
    const profile: Record<string, unknown> = {}

    // 侧边栏用户按钮 [data-testid="SideNav_AccountSwitcher_Button"]
    const accountBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
    if (accountBtn) {
      // 头像: 按钮内的 img
      const avatar = accountBtn.querySelector('img[src*="profile_images"]') as HTMLImageElement
      if (avatar?.src) profile.profileImageUrl = avatar.src.replace(/_normal\./, '_200x200.')

      // @handle 和显示名: 按钮内的文本节点
      const spans = accountBtn.querySelectorAll('span')
      for (const span of spans) {
        const text = span.textContent?.trim() || ''
        if (text.startsWith('@')) profile.xScreenName = text.slice(1)
        else if (text.length > 0 && !text.startsWith('@') && !profile.xDisplayName) {
          // 排除数字和空白，取第一个非 @handle 的文本作为显示名
          if (!/^\d+$/.test(text) && text !== '···') profile.xDisplayName = text
        }
      }
    }

    // 蓝V 标识: 侧边栏或 header 中的验证图标
    const verifiedBadge = accountBtn?.querySelector('svg[data-testid="icon-verified"]')
    if (verifiedBadge) profile.isVerified = true

    // 如果在个人主页 (/username)，可以提取更多数据
    const pathname = location.pathname
    const screenName = profile.xScreenName as string | undefined
    if (screenName && pathname === `/${screenName}`) {
      // 粉丝/关注数: [href="/username/followers"] 和 [href="/username/following"]
      const followersLink = document.querySelector(`a[href="/${screenName}/verified_followers"], a[href="/${screenName}/followers"]`)
      const followingLink = document.querySelector(`a[href="/${screenName}/following"]`)

      if (followersLink) {
        const countSpan = followersLink.querySelector('span span')
        if (countSpan?.textContent) profile.followersCount = parseCountText(countSpan.textContent)
      }
      if (followingLink) {
        const countSpan = followingLink.querySelector('span span')
        if (countSpan?.textContent) profile.followingCount = parseCountText(countSpan.textContent)
      }

      // Bio: [data-testid="UserDescription"]
      const bioEl = document.querySelector('[data-testid="UserDescription"]')
      if (bioEl?.textContent) profile.bio = bioEl.textContent.trim()

      // 位置: [data-testid="UserProfileHeader_Items"] 内的 location
      const headerItems = document.querySelector('[data-testid="UserProfileHeader_Items"]')
      if (headerItems) {
        const locationSpan = headerItems.querySelector('span[data-testid="UserLocation"]')
        if (locationSpan?.textContent) profile.location = locationSpan.textContent.trim()
      }

      // 背景图
      const banner = document.querySelector('a[href$="/header_photo"] img') as HTMLImageElement
      if (banner?.src) profile.profileBannerUrl = banner.src
    }

    // 至少需要 screenName 才有意义
    if (!profile.xScreenName) return null
    return profile
  } catch {
    return null
  }
}

function parseCountText(text: string): number {
  // Twitter 显示格式: "1,234" / "12.3K" / "1.2M" / "12万"
  const cleaned = text.replace(/,/g, '').trim()
  if (/[\d.]+K$/i.test(cleaned)) return Math.round(parseFloat(cleaned) * 1000)
  if (/[\d.]+M$/i.test(cleaned)) return Math.round(parseFloat(cleaned) * 1_000_000)
  if (/[\d.]+万$/.test(cleaned)) return Math.round(parseFloat(cleaned) * 10_000)
  if (/[\d.]+亿$/.test(cleaned)) return Math.round(parseFloat(cleaned) * 100_000_000)
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? 0 : n
}

function profileToHash(p: Record<string, unknown>): string {
  // 只用关键字段生成 hash，避免无意义的微小变化触发上报
  return JSON.stringify([
    p.xScreenName, p.xDisplayName, p.profileImageUrl,
    p.isVerified, p.followersCount, p.followingCount, p.bio,
  ])
}

// 每 30 秒扫描一次 DOM，检测资料变化
setInterval(() => {
  const profile = extractProfileFromDOM()
  if (!profile) return

  const hash = profileToHash(profile)
  if (hash === lastProfileHash) return // 没变化

  lastProfileHash = hash
  chrome.runtime.sendMessage({
    type: 'PROFILE_CHANGED',
    payload: profile,
  }).catch(() => {})
}, 30_000)

// 首次扫描 (页面加载 5 秒后，等 DOM 渲染完)
setTimeout(() => {
  const profile = extractProfileFromDOM()
  if (profile) {
    lastProfileHash = profileToHash(profile)
    chrome.runtime.sendMessage({
      type: 'PROFILE_CHANGED',
      payload: profile,
    }).catch(() => {})
  }
}, 5_000)

// ===== 初始化 =====
logger.info(`[Content] v4.2 Agent 已注入: ${location.hostname}${location.pathname}`)
