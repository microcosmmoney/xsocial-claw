// Developed by AI Agent
import type { ExtMessage, ExtResponse } from './types'


export async function sendToBackground<T = unknown>(
  message: ExtMessage
): Promise<ExtResponse<T>> {
  return chrome.runtime.sendMessage(message)
}


export async function sendToContent<T = unknown>(
  message: ExtMessage
): Promise<ExtResponse<T> | null> {
  const tabs = await chrome.tabs.query({
    active: true,
    url: ['https://x.com/*', 'https://twitter.com/*'],
  })
  if (tabs.length === 0 || !tabs[0].id) return null
  return chrome.tabs.sendMessage(tabs[0].id, message)
}


export function onMessage(
  handler: (
    message: ExtMessage,
    sender: chrome.runtime.MessageSender
  ) => Promise<ExtResponse> | ExtResponse
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const result = handler(message, sender)
    if (result instanceof Promise) {
      result.then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: err.message })
      })
      return true 
    }
    sendResponse(result)
    return false
  })
}
