import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return getSystemDark() ? 'dark' : 'light'
  return mode
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  // 初始化：从 storage 读取
  useEffect(() => {
    chrome.storage.local.get('theme_mode').then((store) => {
      const saved = (store.theme_mode as ThemeMode) || 'system'
      setMode(saved)
      setResolved(resolveTheme(saved))
    })
  }, [])

  // 监听系统主题变化
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (mode === 'system') {
        setResolved(getSystemDark() ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  // 应用到 DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
  }, [resolved])

  const cycleTheme = useCallback(() => {
    const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
    setMode(next)
    setResolved(resolveTheme(next))
    chrome.storage.local.set({ theme_mode: next })
  }, [mode])

  return { mode, resolved, cycleTheme }
}
