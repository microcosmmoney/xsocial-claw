// ===== Twitter 类型 =====

export interface XCookies {
  ct0: string
  authToken: string
}

export interface XUserBasic {
  id: string
  screenName: string
  displayName: string
  profileImageUrl?: string
  profileBannerUrl?: string
  isVerified: boolean
  followersCount: number
  followingCount: number
  statusesCount: number
  favouritesCount: number
  listedCount: number
  bio?: string
  location?: string
  createdAt?: string
}

export interface XFriendshipStatus {
  id: string
  screenName: string
  connections: ('following' | 'followed_by' | 'blocking' | 'muting' | 'none')[]
}

// ===== Step 协议类型 =====

export interface StepConfig {
  type: 'click' | 'type' | 'press' | 'scroll'
  ref?: string
  text?: string
  key?: string
  pixels?: number
  humanDelay?: boolean
}

export interface SnapshotResult {
  snapshot: string
  elementCount: number
  url: string
  title: string
}

export interface StepResult {
  taskId: string
  stepOrder: number
  status: 'completed' | 'failed'
  result?: SnapshotResult & Record<string, unknown>
  error?: string
}

export interface TaskExecuteMessage {
  taskId: string
  title: string
  taskType: string
  mode: 'interactive' | 'batch'
  steps: Array<{
    stepOrder: number
    action: string
    description: string
    config: Record<string, unknown>
  }>
}

export interface StepNextMessage {
  taskId: string
  stepOrder: number
  action: string
  description?: string
  config: Record<string, unknown>
  timeout?: number
}

// ===== 消息类型 =====

export type MessageType =
  | 'GET_COOKIES'
  | 'SNAPSHOT'
  | 'ACTION'
  | 'GET_PAGE_INFO'
  | 'URL_CHANGED'
  | 'CONNECT_WS'
  | 'GET_WS_STATUS'

export interface ExtMessage<T = unknown> {
  type: MessageType | string
  payload?: T
}

export interface ExtResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ===== 存储 Key =====

export const STORAGE_KEYS = {
  xsocialToken: 'xsocial_token',
  xUserInfo: 'x_user_info',
  settings: 'extension_settings',
  wsConnected: 'ws_connected',
  unfollowTask: 'unfollow_task',
  deviceId: 'device_id',
  deviceName: 'device_name',
} as const

// ===== 取关任务类型 =====

export interface UnfollowConfig {
  delayMin: number      // ms, 取关间隔最小
  delayMax: number      // ms, 取关间隔最大
  hourlyLimit: number   // 每小时上限
  dailyLimit: number    // 每日上限
}

export interface NonFollowerEntry {
  userId: string
  screenName?: string
  displayName?: string
}

export interface UnfollowTaskState {
  taskId: string
  status: 'scanning' | 'ready' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled'
  scanMode: 'api' | 'page'
  xScreenName: string
  nonFollowers: NonFollowerEntry[]
  nonFollowerCount: number
  unfollowedCount: number
  failedCount: number
  lastProcessedIndex: number
  config: UnfollowConfig
  hourlyCount: number
  dailyCount: number
  recentActions: UnfollowAction[]
}

export interface UnfollowAction {
  userId: string
  screenName?: string
  success: boolean
  timestamp: number
  error?: string
}

// ===== 运营工具类型 =====

/** 互关检查结果 */
export interface MutualCheckResult {
  totalFollowing: number
  totalFollowers: number
  nonFollowers: NonFollowerEntry[]
  mutualCount: number
  scanTime: number  // ms
}

/** 取关计划配置 */
export interface UnfollowPlanConfig {
  hourlyRate: number     // 每小时取关数
  totalDays: number      // 计划天数
  activeHoursStart: number  // 活跃时段开始 (24h)
  activeHoursEnd: number    // 活跃时段结束
}

// ===== 点赞伴随开关类型 =====

