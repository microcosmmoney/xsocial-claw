import { logger } from '@utils/logger'

/**
 * Content Script — v4.2 Browser Agent perception+execution layer
 *
 * Injected into x.com / twitter.com pages (ISOLATED world)
 *
 * Core capabilities:
 *   1. snapshot() — DOM traversal targeting Twitter data-testid structures
 *   2. executeAction() — click/type/press atomic operations (isTrusted:true)
 *   3. Message handling — receives commands from background service-worker
 *
 * Design principles:
 *   - No CDP (avoids yellow debugger bar)
 *   - Optimized for Twitter's actual DOM structure (data-testid)
 *   - Scroll using keyboard j/k (Twitter native shortcuts)
 */

// ===== Ref Management =====

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

// ===== Snapshot — Twitter-specific DOM extraction =====

function getSnapshot(): { snapshot: string; elementCount: number } {
  resetRefs()
  const lines: string[] = []

  // 1. Navigation bar (simplified)
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

  // 2. Compose box
  const composeBox = document.querySelector('[data-testid="tweetTextarea_0"]')
  if (composeBox) {
    const ref = assignRef(composeBox)
    lines.push(`textbox "Compose" [ref=${ref}]`)
  }

  // 3. Tab switching (For You / Following)
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

  // 3.5 Profile page — follow/unfollow button
  const followBtn = document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]') as HTMLElement
  if (followBtn) {
    const ref = assignRef(followBtn)
    const isFollowing = followBtn.getAttribute('data-testid')?.includes('unfollow')
    const label = isFollowing ? 'Following' : 'Follow'
    lines.push(`button "${label}" [ref=${ref}]`)
  }

  // 4. Tweet list — core content
  const tweets = document.querySelectorAll('[data-testid="tweet"]')
  for (const tweet of tweets) {
    const tweetRef = assignRef(tweet)
    const tweetLines: string[] = []

    // Username + handle + time + clickable profile link
    const userNameEl = tweet.querySelector('[data-testid="User-Name"]')
    if (userNameEl) {
      const userName = (userNameEl as HTMLElement).innerText?.replace(/\n/g, ' ').trim()
      // Detect blue verification badge
      const isVerified = !!(userNameEl.querySelector('[data-testid="icon-verified"]') ||
                           userNameEl.querySelector('svg[aria-label*="Verified"]') ||
                           userNameEl.querySelector('svg[aria-label*="Verified"]') ||
                           userNameEl.querySelector('svg[aria-label*="verified"]'))
      const badge = isVerified ? ' [verified]' : ''
      if (userName) tweetLines.push(`  user "${userName}"${badge}`)
      // Extract user profile link
      const profileLink = userNameEl.querySelector('a[href]') as HTMLAnchorElement
      if (profileLink && !profileLink.href.includes('/status/')) {
        const profileRef = assignRef(profileLink)
        const handle = profileLink.getAttribute('href')?.replace('/', '@') || ''
        tweetLines.push(`  link "Profile ${handle}" [ref=${profileRef}]`)
      }
    }

    // Tweet body
    const tweetText = tweet.querySelector('[data-testid="tweetText"]')
    if (tweetText) {
      const text = (tweetText as HTMLElement).innerText?.trim()
      if (text) {
        const textRef = assignRef(tweetText)
        tweetLines.push(`  text "${text.slice(0, 280)}" [ref=${textRef}]`)
      }
    }

    // Images
    const images = tweet.querySelectorAll('[data-testid="tweetPhoto"] img')
    for (const img of images) {
      const alt = img.getAttribute('alt') || 'Image'
      tweetLines.push(`  img "${alt.slice(0, 100)}"`)
    }

    // Interaction buttons
    const replyBtn = tweet.querySelector('[data-testid="reply"]')
    if (replyBtn) {
      const replyRef = assignRef(replyBtn)
      const count = replyBtn.getAttribute('aria-label') || ''
      tweetLines.push(`  button "Reply ${count}" [ref=${replyRef}]`)
    }

    const retweetBtn = tweet.querySelector('[data-testid="retweet"]')
    if (retweetBtn) {
      const rtRef = assignRef(retweetBtn)
      const count = retweetBtn.getAttribute('aria-label') || ''
      tweetLines.push(`  button "Retweet ${count}" [ref=${rtRef}]`)
    }

    const likeBtn = tweet.querySelector('[data-testid="like"]') || tweet.querySelector('[data-testid="unlike"]')
    if (likeBtn) {
      const likeRef = assignRef(likeBtn)
      const count = likeBtn.getAttribute('aria-label') || ''
      const liked = likeBtn.getAttribute('data-testid') === 'unlike' ? ' [liked]' : ''
      tweetLines.push(`  button "Like ${count}${liked}" [ref=${likeRef}]`)
    }

    const bookmarkBtn = tweet.querySelector('[data-testid="bookmark"]')
    if (bookmarkBtn) {
      const bmRef = assignRef(bookmarkBtn)
      tweetLines.push(`  button "Bookmark" [ref=${bmRef}]`)
    }

    // Tweet link (for navigating to detail view)
    const tweetLink = tweet.querySelector('a[href*="/status/"]')
    if (tweetLink) {
      const linkRef = assignRef(tweetLink)
      const href = tweetLink.getAttribute('href') || ''
      tweetLines.push(`  link "${href}" [ref=${linkRef}]`)
    }

    if (tweetLines.length > 0) {
      lines.push(`article "Tweet" [ref=${tweetRef}]`)
      lines.push(...tweetLines)
    }
  }

  // 4.5 Hover Card popup — user card in #layers
  const layersEl = document.getElementById('layers')
  if (layersEl) {
    const followBtnInLayers = layersEl.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]') as HTMLElement
    if (followBtnInLayers) {
      const ref = assignRef(followBtnInLayers)
      const isFollowing = followBtnInLayers.getAttribute('data-testid')?.includes('unfollow')
      // Try to get username
      const nameEl = layersEl.querySelector('a[role="link"] span') || layersEl.querySelector('[dir="ltr"] span')
      const name = (nameEl as HTMLElement)?.textContent?.trim() || ''
      lines.push(`hovercard "${name}"`)
      lines.push(`  button "${isFollowing ? 'Following' : 'Follow'}" [ref=${ref}]`)
    }
  }

  // 5. Sidebar — Trends
  const trending = document.querySelector('[aria-label="Timeline: Trending"]') ||
                   document.querySelector('[data-testid="trend"]')?.closest('section')
  if (trending) {
    const trends = trending.querySelectorAll('[data-testid="trend"]')
    if (trends.length > 0) {
      lines.push(`region "Trending"`)
      for (const trend of Array.from(trends).slice(0, 5)) {
        const text = (trend as HTMLElement).innerText?.replace(/\n/g, ' ').trim().slice(0, 80)
        if (text) {
          const ref = assignRef(trend)
          lines.push(`  link "${text}" [ref=${ref}]`)
        }
      }
    }
  }

  // 6. Sidebar — Suggested follows
  const whoToFollow = document.querySelector('[data-testid="UserCell"]')?.closest('aside')
  if (whoToFollow) {
    const users = whoToFollow.querySelectorAll('[data-testid="UserCell"]')
    if (users.length > 0) {
      lines.push(`region "Who to follow"`)
      for (const user of Array.from(users).slice(0, 3)) {
        const text = (user as HTMLElement).innerText?.replace(/\n/g, ' ').trim().slice(0, 60)
        if (text) {
          const ref = assignRef(user)
          lines.push(`  generic "${text}" [ref=${ref}]`)
        }
      }
    }
  }

  // 7. Dialogs/popups (reply box, etc.)
  const dialogs = document.querySelectorAll('[role="dialog"]')
  for (const dialog of dialogs) {
    const dialogRef = assignRef(dialog)
    lines.push(`dialog [ref=${dialogRef}]`)
    // Input fields in dialog
    const inputs = dialog.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"]')
    for (const input of inputs) {
      const ref = assignRef(input)
      const placeholder = input.getAttribute('aria-label') || input.getAttribute('placeholder') || 'Text input'
      lines.push(`  textbox "${placeholder}" [ref=${ref}]`)
    }
    // Buttons in dialog
    const buttons = dialog.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
    for (const btn of buttons) {
      const ref = assignRef(btn)
      lines.push(`  button "Send" [ref=${ref}]`)
    }
  }

  // 8. Page info
  const pageInfo = `[page] url=${location.href} title=${document.title}`
  lines.push(pageInfo)

  return { snapshot: lines.join('\n'), elementCount: refCounter }
}

