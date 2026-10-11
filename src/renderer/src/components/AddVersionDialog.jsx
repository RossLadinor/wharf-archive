import { useState } from 'react'

const MAX_VERSIONS = 10

function getFileType(p) {
  const ext = p.split('.').pop().toLowerCase()
  if (ext === 'blend') return 'blend'
  if (['fbx', 'obj', 'glb', 'gltf', 'abc'].includes(ext)) return 'mesh'
  if (['hdr', 'exr'].includes(ext)) return 'hdr'
  if (['png', 'jpg', 'jpeg', 'tga', 'bmp'].includes(ext)) return 'texture'
  return 'file'
}
function formatSize(b) {
  if (!b) return '—'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function AddVersionDialog({ asset, nextVersionNum, currentVersionCount, onComplete, onCancel }) {
  const [files, setFiles]       = useState([])
  const [label, setLabel]       = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const atMax = (currentVersionCount ?? 0) >= MAX_VERSIONS

  const addFiles = async (paths) => {
    const newFiles = await Promise.all(paths.map(async p => {
      const info = await window.api.getFileInfo(p)
      return { local_path: p, file_name: info.name, file_size: info.size, file_type: getFileType(p) }
    }))
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.local_path))
      return [...prev, ...newFiles.filter(f => !existing.has(f.local_path))]
    })
  }

  const handleSelectFiles = async () => {
    const paths = await window.api.openDialog({ multi: true })
    if (paths) await addFiles(paths)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(p => {
      const ext = p.split('.').pop().toLowerCase()
      return !['png', 'jpg', 'jpeg', 'webp'].includes(ext)
    })
    if (paths.length) await addFiles(paths)
  }

  const handleSave = async (andPush) => {
    if (!files.length) { setError('Add at least one file.'); return }
    if (atMax) { setError(`Maximum ${MAX_VERSIONS} versions reached.`); return }
    setSaving(true)
    setError('')
    try {
      const result = await window.api.addVersion({
        assetId: asset.id,
        label: label.trim(),
        files
      })
      if (!result.success) {
        setError(result.error)
        setSaving(false)
        return
      }
      if (andPush) {
        const pushResult = await window.api.pushVersion(result.versionId)
        if (!pushResult.success) setError('Saved but push failed: ' + pushResult.error)
      }
      onComplete()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--addver" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2>Add Version</h2>
            <div className="modal__subtitle">{asset.name} — will become v{nextVersionNum}</div>
          </div>
          <button className="modal__close" onClick={onCancel}>✕</button>
        </div>

        <div className="modal__body">
          {atMax && (
            <p className="auth-error" style={{ marginBottom: 12 }}>
              Maximum {MAX_VERSIONS} versions reached. Delete an older version first.
            </p>
          )}

          <div
            className={`drop-zone ${dragOver ? 'drop-zone--over' : ''} ${files.length ? 'drop-zone--filled' : ''}`}
            style={{ minHeight: 110, marginBottom: 12, pointerEvents: atMax ? 'none' : undefined, opacity: atMax ? 0.4 : 1 }}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {files.length === 0 ? (
              <div className="drop-zone__empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>Drop updated files here</span>
              </div>
            ) : (
              <ul className="file-list" style={{ width: '100%', padding: '8px 4px' }}>
                {files.map((f, i) => (
                  <li key={i} className="file-item">
                    <span className="file-item__type">{f.file_type}</span>
                    <span className="file-item__name" title={f.local_path}>{f.file_name}</span>
                    <span className="file-item__size">{formatSize(f.file_size)}</span>
                    <button className="file-item__rm" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button className="btn btn--ghost btn--full" onClick={handleSelectFiles} disabled={atMax} style={{ marginBottom: 14 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Files
          </button>

          <div className="form-group">
            <label className="form-label">Version Label <span className="text-muted">(optional)</span></label>
            <input
              className="input"
              placeholder="e.g. Retopo + PBR textures, Bug fix, Final export"
              value={label}
              onChange={e => setLabel(e.target.value)}
              disabled={atMax}
            />
          </div>

          {error && <p className="auth-error">{error}</p>}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--ghost" onClick={() => handleSave(false)} disabled={saving || atMax}>
            Save Locally
          </button>
          <button className="btn btn--primary" onClick={() => handleSave(true)} disabled={saving || atMax}>
            {saving ? 'Saving…' : 'Save + Push to Drive'}
          </button>
        </div>
      </div>
    </div>
  )
}
