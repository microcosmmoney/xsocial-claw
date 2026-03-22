import React, { useState, useEffect, useRef } from 'react'

type PostStyle = 'casual' | 'professional' | 'humorous' | 'provocative'
type TargetLength = 280 | 500 | 1000 | 1500

const STYLES: { id: PostStyle; label: string }[] = [
  { id: 'casual', label: '随意' },
  { id: 'professional', label: '专业' },
  { id: 'humorous', label: '幽默' },
  { id: 'provocative', label: '犀利' },
]

const LENGTHS: { value: TargetLength; label: string }[] = [
  { value: 280, label: '短帖 280字' },
  { value: 500, label: '中等 500字' },
  { value: 1000, label: '长帖 1000字' },
  { value: 1500, label: '最长 1500字' },
]

const MAX_RECORD_SEC = 300 // 5分钟

export default function PostTool() {
  const [inputText, setInputText] = useState('')
  const [style, setStyle] = useState<PostStyle>('casual')
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [targetLength, setTargetLength] = useState<TargetLength>(280)
  const [polishedText, setPolishedText] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // 润色计次
  const [remaining, setRemaining] = useState<number | null>(null)
  const [dailyLimit, setDailyLimit] = useState(3)

  // 语音录入
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 加载润色剩余次数
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'TOOL_POST_STATUS' })
        if (res?.success && res.data) {
          setRemaining(res.data.remaining)
          setDailyLimit(res.data.dailyLimit)
        }
      } catch { /* ignore */ }
    })()
  }, [])

  // ===== 语音录入 =====

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        processAudio()
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordSec(0)

      // 倒计时
      timerRef.current = setInterval(() => {
        setRecordSec(prev => {
          if (prev + 1 >= MAX_RECORD_SEC) {
            stopRecording()
            return MAX_RECORD_SEC
          }
          return prev + 1
        })
      }, 1000)
    } catch {
      setResult({ success: false, message: '无法访问麦克风，请检查权限' })
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecording(false)
  }

  const processAudio = async () => {
    if (chunksRef.current.length === 0) return
    // 使用 Web Speech API 进行语音转文字 (浏览器内置, 免费)
    // 注: Chrome 扩展 popup 中 SpeechRecognition 可能不可用
    // 回退方案: 提示用户手动输入
    setResult({ success: false, message: '语音录制完成。请在浏览器中使用语音输入 (Chrome 地址栏右侧麦克风图标)，或手动输入文字。' })
  }

  // ===== 润色 =====

  const handlePolish = async () => {
    if (!inputText.trim() || inputText.trim().length < 5) {
      setResult({ success: false, message: '输入内容不能少于5个字' })
      return
    }
    if (remaining !== null && remaining <= 0) {
      setResult({ success: false, message: '今日润色次数已用完，明天再来。或在 AI 模型管理中配置自己的模型。' })
      return
    }

    setPolishing(true)
    setResult(null)
    setPolishedText('')
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TOOL_AI_POLISH',
        payload: { text: inputText.trim(), targetLength, style, language },
      })
      if (res?.success && res.data?.text) {
        setPolishedText(res.data.text)
        setRemaining(res.data.remaining ?? null)
      } else {
        setResult({ success: false, message: res?.error || res?.data?.error || 'AI 润色失败' })
        if (res?.data?.remaining !== undefined) setRemaining(res.data.remaining)
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '润色失败' })
    }
    setPolishing(false)
  }

  // ===== 发帖 =====

  const handlePost = async (text: string) => {
    if (!text.trim()) return
    setPosting(true)
    setResult(null)
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TOOL_DIRECT_POST',
        payload: { text: text.trim() },
      })
      if (res?.success) {
        setResult({ success: true, message: `发帖成功${res.data?.tweetId ? ` (ID: ${res.data.tweetId})` : ''}` })
        setPolishedText('')
        setInputText('')
      } else {
        setResult({ success: false, message: res?.error || '发帖失败' })
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '发帖失败' })
    }
    setPosting(false)
  }

  const remainingStr = remaining !== null ? `${remaining}/${dailyLimit}` : '...'

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          润色发帖
        </h3>
        <span style={{
          fontSize: 10, padding: '3px 8px', borderRadius: 10,
          background: (remaining ?? 1) > 0 ? 'rgba(29,155,240,0.1)' : 'rgba(239,68,68,0.1)',
          color: (remaining ?? 1) > 0 ? '#1d9bf0' : '#ef4444',
          fontWeight: 600,
        }}>
          今日润色: {remainingStr}
        </span>
      </div>

      {/* 输入区 */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入你想发的内容... (支持口语化内容，AI 会帮你润色)"
          rows={4}
          disabled={polishing}
          style={{
            width: '100%', padding: '10px 12px', paddingRight: 40, borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-primary)',
            color: 'var(--text-primary)', fontSize: 13, outline: 'none',
            resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        {/* 语音按钮 */}
        <button
          onClick={recording ? stopRecording : startRecording}
          title={recording ? '停止录音' : '语音输入'}
          style={{
            position: 'absolute', right: 8, top: 8,
            width: 30, height: 30, borderRadius: '50%', border: 'none',
            background: recording ? '#ef4444' : 'rgba(29,155,240,0.1)',
            color: recording ? '#fff' : '#1d9bf0',
            fontSize: 14, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {recording ? '■' : '🎙'}
        </button>
      </div>

      {/* 录音中倒计时 */}
      {recording && (
        <div style={{
          marginBottom: 8, padding: '8px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 11,
        }}>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>
            录音中... {Math.floor(recordSec / 60)}:{String(recordSec % 60).padStart(2, '0')}
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            剩余 {Math.floor((MAX_RECORD_SEC - recordSec) / 60)}:{String((MAX_RECORD_SEC - recordSec) % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* 字数 + 风格 + 语言选择 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {LENGTHS.map((l) => (
          <button key={l.value} onClick={() => setTargetLength(l.value)} style={{
            padding: '4px 10px', borderRadius: 12, fontSize: 10,
            border: `1px solid ${targetLength === l.value ? '#1d9bf0' : 'var(--border)'}`,
            background: targetLength === l.value ? 'rgba(29,155,240,0.1)' : 'transparent',
            color: targetLength === l.value ? '#1d9bf0' : 'var(--text-tertiary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {l.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {STYLES.map((s) => (
          <button key={s.id} onClick={() => setStyle(s.id)} style={{
            padding: '4px 10px', borderRadius: 12, fontSize: 10,
            border: `1px solid ${style === s.id ? '#ff5722' : 'var(--border)'}`,
            background: style === s.id ? 'rgba(255,87,34,0.1)' : 'transparent',
            color: style === s.id ? '#ff5722' : 'var(--text-tertiary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {s.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['zh', 'en'] as const).map((l) => (
            <button key={l} onClick={() => setLanguage(l)} style={{
              padding: '4px 8px', borderRadius: 12, fontSize: 10,
              border: `1px solid ${language === l ? '#ff5722' : 'var(--border)'}`,
              background: language === l ? 'rgba(255,87,34,0.1)' : 'transparent',
              color: language === l ? '#ff5722' : 'var(--text-tertiary)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {l === 'zh' ? '中文' : 'EN'}
            </button>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          onClick={handlePolish}
          disabled={polishing || !inputText.trim() || (remaining !== null && remaining <= 0)}
          style={{
            flex: 1, padding: '10px', borderRadius: 8, border: 'none',
            background: polishing ? '#666' : '#1d9bf0', color: '#fff',
            fontSize: 12, fontWeight: 600,
            cursor: (polishing || (remaining !== null && remaining <= 0)) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {polishing ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span className="animate-spin" style={{
                width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block',
              }} />
              润色中...
            </span>
          ) : (remaining !== null && remaining <= 0) ? '今日已用完' : `AI 润色 (剩 ${remainingStr})`}
        </button>
        <button
          onClick={() => handlePost(inputText)}
          disabled={posting || !inputText.trim()}
          style={{
            flex: 1, padding: '10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 12,
            cursor: (!inputText.trim() || posting) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          直接发帖
        </button>
      </div>

      {/* 润色结果 */}
      {polishedText && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>润色结果 ({polishedText.length} 字)</span>
          </div>
          <div style={{
            padding: '12px', borderRadius: 8,
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 180, overflowY: 'auto',
          }}>
            {polishedText}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handlePolish} disabled={polishing || (remaining !== null && remaining <= 0)} style={{
              flex: 1, padding: '9px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              重新润色
            </button>
            <button onClick={() => handlePost(polishedText)} disabled={posting} style={{
              flex: 1, padding: '9px', borderRadius: 8, border: 'none',
              background: posting ? '#666' : '#22c55e', color: '#fff',
              fontSize: 11, fontWeight: 600, cursor: posting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>
              {posting ? '发送中...' : '发布润色后内容'}
            </button>
          </div>
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div style={{
          marginBottom: 10, padding: '10px 12px', borderRadius: 8,
          background: result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${result.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          fontSize: 12, color: result.success ? '#22c55e' : '#ef4444',
        }}>
          {result.message}
        </div>
      )}

      {/* 成本说明 */}
      <div style={{
        padding: '10px 12px', borderRadius: 8,
        background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.1)',
        fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6,
      }}>
        <strong style={{ color: '#f59e0b' }}>为什么限制每日 {dailyLimit} 次?</strong>
        <br />AI 润色使用 Gemini 2.5 Flash 模型，每次调用都有 Token 成本，由平台承担。
        为了控制运营支出，每人每日限 {dailyLimit} 次。直接发帖 (不润色) 不消耗次数。
        <br /><br />
        <strong>自有模型:</strong> 未来将开放"AI 模型管理"功能，接入你自己的 API Key 后，润色次数不再受限。
      </div>
    </div>
  )
}
