import { useState, useEffect } from 'react'

function shortPath(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.length > 4 ? '…/' + parts.slice(-3).join('/') : p.replace(/\\/g, '/')
}

export default function Settings({ onClose, onLibraryChanged }) {
  const [cfg, setCfg]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)   // { type: 'success'|'error', msg }

  useEffect(() => { window.api.getConfig().then(setCfg) }, [])

  const flash = (msg, type = 'success') => {
    setStatus({ type, msg })
    if (type === 'success') setTimeout(() => setStatus(null), 4000)
  }

  const handleSetLibrary = async () => {
    const folder = await window.api.selectFolder({ title: 'Select or Create Library Folder' })
    if (!folder) return
    setLoading(true)
    setStatus(null)
    const result = await window.api.setLibraryPath(folder)
    setLoading(false)
    if (result.success) {
      setCfg(prev => ({ ...prev, libraryPath: folder, dbPath: folder + '/library.db', isDefault: false }))
      flash(`Switched to "${shortPath(folder)}" — ${result.assetCount} asset${result.assetCount !== 1 ? 's' : ''} found.`)
      onLibraryChanged()
    } else {
      flash(result.error, 'error')
    }
  }

  const handleImport = async () => {
    const folder = await window.api.selectFolder({ title: 'Select Existing Library Folder' })
    if (!folder) return
    setLoading(true)
    setStatus(null)
    const result = await window.api.importLibrary(folder)
    setLoading(false)
    if (result.success) {
      setCfg(prev => ({ ...prev, libraryPath: folder, dbPath: folder + '/library.db', isDefault: false }))
      flash(`Imported "${shortPath(folder)}" — ${result.assetCount} asset${result.assetCount !== 1 ? 's' : ''} loaded.`)
      onLibraryChanged()
    } else {
      flash(result.error, 'error')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--settings" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal__header">
          <div className="settings-header__left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
            <h2>Settings</h2>
          </div>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body settings-body">

          {/* ── Library section ── */}
          <section className="settings-block">
            <div className="settings-block__label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              Library folder
            </div>

            <div className="settings-path-row">
              <div className="settings-path-value">
                <span className={cfg?.isDefault ? 'settings-path-default' : ''}>
                  {cfg ? shortPath(cfg.libraryPath) : '…'}
                </span>
                {cfg?.isDefault && <span className="settings-badge">default</span>}
              </div>
            </div>

            <p className="settings-desc">
              All asset files are <strong>copied into this folder</strong> when you import them.
              Previews, versions, and metadata live here alongside a <code>library.db</code> index.
            </p>

            <div className="settings-block__actions">
              <button className="btn btn--primary" onClick={handleSetLibrary} disabled={loading}>
                {loading
                  ? <><div className="sync-toast__spinner" style={{ width: 10, height: 10 }} /> Switching…</>
                  : <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                      </svg>
                      Change folder
                    </>
                }
              </button>
              <button className="btn btn--ghost" onClick={handleImport} disabled={loading}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Import existing
              </button>
            </div>

            {status && (
              <div className={`settings-status settings-status--${status.type}`}>
                {status.type === 'success'
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                }
                {status.msg}
              </div>
            )}
          </section>

          {/* ── Sync preferences ── */}
          <section className="settings-block">
            <div className="settings-block__label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
              Sync preferences
            </div>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!cfg?.autoRefresh}
                onChange={async e => {
                  const next = e.target.checked
                  await window.api.setAutoRefresh(next)
                  setCfg(prev => ({ ...prev, autoRefresh: next }))
                }}
              />
              <span className="settings-toggle__label">
                <strong>Auto-refresh from Drive on launch</strong>
                <span className="text-muted">
                  When the app starts, automatically pull the latest manifest from Drive.
                  Picks up new assets and flags ones removed elsewhere. Off by default.
                </span>
              </span>
            </label>
          </section>

          {/* ── Folder structure info ── */}
          <section className="settings-block settings-block--info">
            <div className="settings-block__label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              How files are stored
            </div>
            <pre className="settings-tree">{`<library-folder>/
├── library.db             ← asset index (SQLite)
├── Characters/
│   └── <asset-id>/
│       ├── preview.jpg    ← thumbnail
│       ├── metadata.json  ← asset info
│       ├── v1/
│       │   └── warrior.blend
│       └── v2/
│           └── warrior_v2.blend
└── Props/
    └── …`}</pre>
            <p className="settings-desc" style={{ marginTop: 8 }}>
              Switching libraries is instant. The folder is self-contained — copy it anywhere to
              back up or share your archive. Google Drive folders are never deleted when you
              switch libraries locally.
            </p>
          </section>

          {/* ── About ── */}
          <section className="settings-block settings-block--about">
            <div className="settings-about">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12l10 5 10-5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
              </svg>
              <div>
                <div className="settings-about__name">Wharf Archive</div>
                <div className="settings-about__sub">Local-first Blender asset manager with Google Drive sync</div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
