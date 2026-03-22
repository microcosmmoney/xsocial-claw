// Twitter 公共 Bearer Token (所有 Web 客户端共用)
export const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// xSocial 服务器
export const XSOCIAL_API = 'https://xsocial.cc'
export const XSOCIAL_WS = 'wss://ws.xsocial.cc'

// GraphQL Query IDs (2026-02, 需定期更新)
export const GQL = {
  BlueVerifiedFollowers: 'Pt7oXCkejFVUp8q8BCvu5A',
  SearchTimeline: 'gkjsKepM6gl_HmFWoWKfgg',
  TweetDetail: 'Kzfv17rukSzjT96BerOWZA',
  CommunityTweets: 't8QqbSRxbtHFoijYJ7LoDw',
  CommunityUserInvite: 'bz8uZZOzk3SUQUKTPioZpQ',
  Following: 'i2GOldCH2D3OUEhAdimLrA',
  Followers: 'oQWxG6XdR5SPvMBsPiKUPQ',
  CreateTweet: 'znCbFB5QpSqOmfFHiWmBOw',
  FavoriteTweet: 'lI07N6OPw1L0E0EkO3St8A',
  CreateRetweet: 'ojPdsZsimiJrUGLR1sjUtA',
} as const

// GraphQL Features (2026-02, 需定期更新)
export const GQL_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  subscriptions_verification_info_verified_since_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  highlights_tweets_tab_ui_enabled: true,
}

// AI 预置模型列表 (用户只需填 Key)
export const PRESET_MODELS = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini' as const,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-2.5-flash',
    free: false,
    maxTokens: 8000,
    description: '谷歌最新, 快速高质量, $0.15/1M token',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'gemini' as const,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelId: 'gemini-2.5-flash-lite',
    free: true,
    maxTokens: 8000,
    description: '免费 1500次/天, 适合轻度使用',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai_compatible' as const,
    baseUrl: 'https://api.openai.com',
    modelId: 'gpt-4o-mini',
    free: false,
    maxTokens: 4000,
    description: 'OpenAI 高性价比, $0.15/1M token',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'openai_compatible' as const,
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    free: false,
    maxTokens: 8000,
    description: '极致性价比 $0.28/1M token, 中文优秀',
  },
  {
    id: 'glm-4-flash',
    name: '智谱 GLM-4-Flash',
    provider: 'openai_compatible' as const,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-4-flash',
    free: true,
    maxTokens: 4000,
    description: '免费, 128K上下文, 中文优秀',
  },
  {
    id: 'groq-llama-3.3-70b',
    name: 'Groq Llama 3.3 70B',
    provider: 'openai_compatible' as const,
    baseUrl: 'https://api.groq.com/openai',
    modelId: 'llama-3.3-70b-versatile',
    free: true,
    maxTokens: 4000,
    description: '免费, 超高速推理',
  },
  {
    id: 'qwen-plus',
    name: '通义千问 Plus',
    provider: 'openai_compatible' as const,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    modelId: 'qwen-plus',
    free: false,
    maxTokens: 8000,
    description: '阿里云, OpenAI兼容, 中文强',
  },
]

// 速率控制默认值
export const RATE_LIMITS = {
  followDelayMin: 60_000,      // 关注最小间隔 60 秒
  followDelayMax: 180_000,     // 关注最大间隔 180 秒
  readDelayMin: 3_000,         // 读取最小间隔 3 秒
  readDelayMax: 8_000,         // 读取最大间隔 8 秒
  batchSize: 5,                // 每批操作数
  batchRestMin: 300_000,       // 批次休息最小 5 分钟
  batchRestMax: 600_000,       // 批次休息最大 10 分钟
  dailyFollowLimit: 80,        // 每日关注上限
  activeHoursStart: 8,         // 活跃时段开始 (24h)
  activeHoursEnd: 23,          // 活跃时段结束
  distractionChance: 0.05,     // 5% "走神" 概率
  distractionMin: 30_000,      // 走神最小 30 秒
  distractionMax: 120_000,     // 走神最大 120 秒
  heartbeatInterval: 300_000,  // 心跳间隔 5 分钟
}

// 取关安全参数 (上限)
export const UNFOLLOW_LIMITS = {
  delayMin: 30_000,            // 取关间隔最小 30 秒
  delayMax: 90_000,            // 取关间隔最大 90 秒
  hourlyLimitMax: 30,          // 每小时上限
  dailyLimitMax: 200,          // 每日上限
  consecutiveErrorMax: 3,      // 连续错误 → 自动暂停
  progressReportInterval: 5,   // 每 5 次取关上报一次进度
  scrollPauseMin: 1_000,       // 页面滚动间歇最小 1 秒
  scrollPauseMax: 3_000,       // 页面滚动间歇最大 3 秒
}
