/**
 * Twitter 内部 API 封装
 *
 * 通过 chrome.cookies 获取认证信息，调用 Twitter REST/GraphQL API。
 * 请求从扩展 Service Worker 发出，使用浏览器自身的 Cookie/TLS。
 */

import { BEARER_TOKEN, GQL, GQL_FEATURES } from '@shared/constants'
import type { XCookies, XUserBasic, XFriendshipStatus } from '@shared/types'
import { readDelay } from '@utils/delay'
import { logger } from '@utils/logger'

// ===== Cookie 管理 =====

/** 获取当前 X 登录 Cookie */
export async function getXCookies(): Promise<XCookies | null> {
  try {
    const [ct0, authToken] = await Promise.all([
      chrome.cookies.get({ url: 'https://x.com', name: 'ct0' }),
      chrome.cookies.get({ url: 'https://x.com', name: 'auth_token' }),
    ])

    if (!ct0?.value || !authToken?.value) return null

    return { ct0: ct0.value, authToken: authToken.value }
  } catch {
    return null
  }
}

/** 构建请求头 */
function buildHeaders(cookies: XCookies): Record<string, string> {
  return {
    authorization: `Bearer ${BEARER_TOKEN}`,
    'x-csrf-token': cookies.ct0,
    cookie: `ct0=${cookies.ct0}; auth_token=${cookies.authToken}`,
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
  }
}

/** 带重试和延迟的 fetch 封装 */
async function xFetch(
  url: string,
  options: RequestInit,
  cookies: XCookies,
  retries = 1
): Promise<Response> {
  const headers = { ...buildHeaders(cookies), ...((options.headers as Record<string, string>) || {}) }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { ...options, headers })

      if (resp.status === 429) {
        // Rate limit — 等待后重试
        const resetTime = resp.headers.get('x-rate-limit-reset')
        const waitMs = resetTime ? (Number(resetTime) * 1000 - Date.now() + 1000) : 60_000
        logger.warn(`Rate limited, 等待 ${Math.ceil(waitMs / 1000)}s`)
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 120_000)))
        continue
      }

      if (resp.status === 403) {
        logger.error('403 Forbidden — 可能是 Cookie 过期或账号受限')
        throw new XApiError(403, '操作被禁止，请检查 X 登录状态')
      }

      if (!resp.ok && attempt < retries) {
        logger.warn(`请求失败 ${resp.status}, 重试 ${attempt + 1}/${retries}`)
        await readDelay()
        continue
      }

      return resp
    } catch (err) {
      if (err instanceof XApiError) throw err
      if (attempt < retries) {
        logger.warn('网络错误, 重试中...', err)
        await readDelay()
        continue
      }
      throw err
    }
  }

  throw new XApiError(0, '请求失败，已用完重试次数')
}

export class XApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'XApiError'
  }
}

// ===== 当前用户 =====

