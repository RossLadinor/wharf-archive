import { useState } from 'react'
import { formatSpeed } from '../utils/format'

export default function TopBar({ search, onSearch, onUpload, uploadMinimized, authStatus, onAuthChange, syncProgress, onOpenSettings, onOpenDriveLibrary, tags, onSelectTag }) {
  const [showAuth, setShowAuth] = useState(false)
  const [credsJson, setCredsJson] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [exportedPack, setExportedPack] = useState(null)   // string | null
  const [exportErr, setExportErr] = useState('')
  const [copied, setCopied] = useState(false)

  const handleLogin = async () => {
    setAuthLoading(true)
    setAuthError('')
    try {
      await window.api.login()
      await onAuthChange()
      setShowAuth(false)
    } catch (e) {
      setAuthError(e.message)
    }
    setAuthLoading(false)
  }

  const handleLogout = async () => {
    await window.api.logout()
    await onAuthChange()
    setExportedPack(null)
  }

  const handleSaveCreds = async () => {
    setAuthError('')
    let parsed
    try { parsed = JSON.parse(credsJson) } catch { setAuthError('Invalid JSON.'); return }
    const res = await window.api.saveCredentials(credsJson)
    if (res.success) {
      await onAuthChange()
      // Access pack already contains a token → close immediately (already authenticated)
      if (parsed.credentials && parsed.tokens) setShowAuth(false)
    } else {
      setAuthError(res.error)
    }
  }

  const handleExport = async () => {
    setExportErr('')
    setExportedPack(null)
    const res = await window.api.exportDriveAccessPack()
    if (res.success) {
      setExportedPack(JSON.stringify(res.pack, null, 2))
    } else {
      setExportErr(res.error)
    }
  }

  const handleCopy = () => {
    if (!exportedPack) return
    navigator.clipboard.writeText(exportedPack)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isSyncing = syncProgress && syncProgress.state !== 'synced' && syncProgress.state !== 'error'

  // Detect trailing #word in search to suggest tags
  const hashMatch = search.match(/#(\w+)$/)
  const hashQuery = hashMatch ? hashMatch[1].toLowerCase() : null
  const searchTagSuggestions = hashQuery
    ? (tags || []).filter(t => t.name.includes(hashQuery)).slice(0, 10)
    : []

  const applySearchTag = (tagName) => {
    onSearch(search.replace(/#\w+$/, '').trim())
    onSelectTag?.(tagName)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <div className="topbar__logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#0078ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17l10 5 10-5" stroke="#0078ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12l10 5 10-5" stroke="#0078ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
            </svg>
            <span>Wharf Archive</span>
          </div>
        </div>

        <div className="topbar__search-wrap">
          <div className="topbar__search">
            <svg className="topbar__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search assets… or type #tag"
              value={search}
              onChange={e => onSearch(e.target.value)}
            />
            {search && (
              <button className="topbar__search-clear" onClick={() => onSearch('')}>✕</button>
            )}
          </div>
          {searchTagSuggestions.length > 0 && (
            <div className="search-tag-suggestions">
              {searchTagSuggestions.map(t => (
                <button key={t.name} className="tag-suggestion" onClick={() => applySearchTag(t.name)}>
                  #{t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="topbar__actions">
          {isSyncing && (
            <div className="sync-toast">
              <div className="sync-toast__spinner" />
              <span>{syncProgress.step}</span>
              {!!syncProgress.speedBps && (
                <span className="sync-toast__speed">{formatSpeed(syncProgress.speedBps)}</span>
              )}
              {syncProgress.total > 1 && Number.isFinite(syncProgress.index) && (
                <span className="sync-toast__count">{syncProgress.index + 1}/{syncProgress.total}</span>
              )}
              <button
                className="sync-toast__cancel"
                onClick={() => window.api.cancelSync()}
                title="Cancel"
              >✕</button>
            </div>
          )}

          <button
            className="btn btn--icon"
            onClick={onOpenDriveLibrary}
            title="Drive Library — import or refresh cloud assets"
            style={{ position: 'relative' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
            </svg>
          </button>

          <button
            className="btn btn--primary"
            onClick={onUpload}
            title={uploadMinimized ? 'Resume your minimized draft' : 'Add a new asset'}
            style={{ position: 'relative' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {uploadMinimized ? 'Resume Asset' : 'Add Asset'}
            {uploadMinimized && <span className="btn__dot btn__dot--white" />}
          </button>

          <button
            className={`btn btn--icon ${authStatus?.isAuthenticated ? 'btn--icon-active' : ''}`}
            onClick={() => setShowAuth(true)}
            title={authStatus?.isAuthenticated ? 'Disconnect Google Drive' : 'Connect Google Drive'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {authStatus?.isAuthenticated && (
              <span className="btn__dot btn__dot--green" />
            )}
          </button>

          <button
            className="btn btn--icon"
            onClick={onOpenSettings}
            title="Settings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {showAuth && (
        <div className="modal-overlay" onClick={() => { setShowAuth(false); setExportedPack(null); setExportErr('') }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Google Drive</h2>
              <button className="modal__close" onClick={() => { setShowAuth(false); setExportedPack(null); setExportErr('') }}>✕</button>
            </div>
            <div className="modal__body">

              {/* ── Already authenticated ── */}
              {authStatus?.isAuthenticated ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3dba6e', display: 'inline-block' }} />
                    <span className="text-muted" style={{ fontSize: 13 }}>Connected to Google Drive</span>
                  </div>

                  <div className="settings-block__label" style={{ marginBottom: 8 }}>Connection problems?</div>
                  <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
                    If sync fails with an error like <strong>invalid_grant</strong>, your Google sign-in
                    has expired. Reconnect to sign in again — your credentials and library stay untouched.
                  </p>
                  {authError && <p className="auth-error">{authError}</p>}
                  <button className="btn btn--primary btn--sm" style={{ marginBottom: 24 }} onClick={handleLogin} disabled={authLoading}>
                    {authLoading ? 'Opening browser…' : 'Reconnect Google Account'}
                  </button>

                  <div className="settings-block__label" style={{ marginBottom: 8 }}>Share library access with a friend</div>
                  <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
                    Export an <strong>Access Pack</strong> — a single JSON your friend pastes here instead of signing in.
                    The app will use your Google Drive account to read and write all library files.
                    Your friend never touches their own Drive storage.
                  </p>

                  {!exportedPack ? (
                    <>
                      {exportErr && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{exportErr}</p>}
                      <button className="btn btn--primary btn--sm" onClick={handleExport}>
                        Generate Access Pack
                      </button>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: 12, color: '#3dba6e', marginBottom: 8 }}>
                        ✓ Send this JSON to your friend. They paste it in the "Connect Google Drive" dialog.
                      </p>
                      <textarea
                        className="input input--textarea input--mono"
                        readOnly
                        value={exportedPack}
                        rows={6}
                        style={{ fontSize: 11 }}
                        onClick={e => e.target.select()}
                      />
                      <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={handleCopy}>
                        {copied ? '✓ Copied!' : 'Copy to clipboard'}
                      </button>
                    </>
                  )}

                  <div className="modal__footer" style={{ marginTop: 24 }}>
                    <button className="btn btn--ghost" onClick={handleLogout}>Disconnect Drive</button>
                    <button className="btn btn--primary" onClick={() => { setShowAuth(false); setExportedPack(null) }}>Done</button>
                  </div>
                </>
              ) : !authStatus?.hasCredentials ? (
                /* ── No credentials yet ── */
                <>
                  <p className="text-muted" style={{ marginBottom: 12, fontSize: 13 }}>
                    Paste a <strong>credentials.json</strong> (your own Google Cloud project)
                    or an <strong>Access Pack</strong> shared by the library owner:
                  </p>
                  <details style={{ marginBottom: 14 }}>
                    <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                      Setting up your own credentials (owner)
                    </summary>
                    <ol className="auth-steps" style={{ marginTop: 8 }}>
                      <li>Go to <strong>console.cloud.google.com</strong></li>
                      <li>Create a project → Enable <strong>Google Drive API</strong></li>
                      <li>Credentials → <strong>OAuth 2.0 Desktop App</strong> → Download JSON</li>
                      <li>Paste below, then sign in. Afterwards use <strong>Generate Access Pack</strong> to share with friends.</li>
                    </ol>
                  </details>
                  <textarea
                    className="input input--textarea input--mono"
                    placeholder={'Paste credentials.json  OR  an Access Pack from the library owner…'}
                    value={credsJson}
                    onChange={e => { setCredsJson(e.target.value); setAuthError('') }}
                    rows={7}
                  />
                  {authError && <p className="auth-error">{authError}</p>}
                  <div className="modal__footer">
                    <button className="btn btn--ghost" onClick={() => setShowAuth(false)}>Cancel</button>
                    <button className="btn btn--primary" onClick={handleSaveCreds} disabled={!credsJson.trim()}>
                      Save & Continue
                    </button>
                  </div>
                </>
              ) : (
                /* ── Has credentials, needs OAuth sign-in ── */
                <>
                  <p className="text-muted" style={{ marginBottom: 24, fontSize: 13 }}>
                    Credentials loaded. Click below to open your browser and sign in with Google.
                    The app only requests access to files it creates — nothing else.
                  </p>
                  {authError && <p className="auth-error">{authError}</p>}
                  <div className="modal__footer">
                    <button className="btn btn--ghost" onClick={() => setShowAuth(false)}>Cancel</button>
                    <button className="btn btn--primary" onClick={handleLogin} disabled={authLoading}>
                      {authLoading ? 'Opening browser…' : 'Sign in with Google'}
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  )
}
