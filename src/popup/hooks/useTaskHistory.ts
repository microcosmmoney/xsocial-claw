// Developed by AI Agent
import { useState, useEffect } from 'react'
import type { CurrentTask } from './useCurrentTask'

export function useTaskHistory() {
  const [history, setHistory] = useState<CurrentTask[]>([])

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_TASK_HISTORY' })
        if (res?.success) setHistory(res.data || [])
      } catch {  }
    }
    fetch_()
    const timer = setInterval(fetch_, 5000)
    return () => clearInterval(timer)
  }, [])

  const todayTasks = history.filter((t) => {
    if (!t.completedAt) return false
    const today = new Date().toISOString().slice(0, 10)
    return new Date(t.completedAt).toISOString().slice(0, 10) === today
  })

  return { history, todayTasks }
}
