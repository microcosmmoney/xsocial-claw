import { useState, useEffect } from 'react'

export interface DailyKpi {
  posts: number
  likes: number
  replies: number
  follows: number
  followChecks: number
  date: string
}

export function useKpi() {
  const [kpi, setKpi] = useState<DailyKpi>({
    posts: 0, likes: 0, replies: 0, follows: 0, followChecks: 0,
    date: new Date().toISOString().slice(0, 10),
  })

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_KPI' })
        if (res?.success && res.data) setKpi(res.data)
      } catch { /* ignore */ }
    }
    fetch_()
  }, [])

  return kpi
}