// ===== Action Execution — Atomic Operations =====

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

  // scroll — simplest direct scrolling
  if (type === 'scroll') {
    const amount = pixels || 600
    console.log(`[xSocial] scroll executing: ${amount}px`)
    // Method 1: scrollingElement (most universal)
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop += amount
      console.log(`[xSocial] scrollingElement.scrollTop = ${document.scrollingElement.scrollTop}`)
    }
    // Method 2: documentElement
    document.documentElement.scrollTop += amount
    // Method 3: body
    document.body.scrollTop += amount
    // Method 4: window
    window.scrollBy(0, amount)
    await sleep(500)
    return { success: true }
  }

  // press — generic keyboard keys
  if (type === 'press') {
    const keyStr = key || 'Enter'

    // PageDown/PageUp/ArrowDown — use real scrolling instead (dispatchEvent is isTrusted:false)
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

    // Dispatch other keys normally
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

  // Special ref: __tweetButton__ — auto-find send button
  if (ref === '__tweetButton__' && type === 'click') {
    const sendBtn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') as HTMLElement
    if (!sendBtn) return { success: false, error: 'Send button not found' }
    logger.info(`[Content] Auto-clicked send button: ${sendBtn.textContent?.trim()}`)
    sendBtn.click()
    await sleep(500)
    return { success: true }
  }

  // click / type — requires ref
  if (!ref) return { success: false, error: 'ref is required' }
  const el = refMap.get(ref)
  if (!el) return { success: false, error: `ref ${ref} not found` }

  if (type === 'hover') {
    const htmlEl = el as HTMLElement
    // Simulate mouse hover — trigger Twitter hover card
    const rect = htmlEl.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }
    htmlEl.dispatchEvent(new MouseEvent('mouseover', opts))
    htmlEl.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }))
    // Also dispatch pointerenter (React 17+ may listen to pointer events)
    htmlEl.dispatchEvent(new PointerEvent('pointerover', { ...opts, bubbles: true }))
    htmlEl.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }))
    logger.info(`[Content] hover done: ${htmlEl.tagName} at (${Math.round(cx)}, ${Math.round(cy)})`)
    // Wait for popup to render (Twitter hover card has delay)
    await sleep(1500)
    // Check if follow button appeared in #layers
    const layersCheck = document.getElementById('layers')
    const hcBtn = layersCheck?.querySelector('[data-testid$="-follow"]') as HTMLElement
    const hcUnfollow = layersCheck?.querySelector('[data-testid$="-unfollow"]')
    logger.info(`[Content] hover card detection: layers=${!!layersCheck}, followBtn=${!!hcBtn}, unfollowBtn=${!!hcUnfollow}`)
    if (hcBtn && !hcUnfollow) {
      // Follow button present and not following -> click follow
      hcBtn.click()
      logger.info(`[Content] hover card auto-clicked follow!`)
      await sleep(800)
      // Click blank area to dismiss popup
      document.body.click()
      await sleep(300)
      return { success: true, hoverCardFound: true, autoFollowed: true }
    }
    return { success: true, hoverCardFound: !!hcBtn || !!hcUnfollow, alreadyFollowing: !!hcUnfollow }
  }

  if (type === 'click') {
    const htmlEl = el as HTMLElement

    // ---- Safety check: prevent clicking reply/retweet when dialog is open ----
    const isReplyBtn = htmlEl.closest('[data-testid="reply"]') ||
                       htmlEl.textContent?.includes('Reply') ||
                       htmlEl.getAttribute('aria-label')?.includes('Reply') ||
                       htmlEl.getAttribute('aria-label')?.includes('Reply')
    if (isReplyBtn) {
      const dialogOpen = document.querySelector('[role="dialog"]') ||
                         window.location.pathname.includes('/compose/')
      if (dialogOpen) {
        logger.warn('[Content] Reply dialog already open, blocking duplicate click')
        return { success: false, error: 'Reply dialog already open, duplicate click blocked' }
      }
    }

    htmlEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(humanDelay ? randomInt(300, 600) : 100)
    htmlEl.click()

    // ---- Post-click verification ----
    await sleep(300)
    logger.info('[Content] click done:', htmlEl.tagName, htmlEl.textContent?.slice(0, 30))
    return { success: true }
  }

  if (type === 'type') {
    logger.info('[Content] type: requesting service-worker to execute paste in MAIN world')
    // content-script (isolated world) cannot make Draft.js recognize input
    // Must execute in MAIN world via service-worker's chrome.scripting.executeScript
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'EXECUTE_IN_MAIN_WORLD',
        payload: { text }
      }, (response) => {
        logger.info('[Content] MAIN world execution result:', response)
        resolve(response || { success: true })
      })
    })
  }

  return { success: false, error: `Unknown action: ${type}` }
}

