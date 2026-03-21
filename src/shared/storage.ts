import { STORAGE_KEYS, type XUserBasic } from './types'

export async function getStorage<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key)
  return result[key] ?? null
}

export async function setStorage(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function removeStorage(key: string): Promise<void> {
  await chrome.storage.local.remove(key)
}

export async function getToken(): Promise<string | null> {
  return getStorage<string>(STORAGE_KEYS.xsocialToken)
}

export async function setToken(token: string): Promise<void> {
  await setStorage(STORAGE_KEYS.xsocialToken, token)
}

export async function getXUserInfo(): Promise<XUserBasic | null> {
  return getStorage<XUserBasic>(STORAGE_KEYS.xUserInfo)
}

export async function setXUserInfo(user: XUserBasic | null): Promise<void> {
  if (user) {
    await setStorage(STORAGE_KEYS.xUserInfo, user)
  } else {
    await removeStorage(STORAGE_KEYS.xUserInfo)
  }
}
