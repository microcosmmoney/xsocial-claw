import React, { useState } from 'react'

interface UnboundViewProps {
  nodeCode: string | null
  wsConnected: boolean
}

interface NodeInfo {
  id: string
  nodeCode: string
  deviceName: string | null
  isOnline: boolean
  xScreenName: string | null
  avatarUrl: string | null
  accountType: string | null
}

type ViewState = 'initial' | 'logging_in' | 'select_node' | 'restoring' | 'success'

export default function UnboundView({ nodeCode, wsConnected }: UnboundViewProps) {
  const [viewState, setViewState] = useState<ViewState>('initial')
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [loginToken, setLoginToken] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [oldCode, setOldCode] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // ===== Copy device code (no selection state, show tooltip) =====
  const handleCopyCode = () => {
    if (!nodeCode) return
    navigator.clipboard.writeText(nodeCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // ===== Email/password login (xSocial -> Microcosm auth chain) =====
  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter email and password')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'MICROCOSM_LOGIN',
        payload: { email: email.trim(), password },
      })
      if (res?.success && res.data?.token) {
        setLoginToken(res.data.token)
        const nodeList: NodeInfo[] = res.data.nodes || []
        setNodes(nodeList)
        if (nodeList.length === 0) {
          setViewState('initial')
          setShowLogin(false)
        } else {
          setViewState('select_node')
        }
      } else {
        setError(res?.error || 'Login failed')
      }
    } catch {
      setError('Network error, please try again')
    } finally {
      setLoading(false)
    }
  }

  // ===== Select node to restore =====
  const handleSelectNode = async (node: NodeInfo) => {
    setViewState('restoring')
    setError('')
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SELECT_NODE',
        payload: { nodeCode: node.nodeCode, token: loginToken },
      })
      if (res?.success) {
        setViewState('success')
      } else {
        setError(res?.error || 'Restore failed')
        setViewState('select_node')
      }
    } catch {
      setError('Operation failed')
      setViewState('select_node')
    }
  }

  // ===== Manual entry of old node ID =====
  const handleManualRecover = async () => {
    const code = oldCode.trim().toUpperCase()
    if (!code) return
    setLoading(true)
    setError('')
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'RECOVER_NODE',
        payload: { oldNodeCode: code },
      })
      if (res?.success) {
        setViewState('success')
      } else {
        setError(res?.error || 'Restore failed')
      }
    } catch {
      setError('Operation failed')
    } finally {
      setLoading(false)
    }
  }

  // ===== Success: refresh after 2 seconds =====
  if (viewState === 'success') {
    setTimeout(() => window.location.reload(), 2000)
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '40px 24px',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: '#22c55e',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p style={{ fontSize: 15, color: '#22c55e', fontWeight: 600 }}>Restored Successfully</p>
        <p style={{ fontSize: 12, color: '#999', marginTop: 6 }}>Reconnecting...</p>
      </div>
    )
  }

  // ===== Logging in / Restoring =====
  if (viewState === 'logging_in' || viewState === 'restoring') {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 12,
      }}>
        <div className="animate-spin" style={{
          width: 28, height: 28, border: '3px solid #e0e0e5',
          borderTopColor: '#ff5722', borderRadius: '50%',
        }} />
        <p style={{ fontSize: 14, color: '#555', fontWeight: 500 }}>
          {viewState === 'restoring' ? 'Restoring node...' : 'Logging in...'}
        </p>
      </div>
    )
  }

  // ===== Node selection =====
  if (viewState === 'select_node') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e', marginBottom: 4 }}>
          Select a Node to Restore
        </p>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          Login successful. Please select a node to connect to this browser
        </p>

        {error && (
          <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {nodes.map((node) => (
            <button
              key={node.id}
              onClick={() => handleSelectNode(node)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                background: '#fff', border: '1px solid #e0e0e5',
                cursor: 'pointer', textAlign: 'left',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#ff5722'
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(255,87,34,0.12)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e0e0e5'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: node.avatarUrl ? `url(${node.avatarUrl}) center/cover` : '#e8e8ec',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, color: '#aaa',
              }}>
                {!node.avatarUrl && '🤖'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#ff5722', letterSpacing: 1 }}>
                    {node.nodeCode}
                  </span>
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: node.isOnline ? '#22c55e' : '#d1d5db',
                  }} />
                </div>
                {node.xScreenName && (
                  <div style={{ fontSize: 12, color: '#536471', marginTop: 1 }}>@{node.xScreenName}</div>
                )}
                {node.deviceName && node.deviceName !== node.nodeCode && (
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{node.deviceName}</div>
                )}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>

        <button
          onClick={() => { setViewState('initial'); setError('') }}
          style={{
            marginTop: 16, padding: '8px', borderRadius: 6,
            border: '1px solid #ddd', background: '#fff',
            fontSize: 12, color: '#888', cursor: 'pointer', fontFamily: 'inherit', width: '100%',
          }}
        >
          Back
        </button>
      </div>
    )
  }

  // ===== Initial state (before login) =====
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '30px 20px', textAlign: 'center',
      overflowY: 'auto',
    }}>

      {/* Error message */}
      {error && (
        <p style={{ fontSize: 12, color: '#ef4444', marginBottom: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, width: '100%' }}>
          {error}
        </p>
      )}

      {/* ===== Login form ===== */}
      {showLogin && !showManual && (
        <div style={{
          width: '100%', padding: '16px',
          background: '#fff', borderRadius: 10,
          border: '1px solid #e0e0e5', textAlign: 'left', marginBottom: 16,
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', marginBottom: 4 }}>
            Sign in to xSocial
          </p>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 12 }}>
            Authenticate via Microcosm
          </p>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid #ddd', fontSize: 14, marginBottom: 8,
              outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = '#ff5722'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#ddd'}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid #ddd', fontSize: 14, marginBottom: 12,
              outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = '#ff5722'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#ddd'}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleLogin}
              disabled={loading}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                background: loading ? '#ccc' : 'linear-gradient(135deg, #ff5722, #e64a19)',
                color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <button
              onClick={() => { setShowLogin(false); setError('') }}
              style={{
                padding: '10px 16px', borderRadius: 8,
                border: '1px solid #ddd', background: '#fff',
                fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ===== Manual old node ID entry ===== */}
      {showManual && !showLogin && (
        <div style={{
          width: '100%', padding: '16px',
          background: '#fff', borderRadius: 10,
          border: '1px solid #e0e0e5', textAlign: 'left', marginBottom: 16,
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', marginBottom: 12 }}>
            Enter Old Node ID
          </p>
          <p style={{ fontSize: 11, color: '#999', marginBottom: 12 }}>
            Enter your previous node code to automatically restore all settings
          </p>
          <input
            value={oldCode}
            onChange={(e) => setOldCode(e.target.value.toUpperCase())}
            placeholder="e.g. N-010"
            onKeyDown={(e) => e.key === 'Enter' && handleManualRecover()}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid #ddd', fontSize: 16, marginBottom: 12,
              outline: 'none', fontFamily: 'monospace', letterSpacing: 2,
              textAlign: 'center', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleManualRecover}
              disabled={loading || !oldCode.trim()}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                background: loading ? '#ccc' : '#ff5722', color: '#fff',
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {loading ? 'Restoring...' : 'Restore Node'}
            </button>
            <button
              onClick={() => { setShowManual(false); setError('') }}
              style={{
                padding: '10px 16px', borderRadius: 8,
                border: '1px solid #ddd', background: '#fff',
                fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ===== Main button area (before login) ===== */}
      {!showLogin && !showManual && (
        <>
          {/* Logo */}
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'linear-gradient(135deg, #ff5722, #e64a19)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16, boxShadow: '0 4px 12px rgba(255,87,34,0.3)',
          }}>
            <span style={{ fontSize: 28, color: '#fff', fontWeight: 800 }}>x</span>
          </div>

          <p style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>
            xSocial Agent
          </p>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 24, lineHeight: 1.5 }}>
            AI-Powered Social Media Automation
          </p>

          {/* Sign In + Sign Up buttons */}
          <div style={{ display: 'flex', gap: 10, width: '100%', marginBottom: 10 }}>
            <button
              onClick={() => { setShowLogin(true); setError('') }}
              style={{
                flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #ff5722, #e64a19)',
                color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(255,87,34,0.25)',
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => { window.open('https://xsocial.cc/register', '_blank') }}
              style={{
                flex: 1, padding: '12px', borderRadius: 10,
                border: '2px solid #ff5722', background: '#fff',
                color: '#ff5722', fontSize: 15, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Sign Up
            </button>
          </div>

          <p style={{ fontSize: 11, color: '#aaa', marginBottom: 20, lineHeight: 1.5 }}>
            Already have an account? Sign in to restore your nodes and settings
          </p>

          {/* Divider */}
          <div style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 16, color: '#ccc', fontSize: 11,
          }}>
            <div style={{ flex: 1, height: 1, background: '#e0e0e5' }} />
            <span>or</span>
            <div style={{ flex: 1, height: 1, background: '#e0e0e5' }} />
          </div>

          {/* Manual old ID entry */}
          <button
            onClick={() => { setShowManual(true); setError('') }}
            style={{
              width: '100%', padding: '10px', borderRadius: 8,
              background: '#fff', border: '1px solid #e0e0e5',
              cursor: 'pointer', fontSize: 13, color: '#555', fontFamily: 'inherit',
            }}
          >
            Restore with Node ID
          </button>

          {/* Device code (small text at bottom, subtle) */}
          {nodeCode && (
            <div style={{ marginTop: 24 }}>
              <div
                onClick={handleCopyCode}
                style={{
                  display: 'inline-block', padding: '4px 14px', borderRadius: 6,
                  background: '#f5f5f5', border: '1px solid #e0e0e5',
                  fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
                  color: '#888', letterSpacing: 1, cursor: 'pointer',
                  userSelect: 'none', position: 'relative',
                }}
              >
                {nodeCode}
                {copied && (
                  <span style={{
                    position: 'absolute', top: -28, left: '50%', transform: 'translateX(-50%)',
                    padding: '3px 10px', borderRadius: 4, background: '#333', color: '#fff',
                    fontSize: 11, whiteSpace: 'nowrap',
                  }}>
                    Copied
                  </span>
                )}
              </div>
              <p style={{ fontSize: 10, color: '#bbb', marginTop: 4 }}>
                Enter this code at xsocial.cc for first-time binding
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
