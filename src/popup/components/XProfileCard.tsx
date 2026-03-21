import React from 'react'
import type { XUserInfo } from '../hooks/useNodeStatus'

interface XProfileCardProps {
  xUser: XUserInfo
  nodeCode: string | null
}

function formatCount(n: number | undefined): string {
  if (n === undefined || n === null) return '0'
  return n.toLocaleString()
}

export default function XProfileCard({ xUser, nodeCode }: XProfileCardProps) {
  return (
    <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
      {/* Banner — Twitter-style 3:1 aspect ratio */}
      <div style={{
        height: 110,
        background: xUser.profileBannerUrl
          ? `url(${xUser.profileBannerUrl}/600x200) center/cover no-repeat`
          : 'linear-gradient(135deg, #1d9bf0 0%, #1a8cd8 50%, #0d6ebd 100%)',
        position: 'relative',
      }} />

      {/* Main content */}
      <div style={{ padding: '0 16px 14px', position: 'relative' }}>
        {/* Avatar — overlapping the banner */}
        <div style={{
          marginTop: -30, marginBottom: 8,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        }}>
          <img
            src={xUser.profileImageUrl?.replace('_normal', '_200x200') || ''}
            alt=""
            style={{
              width: 60, height: 60, borderRadius: '50%',
              border: '3px solid var(--bg-card)', background: '#f0f0f3',
              display: 'block', objectFit: 'cover',
            }}
          />
          {/* Node code badge */}
          {nodeCode && (
            <div style={{
              padding: '3px 10px', borderRadius: 20,
              background: 'rgba(255,87,34,0.08)', border: '1px solid rgba(255,87,34,0.2)',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
              color: '#ff5722', letterSpacing: 1,
            }}>
              {nodeCode}
            </div>
          )}
        </div>

        {/* Name + verification */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
            {xUser.displayName}
          </span>
          {xUser.isVerified && (
            <img
              src={chrome.runtime.getURL('icons/verified.png')}
              alt="Verified"
              style={{ width: 18, height: 18, flexShrink: 0 }}
            />
          )}
        </div>

        {/* @handle */}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 1 }}>
          @{xUser.screenName}
        </div>

        {/* Bio */}
        {xUser.bio && (
          <div style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 10, lineHeight: 1.45, wordBreak: 'break-word' }}>
            {xUser.bio}
          </div>
        )}

        {/* Location + join date */}
        {(xUser.location || xUser.joinedAt) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            {xUser.location && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#536471">
                  <path d="M12 7c-1.93 0-3.5 1.57-3.5 3.5S10.07 14 12 14s3.5-1.57 3.5-3.5S13.93 7 12 7zm0 5c-.83 0-1.5-.67-1.5-1.5S11.17 9 12 9s1.5.67 1.5 1.5S12.83 12 12 12zm0-10c-4.97 0-9 4.03-9 9 0 4.17 2.77 7.7 6.58 8.85L12 22l2.42-2.15C18.23 18.7 21 15.17 21 11c0-4.97-4.03-9-9-9z" />
                </svg>
                {xUser.location}
              </span>
            )}
            {xUser.joinedAt && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#536471">
                  <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6z" />
                </svg>
                {(() => {
                  try {
                    const d = new Date(xUser.joinedAt!)
                    return `Joined ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
                  } catch { return '' }
                })()}
              </span>
            )}
          </div>
        )}

        {/* Following / Followers — Twitter original layout */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <span style={{ fontSize: 14 }}>
            <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatCount(xUser.followingCount)}</strong>
            <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>Following</span>
          </span>
          <span style={{ fontSize: 14 }}>
            <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatCount(xUser.followersCount)}</strong>
            <span style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>Followers</span>
          </span>
        </div>

        {/* Posts / Likes / Media — stats bar */}
        <div style={{
          display: 'flex', gap: 0, marginTop: 12, fontSize: 12,
          borderTop: '1px solid var(--border-light)', paddingTop: 10,
        }}>
          {[
            { label: 'Posts', value: xUser.statusesCount },
            { label: 'Likes', value: xUser.likesCount },
            { label: 'Media', value: xUser.mediaCount },
          ].filter(item => item.value !== undefined).map((item, i) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center',
              borderRight: i < 2 ? '1px solid #f0f0f3' : 'none',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>
                {formatCount(item.value)}
              </div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
