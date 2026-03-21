import { useState, useEffect, useCallback } from 'react'

export interface XUserInfo {
  id?: string
  screenName: string
  displayName: string
  profileImageUrl?: string
  profileBannerUrl?: string
  isVerified: boolean
  followersCount: number
  followingCount: number
  statusesCount: number
  likesCount?: number
  mediaCount?: number
  bio?: string
  location?: string
  joinedAt?: string
}

export interface NodeStatus {
  deviceId: string
  deviceName: string | null
  nodeCode: string | null
  isBound: boolean
  userId: string | null
  hasToken: boolean
  xUser: XUserInfo | null
  wsConnected: boolean
}

export function useNodeStatus(pollInterval = 3000) {
  const [status, setStatus] = useState<NodeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch_ = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_NODE_STATUS' })
      if (res?.success && res.data) {
        setStatus(res.data)
      }
    } catch { /* popup may be closed */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetch_()
    const timer = setInterval(fetch_, pollInterval)
    return () => clearInterval(timer)
  }, [fetch_, pollInterval])

  return { status, loading, refresh: fetch_ }
}
