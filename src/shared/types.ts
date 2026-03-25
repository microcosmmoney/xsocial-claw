// Developed by AI Agent


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


export const STORAGE_KEYS = {
  xsocialToken: 'xsocial_token',
  xUserInfo: 'x_user_info',
  settings: 'extension_settings',
  wsConnected: 'ws_connected',
  unfollowTask: 'unfollow_task',
  deviceId: 'device_id',
  deviceName: 'device_name',
} as const


export interface UnfollowConfig {
  delayMin: number      
  delayMax: number      
  hourlyLimit: number   
  dailyLimit: number    
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


export interface MutualCheckResult {
  totalFollowing: number
  totalFollowers: number
  nonFollowers: NonFollowerEntry[]
  mutualCount: number
  scanTime: number  
}


export interface UnfollowPlanConfig {
  hourlyRate: number     
  totalDays: number      
  activeHoursStart: number  
  activeHoursEnd: number    
}


export interface LikeAutoConfig {
  enabled: boolean             
  dailyLimit: number           
  probability: number          
  minGapSec: number            
}


export interface LikeAutoState {
  enabled: boolean
  dailyCount: number           
  dailyLimit: number
  lastLikedAt: number | null   
  todayDate: string            
}


export type AIProviderType = 'gemini' | 'openai_compatible'


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


export interface UserModelConfig {
  modelId: string              
  apiKey: string               
  addedAt: number              
  lastError?: string           
  lastErrorAt?: number         
  lastTestedAt?: number        
  testOk?: boolean             
}


export interface ModelManagerState {
  activeModelId: string | null  
  userModels: UserModelConfig[] 
}


export type FollowMode = 'homepage' | 'detail' | 'mixed'


export interface FollowAutoConfig {
  mode: FollowMode
  sessionLimit: number         
  dailyLimit: number           
  activeHoursStart: number     
  activeHoursEnd: number       
  detailMinReplies: number     
  consecutiveFollowedExit: number  
}


export interface ScannedTweet {
  handle: string               
  displayName: string
  text: string                 
  hasBlueVKeyword: boolean     
  replyCount: number           
  tweetUrl: string             
  tweetLinkRef: string         
}


export interface ScannedReply {
  handle: string
  displayName: string
  articleRef: string            
}


export interface FollowSessionState {
  status: 'idle' | 'running' | 'paused' | 'waiting' | 'completed'
  mode: FollowMode
  sessionFollowed: number      
  sessionTarget: number        
  dailyFollowed: number        
  dailyTarget: number          
  currentPhase: string         
  nextSessionTime: number | null  
  log: FollowLogEntry[]        
  startedAt: number | null
  todayDate: string            
}


export interface FollowLogEntry {
  handle: string
  success: boolean
  source: 'homepage' | 'detail'
  timestamp: number
  error?: string
}


export interface AiPolishRequest {
  text: string                 
  targetLength: number         
  style?: 'casual' | 'professional' | 'humorous' | 'provocative'
  language?: 'zh' | 'en'
}


export interface PostToolState {
  dailyPolishCount: number     
  dailyPolishLimit: number     
  todayDate: string
}
