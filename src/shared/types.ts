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
