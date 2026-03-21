import { useState, useEffect } from 'react'

export interface TaskStep {
  action: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
}

export interface CurrentTask {
  taskId: string
  title: string
  taskType: string
  mode: string
  steps: TaskStep[]
  currentStep: number
  status: 'running' | 'completed' | 'aborted'
  startedAt: number
  completedAt?: number
  summary?: string
}

export function useCurrentTask(pollInterval = 2000) {
  const [task, setTask] = useState<CurrentTask | null>(null)

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TASK' })
        if (res?.success) setTask(res.data || null)
      } catch { /* ignore */ }
    }
    fetch_()
    const timer = setInterval(fetch_, pollInterval)
    return () => clearInterval(timer)
  }, [pollInterval])

  return task
}