// ===== Utilities =====

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ===== Mode B: Page Scroll Unfollow Engine =====

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
 * Mode B scan: auto-scroll the "Following" page, find users without "Follows you" label
 */
async function scanFollowingPage(taskId: string, xScreenName: string, token: string): Promise<void> {
  unfollowScanRunning = true
  unfollowStopRequested = false

  const nonFollowers: Array<{ screenName: string; displayName: string }> = []
  const seenHandles = new Set<string>()
  let noNewCount = 0

  logger.info('[Unfollow-Page] Starting page scroll scan...')

  while (!unfollowStopRequested) {
    // Scan currently visible user cards
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

      // Check for "Follows you" label
      const cellText = (cell as HTMLElement).innerText || ''
      const followsYou = cellText.includes('Follows you') || cellText.includes('Follows you')

      if (!followsYou) {
        nonFollowers.push({ screenName: handle, displayName })
        logger.info(`[Unfollow-Page] Found non-follower: @${handle}`)
      }
    }

    if (!foundNew) {
      noNewCount++
      if (noNewCount > 5) {
        logger.info('[Unfollow-Page] 5 consecutive scrolls with no new users, scan complete')
        break
      }
    } else {
      noNewCount = 0
    }

    // Scroll to load more
    window.scrollBy(0, 800)
    await sleep(randomInt(1000, 3000))
  }

  logger.info(`[Unfollow-Page] Scan complete: checked ${seenHandles.size}  users, found  ${nonFollowers.length}  non-followers`)

  // Report results to server
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
    logger.warn('[Unfollow-Page] Failed to report scan results:', err)
  }

  // Notify service-worker
  chrome.runtime.sendMessage({
    type: 'UNFOLLOW_SCAN_DONE',
    payload: { taskId, nonFollowerCount: nonFollowers.length, totalScanned: seenHandles.size },
  }).catch(() => {})

  unfollowScanRunning = false
}

