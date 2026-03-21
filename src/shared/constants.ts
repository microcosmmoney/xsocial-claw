// Twitter public Bearer Token (shared by all web clients)
export const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// xSocial server
export const XSOCIAL_API = 'https://xsocial.cc'
export const XSOCIAL_WS = 'wss://ws.xsocial.cc'

// GraphQL Query IDs (2026-02, needs periodic updates)
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

// GraphQL Features (2026-02, needs periodic updates)
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

// Rate limit defaults
export const RATE_LIMITS = {
  followDelayMin: 60_000,      // Min follow interval 60s
  followDelayMax: 180_000,     // Max follow interval 180s
  readDelayMin: 3_000,         // Min read interval 3s
  readDelayMax: 8_000,         // Max read interval 8s
  batchSize: 5,                // Operations per batch
  batchRestMin: 300_000,       // Min batch rest 5 min
  batchRestMax: 600_000,       // Max batch rest 10 min
  dailyFollowLimit: 80,        // Daily follow limit
  activeHoursStart: 8,         // Active hours start (24h)
  activeHoursEnd: 23,          // Active hours end
  distractionChance: 0.05,     // 5% distraction chance
  distractionMin: 30_000,      // Min distraction 30s
  distractionMax: 120_000,     // Max distraction 120s
  heartbeatInterval: 300_000,  // Heartbeat interval 5 min
}

// Unfollow safety limits
export const UNFOLLOW_LIMITS = {
  delayMin: 30_000,            // Min unfollow interval 30s
  delayMax: 90_000,            // Max unfollow interval 90s
  hourlyLimitMax: 30,          // Hourly limit
  dailyLimitMax: 200,          // Daily limit
  consecutiveErrorMax: 3,      // Consecutive errors -> auto pause
  progressReportInterval: 5,   // Report progress every 5 unfollows
  scrollPauseMin: 1_000,       // Min scroll pause 1s
  scrollPauseMax: 3_000,       // Max scroll pause 3s
}