/** 获取当前登录的 X 用户信息 (通过 Cookie 认证) */
export async function getAuthenticatedUser(
  cookies: XCookies
): Promise<XUserBasic | null> {
  // 方法 1: verify_credentials (REST v1.1)
  try {
    const params = new URLSearchParams({
      include_email: 'false',
      skip_status: 'true',
      include_entities: 'false',
    })
    const resp = await fetch(
      `https://x.com/i/api/1.1/account/verify_credentials.json?${params}`,
      {
        method: 'GET',
        headers: buildHeaders(cookies),
      }
    )

    if (resp.ok) {
      const data = (await resp.json()) as any
      if (data.id_str && data.screen_name) {
        logger.info(`识别到 X 用户: @${data.screen_name}`)
        return {
          id: data.id_str,
          screenName: data.screen_name,
          displayName: data.name,
          profileImageUrl: data.profile_image_url_https?.replace('_normal', '_200x200'),
          profileBannerUrl: data.profile_banner_url || undefined,
          isVerified: data.ext_is_blue_verified || data.verified || false,
          followersCount: data.followers_count || 0,
          followingCount: data.friends_count || 0,
          statusesCount: data.statuses_count || 0,
          favouritesCount: data.favourites_count || 0,
          listedCount: data.listed_count || 0,
          bio: data.description || undefined,
          location: data.location || undefined,
          createdAt: data.created_at || undefined,
        }
      }
    }
    logger.warn('verify_credentials 失败:', resp.status)
  } catch (err) {
    logger.warn('verify_credentials 异常:', err)
  }

  // 方法 2: account/settings (备选)
  try {
    const resp = await fetch(
      'https://x.com/i/api/1.1/account/settings.json',
      { method: 'GET', headers: buildHeaders(cookies) }
    )
    if (resp.ok) {
      const data = (await resp.json()) as any
      if (data.screen_name) {
        logger.info(`通过 settings 识别到 X 用户: @${data.screen_name}`)
        return {
          id: '',
          screenName: data.screen_name,
          displayName: data.screen_name,
          isVerified: false,
          followersCount: 0,
          followingCount: 0,
          statusesCount: 0,
          favouritesCount: 0,
          listedCount: 0,
        }
      }
    }
    logger.warn('account/settings 失败:', resp.status)
  } catch (err) {
    logger.warn('account/settings 异常:', err)
  }

  // 方法 3: GraphQL Viewer 查询 (2026-03 新端点)
  try {
    const variables = JSON.stringify({
      withCommunitiesMemberships: false,
      withSubscriptionProductDetails: false,
      withCommunitiesCreation: false,
    })
    const features = JSON.stringify({
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    })
    const params = new URLSearchParams({ variables, features })
    const resp = await fetch(
      `https://x.com/i/api/graphql/LimHK1E6MQsP6JBMnHEBXg/Viewer?${params}`,
      { method: 'GET', headers: buildHeaders(cookies) }
    )
    if (resp.ok) {
      const json = (await resp.json()) as any
      const viewer = json?.data?.viewer?.user_results?.result
      if (viewer?.legacy?.screen_name) {
        const u = viewer.legacy
        logger.info(`通过 GraphQL Viewer 识别到 X 用户: @${u.screen_name}`)
        return {
          id: viewer.rest_id || '',
          screenName: u.screen_name,
          displayName: u.name || u.screen_name,
          profileImageUrl: u.profile_image_url_https?.replace('_normal', '_200x200'),
          profileBannerUrl: u.profile_banner_url || undefined,
          isVerified: viewer.is_blue_verified || u.verified || false,
          followersCount: u.followers_count || 0,
          followingCount: u.friends_count || 0,
          statusesCount: u.statuses_count || 0,
          favouritesCount: u.favourites_count || 0,
          listedCount: u.listed_count || 0,
          bio: u.description || undefined,
          location: u.location || undefined,
          createdAt: u.created_at || undefined,
        }
      }
    }
    logger.warn('GraphQL Viewer 失败:', resp.status)
  } catch (err) {
    logger.warn('GraphQL Viewer 异常:', err)
  }

  // 方法 4: twid cookie + GraphQL UserByRestId (最可靠的后备方案)
  try {
    const tweeidCookie = await chrome.cookies.get({ url: 'https://x.com', name: 'twid' })
    if (tweeidCookie?.value) {
      const match = decodeURIComponent(tweeidCookie.value).match(/u=(\d+)/)
      if (match?.[1]) {
        const userId = match[1]
        logger.info(`通过 twid cookie 获取到用户 ID: ${userId}`)

        // 优先用 GraphQL UserByRestId 查询完整信息
        const variables = JSON.stringify({ userId, withSafetyModeUserFields: true })
        const features = JSON.stringify(GQL_FEATURES)
        const gqlParams = new URLSearchParams({ variables, features })
        const gqlResp = await fetch(
          `https://x.com/i/api/graphql/xf3jd90KKBCUxdlI_tNHZw/UserByRestId?${gqlParams}`,
          { method: 'GET', headers: buildHeaders(cookies) }
        )
        if (gqlResp.ok) {
          const json = (await gqlResp.json()) as any
          const user = json?.data?.user?.result?.legacy
          const core = json?.data?.user?.result
          if (user?.screen_name) {
            logger.info(`通过 GraphQL UserByRestId 识别到 X 用户: @${user.screen_name}`)
            return {
              id: core?.rest_id || userId,
              screenName: user.screen_name,
              displayName: user.name || user.screen_name,
              profileImageUrl: user.profile_image_url_https?.replace('_normal', '_200x200'),
              profileBannerUrl: user.profile_banner_url || undefined,
              isVerified: core?.is_blue_verified || user.verified || false,
              followersCount: user.followers_count || 0,
              followingCount: user.friends_count || 0,
              statusesCount: user.statuses_count || 0,
              favouritesCount: user.favourites_count || 0,
              listedCount: user.listed_count || 0,
              bio: user.description || undefined,
              location: user.location || undefined,
              createdAt: user.created_at || undefined,
            }
          }
        }
        logger.warn('GraphQL UserByRestId 失败:', gqlResp.status)

        // 回退: REST users/show
        const resp = await fetch(
          `https://x.com/i/api/1.1/users/show.json?user_id=${userId}`,
          { method: 'GET', headers: buildHeaders(cookies) }
        )
        if (resp.ok) {
          const data = (await resp.json()) as any
          if (data.screen_name) {
            logger.info(`通过 users/show 识别到 X 用户: @${data.screen_name}`)
            return {
              id: data.id_str || match[1],
              screenName: data.screen_name,
              displayName: data.name || data.screen_name,
              profileImageUrl: data.profile_image_url_https?.replace('_normal', '_200x200'),
              profileBannerUrl: data.profile_banner_url || undefined,
              isVerified: data.ext_is_blue_verified || data.verified || false,
              followersCount: data.followers_count || 0,
              followingCount: data.friends_count || 0,
              statusesCount: data.statuses_count || 0,
              favouritesCount: data.favourites_count || 0,
              listedCount: data.listed_count || 0,
              bio: data.description || undefined,
              location: data.location || undefined,
              createdAt: data.created_at || undefined,
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn('twid cookie 方法异常:', err)
  }

  logger.error('所有方法均无法识别 X 用户')
  return null
}

// ===== 用户查询 =====

/** 通过 screen_name 查询用户信息 */
export async function getUserByScreenName(
  cookies: XCookies,
  screenName: string
): Promise<XUserBasic | null> {
  try {
    const resp = await xFetch(
      `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(screenName)}`,
      { method: 'GET' },
      cookies
    )
    if (!resp.ok) return null
    const data = await resp.json() as any
    if (!data.screen_name) return null
    return {
      id: data.id_str,
      screenName: data.screen_name,
      displayName: data.name || data.screen_name,
      profileImageUrl: data.profile_image_url_https?.replace('_normal', '_200x200'),
      profileBannerUrl: data.profile_banner_url || undefined,
      isVerified: data.ext_is_blue_verified || data.verified || false,
      followersCount: data.followers_count || 0,
      followingCount: data.friends_count || 0,
      statusesCount: data.statuses_count || 0,
      favouritesCount: data.favourites_count || 0,
      listedCount: data.listed_count || 0,
      bio: data.description || undefined,
      location: data.location || undefined,
      createdAt: data.created_at || undefined,
    }
  } catch {
    return null
  }
}

// ===== REST API v1.1 =====

/** 通过 screen_name 关注用户 (无需提前查 userId) */
export async function followByScreenName(
  cookies: XCookies,
  screenName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await xFetch(
      'https://x.com/i/api/1.1/friendships/create.json',
      {
        method: 'POST',
        body: new URLSearchParams({ screen_name: screenName }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
      cookies
    )

    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `Follow @${screenName} failed: ${resp.status} ${text}` }
    }

    logger.info(`已关注 @${screenName}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/** 关注用户 */
export async function followUser(
  cookies: XCookies,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await xFetch(
      'https://x.com/i/api/1.1/friendships/create.json',
      {
        method: 'POST',
        body: new URLSearchParams({ user_id: userId }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
      cookies
    )

    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, error: `Follow failed: ${resp.status} ${text}` }
    }

    logger.info(`已关注用户 ${userId}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/** 取消关注用户 */
export async function unfollowUser(
  cookies: XCookies,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await xFetch(
      'https://x.com/i/api/1.1/friendships/destroy.json',
      {
        method: 'POST',
        body: new URLSearchParams({ user_id: userId }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
      cookies
    )

    if (!resp.ok) {
      return { success: false, error: `Unfollow failed: ${resp.status}` }
    }

    logger.info(`已取消关注用户 ${userId}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/** 批量检查关注关系 (最多 100 人/次) */
export async function lookupFriendships(
  cookies: XCookies,
  userIds: string[]
): Promise<XFriendshipStatus[]> {
  const results: XFriendshipStatus[] = []

  // 每次最多 100 个 ID
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100)
    const params = new URLSearchParams({ user_id: batch.join(',') })

    const resp = await xFetch(
      `https://x.com/i/api/1.1/friendships/lookup.json?${params}`,
      { method: 'GET' },
      cookies
    )

    if (!resp.ok) {
      logger.error(`Friendship lookup failed: ${resp.status}`)
      continue
    }

    const data = await resp.json()
    for (const item of data) {
      results.push({
        id: item.id_str,
        screenName: item.screen_name,
        connections: item.connections,
      })
    }

    if (i + 100 < userIds.length) {
      await readDelay()
    }
  }

  return results
}

/** 获取我的关注 ID 列表 (5000 ID/页, 免费!) */
export async function getFollowingIds(
  cookies: XCookies,
  onProgress?: (count: number) => void
): Promise<string[]> {
  const allIds: string[] = []
  let cursor = '-1'

  while (cursor !== '0') {
    const params = new URLSearchParams({
      cursor,
      stringify_ids: 'true',
      count: '5000',
    })

    const resp = await xFetch(
      `https://x.com/i/api/1.1/friends/ids.json?${params}`,
      { method: 'GET' },
      cookies
    )

    if (!resp.ok) {
      logger.error(`获取关注 ID 失败: ${resp.status}`)
      break
    }

    const data = await resp.json()
    const ids: string[] = data.ids || []
    allIds.push(...ids)

    onProgress?.(allIds.length)
    logger.info(`已获取 ${allIds.length} 个关注 ID`)

    cursor = data.next_cursor_str || '0'

    if (cursor !== '0') {
      await readDelay()
    }
  }

  return allIds
}

/** 获取我的粉丝 ID 列表 (5000 ID/页, 免费!) */
export async function getFollowerIds(
  cookies: XCookies,
  onProgress?: (count: number) => void
): Promise<string[]> {
  const allIds: string[] = []
  let cursor = '-1'

  while (cursor !== '0') {
    const params = new URLSearchParams({
      cursor,
      stringify_ids: 'true',
      count: '5000',
    })

    const resp = await xFetch(
      `https://x.com/i/api/1.1/followers/ids.json?${params}`,
      { method: 'GET' },
      cookies
    )

    if (!resp.ok) {
      logger.error(`获取粉丝 ID 失败: ${resp.status}`)
      break
    }

    const data = await resp.json()
    const ids: string[] = data.ids || []
    allIds.push(...ids)

    onProgress?.(allIds.length)
    logger.info(`已获取 ${allIds.length} 个粉丝 ID`)

    cursor = data.next_cursor_str || '0'

    if (cursor !== '0') {
      await readDelay()
    }
  }

  return allIds
}

// ===== GraphQL API =====

/** GraphQL 请求通用封装 */
async function graphqlRequest(
  cookies: XCookies,
  queryId: string,
  variables: Record<string, unknown>,
  features: Record<string, boolean> = GQL_FEATURES
): Promise<unknown> {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  })

  const resp = await xFetch(
    `https://x.com/i/api/graphql/${queryId}/SearchTimeline?${params}`,
    { method: 'GET' },
    cookies
  )

  if (!resp.ok) {
    throw new XApiError(resp.status, `GraphQL request failed: ${resp.status}`)
  }

  return resp.json()
}

/** 搜索蓝V用户 */
export async function searchBlueVerified(
  cookies: XCookies,
  query: string,
  cursor?: string
): Promise<{ users: XUserBasic[]; nextCursor?: string }> {
  const variables: Record<string, unknown> = {
    rawQuery: `${query} filter:blue_verified`,
    count: 20,
    querySource: 'typed_query',
    product: 'People',
  }

  if (cursor) {
    variables.cursor = cursor
  }

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GQL_FEATURES),
  })

  const resp = await xFetch(
    `https://x.com/i/api/graphql/${GQL.SearchTimeline}/SearchTimeline?${params}`,
    { method: 'GET' },
    cookies
  )

  if (!resp.ok) {
    return { users: [] }
  }

  const data = await resp.json() as any

  const users: XUserBasic[] = []
  let nextCursor: string | undefined

  try {
    const instructions = data.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || []
    for (const inst of instructions) {
      const entries = inst.entries || []
      for (const entry of entries) {
        // 用户条目
        const result = entry.content?.itemContent?.user_results?.result
        if (result?.legacy) {
          users.push(parseUserLegacy(result))
        }

        // 翻页光标
        if (entry.content?.cursorType === 'Bottom') {
          nextCursor = entry.content.value
        }
      }
    }
  } catch (err) {
    logger.error('解析搜索结果失败:', err)
  }

  return { users, nextCursor }
}

/** 发推 */
export async function createTweet(
  cookies: XCookies,
  text: string,
  mediaIds?: string[]
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  try {
    const variables: Record<string, unknown> = {
      tweet_text: text,
      dark_request: false,
      media: mediaIds
        ? { media_entities: mediaIds.map((id) => ({ media_id: id, tagged_users: [] })), possibly_sensitive: false }
        : { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    }

    const resp = await xFetch(
      `https://x.com/i/api/graphql/${GQL.CreateTweet}/CreateTweet`,
      {
        method: 'POST',
        body: JSON.stringify({
          variables,
          features: GQL_FEATURES,
          queryId: GQL.CreateTweet,
        }),
      },
      cookies
    )

    if (!resp.ok) {
      return { success: false, error: `CreateTweet failed: ${resp.status}` }
    }

    const data = await resp.json() as any
    const tweetId = data.data?.create_tweet?.tweet_results?.result?.rest_id

    return { success: true, tweetId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/** 点赞 */
export async function likeTweet(
  cookies: XCookies,
  tweetId: string
): Promise<{ success: boolean }> {
  try {
    const resp = await xFetch(
      `https://x.com/i/api/graphql/${GQL.FavoriteTweet}/FavoriteTweet`,
      {
        method: 'POST',
        body: JSON.stringify({
          variables: { tweet_id: tweetId },
          queryId: GQL.FavoriteTweet,
        }),
      },
      cookies
    )

    return { success: resp.ok }
  } catch {
    return { success: false }
  }
}

/** 转发 */
export async function retweet(
  cookies: XCookies,
  tweetId: string
): Promise<{ success: boolean }> {
  try {
    const resp = await xFetch(
      `https://x.com/i/api/graphql/${GQL.CreateRetweet}/CreateRetweet`,
      {
        method: 'POST',
        body: JSON.stringify({
          variables: { tweet_id: tweetId, dark_request: false },
          queryId: GQL.CreateRetweet,
        }),
      },
      cookies
    )

    return { success: resp.ok }
  } catch {
    return { success: false }
  }
}

// ===== 工具函数 =====

/** 解析 Twitter legacy 用户对象 */
function parseUserLegacy(result: any): XUserBasic {
  const legacy = result.legacy
  return {
    id: result.rest_id,
    screenName: legacy.screen_name,
    displayName: legacy.name,
    profileImageUrl: legacy.profile_image_url_https?.replace('_normal', '_200x200'),
    profileBannerUrl: legacy.profile_banner_url || undefined,
    isVerified: result.is_blue_verified || false,
    followersCount: legacy.followers_count || 0,
    followingCount: legacy.friends_count || 0,
    statusesCount: legacy.statuses_count || 0,
    favouritesCount: legacy.favourites_count || 0,
    listedCount: legacy.listed_count || 0,
    bio: legacy.description || undefined,
    location: legacy.location || undefined,
    createdAt: legacy.created_at || undefined,
  }
}