/**
 * Mode B execution: scroll "Following" page and unfollow users without "Follows you"
 * Human mode: scroll -> detect -> click Following button -> confirm unfollow -> wait -> continue
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

  // Scroll to previously processed position (rough skip)
  if (startIndex > 0) {
    logger.info(`[Unfollow-Page] Skipping first ${startIndex}  already processed users...`)
    for (let skip = 0; skip < startIndex; skip++) {
      window.scrollBy(0, 100)
      if (skip % 20 === 0) await sleep(500)
    }
    await sleep(1000)
  }

  logger.info(`[Unfollow-Page] Starting page unfollow, from index ${startIndex} `)

  while (!unfollowStopRequested) {
    // Check rate limits
    if (hourlyCount >= config.hourlyLimit) {
      logger.info(`[Unfollow-Page] Reached hourly limit ${config.hourlyLimit}, , pausing`)
      break
    }
    if (dailyCount >= config.dailyLimit) {
      logger.info(`[Unfollow-Page] Reached daily limit ${config.dailyLimit}, , pausing`)
      break
    }

    // Scan currently visible user cards
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
      const followsYou = cellText.includes('Follows you') || cellText.includes('Follows you')

      if (followsYou) continue // Mutual follow, skip

      // Found non-follower -> unfollow
      foundAction = true

      // Find "Following" button
      const followingBtn = cell.querySelector('[data-testid$="-unfollow"]') as HTMLElement
      if (!followingBtn) {
        logger.warn(`[Unfollow-Page] @${handle} Unfollow button not found, skipping`)
        failedCount++
        continue
      }

      // Scroll into view
      cell.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await sleep(randomInt(500, 1000))

      // Click "Following" button
      followingBtn.click()
      logger.info(`[Unfollow-Page] Clicked unfollow button: @${handle}`)
      await sleep(randomInt(500, 1000))

      // Wait for confirmation dialog and click confirm
      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement
      if (confirmBtn) {
        confirmBtn.click()
        logger.info(`[Unfollow-Page] ✓ Confirmed unfollow @${handle}`)
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
        logger.warn(`[Unfollow-Page] No confirmation dialog appeared, may have auto-unfollowed or failed`)
        // In some cases clicking the button directly unfollows without confirmation
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

      // Periodic progress report
      if (actions.length >= 5) {
        reportPageProgress(token, taskId, unfollowedCount, failedCount, processedIndex, actions.splice(0))
      }

      // Human delay
      const delay = gaussianDelay(config.delayMin, config.delayMax)
      logger.info(`[Unfollow-Page] Waiting ${(delay / 1000).toFixed(1)}s...`)
      await sleep(delay)
    }

    if (!foundAction) {
      noNewCount++
      if (noNewCount > 8) {
        logger.info('[Unfollow-Page] 8 consecutive scrolls with no new targets, task complete')
        break
      }
    } else {
      noNewCount = 0
    }

    // Scroll to load more
    window.scrollBy(0, 600)
    await sleep(randomInt(1000, 2000))
  }

  // Report remaining progress
  if (actions.length > 0) {
    reportPageProgress(token, taskId, unfollowedCount, failedCount, processedIndex, actions.splice(0))
  }

  // Report completion
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

  logger.info(`[Unfollow-Page] Round complete: unfollowed ${unfollowedCount}, failed ${failedCount}`)
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

// ===== Message Handling =====

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

    // ===== Mode B: Page scroll unfollow =====

    case 'UNFOLLOW_SCAN_PAGE': {
      const { taskId, xScreenName, token } = message.payload || {}
      if (unfollowScanRunning) return { success: false, error: 'Scan is already running' }
      // Async execution, don't block message callback
      scanFollowingPage(taskId, xScreenName, token)
      return { success: true, message: 'Scan started' }
    }

    case 'UNFOLLOW_EXECUTE_PAGE': {
      const { taskId, config, startIndex, token } = message.payload || {}
      if (unfollowExecRunning) return { success: false, error: 'Unfollow is already running' }
      executePageUnfollow(taskId, config, startIndex || 0, token)
      return { success: true, message: 'Unfollow started' }
    }

    case 'UNFOLLOW_PAUSE': {
      unfollowStopRequested = true
      return { success: true }
    }

    default:
      return { success: false, error: `Unknown: ${message.type}` }
  }
}

// ===== URL Change Listener (Twitter SPA) =====

let currentUrl = location.href
const urlObserver = new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href
    resetRefs()
    chrome.runtime.sendMessage({ type: 'URL_CHANGED', payload: { url: location.href } }).catch(() => {})
  }
})
urlObserver.observe(document.body, { childList: true, subtree: true })

// ===== Initialization =====
logger.info(`[Content] v4.2 Agent injected: ${location.hostname}${location.pathname}`)
