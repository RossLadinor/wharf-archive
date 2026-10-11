import { useState, useEffect } from 'react'

export default function DriveLibraryModal({ onClose, onImported }) {
  const [phase, setPhase]       = useState('idle')   // idle | running | done | error
  const [progress, setProgress] = useState(null)
  const [result, setResult]     = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  // 'refresh' is the only remaining action; kept as a string for future flexibility
  const [activeAction, setActiveAction] = useState('')

  useEffect(() => {
    const unsub = window.api.onImportProgress((p) => setProgress(p))
    return unsub
  }, [])

  const run = async (action) => {
    setActiveAction(action)
    setPhase('running')
    setProgress({ step: 'Connecting to Drive…', current: 0, total: 0 })
    setResult(null)

    const res = await window.api.refreshDriveLibrary()

    if (res.success) {
      setPhase('done')
      setResult(res)
      onImported()
    } else {
      setPhase('error')
      setResult(res)
    }
  }

  // Expired/revoked Google sign-in — a plain retry can never succeed, only a re-auth can
  const isAuthError = /invalid_grant|invalid_credentials|unauthorized|not authenticated/i.test(result?.error || '')

  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      await window.api.login()
      setReconnecting(false)
      run(activeAction)
    } catch (e) {
      setReconnecting(false)
      setResult({ error: e.message })
    }
  }

  const pct = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : null
  const canClose = phase === 'idle' || phase === 'done' || phase === 'error'

  return (
    <div className="modal-overlay" onClick={canClose ? onClose : undefined}>
      <div className="modal modal--drive-library" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17l10 5 10-5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
            </svg>
            <h2>Drive Library</h2>
          </div>
          <button className="modal__close" onClick={onClose} disabled={!canClose}>✕</button>
        </div>

        <div className="modal__body drive-library-body">
          {phase === 'idle' && (
            <>
              <div className="drive-library-options">
                <div className="drive-library-card" onClick={() => run('refresh')}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                  </svg>
                  <div>
                    <div className="drive-library-card__title">Sync from Drive</div>
                    <div className="drive-library-card__sub">
                      Pull the latest manifest — adds new cloud assets, updates metadata,
                      and flags assets that were deleted on Drive. Files are not downloaded
                      automatically — choose what to fetch from each card.
                    </div>
                  </div>
                </div>
              </div>

              <div className="drive-library-info">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                Assets imported from Drive show a <strong>Cloud</strong> badge.
                Hover a card and click <strong>Download</strong> to fetch files locally.
              </div>
            </>
          )}

          {phase === 'running' && (
            <div className="drive-library-progress">
              <div className="drive-library-progress__label">Syncing from Drive…</div>
              {progress && (
                <>
                  <div className="drive-library-progress__step">{progress.step}</div>
                  {pct !== null && (
                    <div className="drive-library-progress__bar-wrap">
                      <div className="drive-library-progress__bar" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {progress.total > 0 && (
                    <div className="drive-library-progress__count">
                      {progress.current} / {progress.total}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {phase === 'done' && result && (
            <div className="drive-library-result">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3dba6e" strokeWidth="1.5">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <div className="drive-library-result__title">Library synced</div>
              <div className="drive-library-result__stats">
                {result.inserted > 0 && (
                  <span>{result.inserted} new asset{result.inserted !== 1 ? 's' : ''}</span>
                )}
                {result.updated > 0 && (
                  <span>{result.updated} updated</span>
                )}
                {result.previewsDownloaded > 0 && (
                  <span>{result.previewsDownloaded} preview{result.previewsDownloaded !== 1 ? 's' : ''} downloaded</span>
                )}
                {result.orphaned > 0 && (
                  <span style={{ color: '#e0a020' }}>
                    ⚠ {result.orphaned} asset{result.orphaned !== 1 ? 's' : ''} no longer on Drive
                  </span>
                )}
                {result.total === 0 && (
                  <span>No assets in Drive library yet</span>
                )}
              </div>
              <button className="btn btn--primary" style={{ marginTop: 20 }} onClick={onClose}>
                Done
              </button>
            </div>
          )}

          {phase === 'error' && result && (
            <div className="drive-library-result drive-library-result--error">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#e05c5c" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <div className="drive-library-result__title">Failed</div>
              <div className="drive-library-result__error">{result.error}</div>
              {isAuthError && (
                <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 10, maxWidth: 340 }}>
                  Your Google sign-in has expired or been revoked.
                  Reconnect to sign in again — your library is untouched.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button className="btn btn--ghost" onClick={() => setPhase('idle')}>Back</button>
                {isAuthError ? (
                  <>
                    <button className="btn btn--ghost" onClick={() => run(activeAction)}>Retry</button>
                    <button className="btn btn--primary" onClick={handleReconnect} disabled={reconnecting}>
                      {reconnecting ? 'Opening browser…' : 'Reconnect Google Account'}
                    </button>
                  </>
                ) : (
                  <button className="btn btn--primary" onClick={() => run(activeAction)}>Retry</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