/** 点赞伴随配置 */
export interface LikeAutoConfig {
  enabled: boolean             // 总开关
  dailyLimit: number           // 每日上限 (默认50)
  probability: number          // 伴随概率 0-1 (默认0.3 = 30%)
  minGapSec: number            // 两次点赞最小间隔秒 (默认30)
}

/** 点赞伴随状态 */
export interface LikeAutoState {
  enabled: boolean
  dailyCount: number           // 今日已点赞数
  dailyLimit: number
  lastLikedAt: number | null   // 最近一次点赞时间戳
  todayDate: string            // YYYY-MM-DD
}

// ===== AI 模型管理类型 =====

export type AIProviderType = 'gemini' | 'openai_compatible'

/** 预置模型定义 (只读, 用户只需填 Key) */
export interface PresetModelDef {
  id: string
  name: string
  provider: AIProviderType
  baseUrl: string
  modelId: string
  free: boolean
  maxTokens: number
  description: string
}

/** 用户配置的模型 (Key + 状态) */
export interface UserModelConfig {
  modelId: string              // 对应 PresetModelDef.id
  apiKey: string               // 用户填入的 Key
  addedAt: number              // 添加时间戳
  lastError?: string           // 最近一次错误信息
  lastErrorAt?: number         // 错误时间戳
  lastTestedAt?: number        // 上次测试时间
  testOk?: boolean             // 测试是否通过
}

/** AI 模型管理状态 */
export interface ModelManagerState {
  activeModelId: string | null  // 当前激活的模型 (null=使用平台模型)
  userModels: UserModelConfig[] // 用户已配置的模型
}

// ===== 关注自动化类型 =====

export type FollowMode = 'homepage' | 'detail' | 'mixed'

/** 关注自动化配置 */
export interface FollowAutoConfig {
  mode: FollowMode
  sessionLimit: number         // 每次关注上限 (默认12)
  dailyLimit: number           // 每日关注上限 (默认200)
  activeHoursStart: number     // 活跃时段开始 (默认8)
  activeHoursEnd: number       // 活跃时段结束 (默认23)
  detailMinReplies: number     // 进入详情页的最低回帖数 (默认20)
  consecutiveFollowedExit: number  // 详情页连续已关注退出阈值 (默认5)
}

/** 时间线推文扫描结果 */
export interface ScannedTweet {
  handle: string               // @username
  displayName: string
  text: string                 // 推文正文 (截断)
  hasBlueVKeyword: boolean     // 正文含"蓝V"
  replyCount: number           // 回帖数
  tweetUrl: string             // /user/status/xxx
  tweetLinkRef: string         // content script ref
}

/** 详情页回帖者扫描结果 */
export interface ScannedReply {
  handle: string
  displayName: string
  articleRef: string            // content script ref (article element)
}

/** 关注会话状态 */
export interface FollowSessionState {
  status: 'idle' | 'running' | 'paused' | 'waiting' | 'completed'
  mode: FollowMode
  sessionFollowed: number      // 本次已关注
  sessionTarget: number        // 本次目标 (12)
  dailyFollowed: number        // 今日已关注
  dailyTarget: number          // 今日上限 (200)
  currentPhase: string         // 当前阶段描述
  nextSessionTime: number | null  // 下次会话时间戳
  log: FollowLogEntry[]        // 最近操作日志
  startedAt: number | null
  todayDate: string            // YYYY-MM-DD
}

/** 关注操作日志条目 */
export interface FollowLogEntry {
  handle: string
  success: boolean
  source: 'homepage' | 'detail'
  timestamp: number
  error?: string
}

/** AI 润色发帖请求 */
export interface AiPolishRequest {
  text: string                 // 用户原始输入 (文字或语音转文字)
  targetLength: number         // 目标字数: 280 / 500 / 1000 / 1500
  style?: 'casual' | 'professional' | 'humorous' | 'provocative'
  language?: 'zh' | 'en'
}

/** AI 润色发帖状态 */
export interface PostToolState {
  dailyPolishCount: number     // 今日已用润色次数
  dailyPolishLimit: number     // 每日润色上限 (3)
  todayDate: string
}
