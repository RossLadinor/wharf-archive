import { useState, useEffect, useCallback } from 'react'
import CategoryIcon, { PICKER_ICONS, ICON_LABELS } from './CategoryIcons'

const PRESET_CATEGORIES = [
  'Characters', 'Environments', 'Props', 'Materials',
  'HDRIs', 'VFX', 'Rigs', 'Scenes', 'Other'
]

// Built-in software list. Users can add more via the Custom… option, which
// persists into the database and surfaces in the dropdown on subsequent runs.
const PRESET_APPLICATIONS = [
  'Blender', 'Maya', '3ds Max', 'ZBrush', 'Cinema 4D',
  'Houdini', 'Unity', 'Unreal', 'Substance Painter', 'Photoshop'
]

function getFileType(p) {
  const ext = p.split('.').pop().toLowerCase()
  if (ext === 'blend') return 'blend'
  if (['fbx', 'obj', 'glb', 'gltf', 'abc'].includes(ext)) return 'mesh'
  if (['png', 'jpg', 'jpeg', 'tga', 'bmp'].includes(ext)) return 'texture'
  if (['hdr', 'exr'].includes(ext)) return 'hdr'
  return 'file'
}

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PreviewImage({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { window.api.previewUrl(path).then(setUrl) }, [path])
  return url ? <img src={url} alt="preview" className="preview-img" /> : null
}

export default function UploadDialog({ categories, applications = [], initialFiles = null, minimized = false, onComplete, onCancel, onMinimize }) {
  const [files, setFiles] = useState([])
  const [previewPath, setPreviewPath] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [customIcon, setCustomIcon] = useState('cube')
  const [application, setApplication] = useState('Blender')
  const [customApplication, setCustomApplication] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState([])
  const [blenderVersion, setBlenderVersion] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewDragOver, setPreviewDragOver] = useState(false)
  const [allTags, setAllTags] = useState([])

  useEffect(() => {
    window.api.getTags().then(t => setAllTags(t.map(x => x.name)))
  }, [])

  // Suggestions: match against the last comma-segment being typed
  const lastSegment = tagInput.split(',').pop().trim().toLowerCase()
  const suggestions = lastSegment.length > 0
    ? allTags.filter(t => t.includes(lastSegment) && !tags.includes(t)).slice(0, 6)
    : []

  const applySuggestion = (tag) => {
    setTags(prev => [...new Set([...prev, tag])])
    // Clear the last typed segment, keep any preceding comma-separated values
    const parts = tagInput.split(',')
    parts[parts.length - 1] = ''
    const prefix = parts.join(',').replace(/,\s*$/, '')
    setTagInput(prefix ? prefix + ', ' : '')
  }

  const allCategories = [...new Set([...PRESET_CATEGORIES, ...categories])].sort()
  const effectiveCategory = category === '__custom__' ? customCategory : category
  const allApplications = [...new Set([...PRESET_APPLICATIONS, ...applications])].sort()
  const effectiveApplication = application === '__custom__' ? customApplication.trim() : application

  // Add every dropped/picked path to the files list as-is. Images don't
  // get hijacked into the preview slot any more — the user explicitly
  // sets the preview via Browse / Paste / drop on the preview zone.
  const addFiles = async (paths) => {
    if (!paths.length) return
    const newFiles = await Promise.all(paths.map(async p => {
      const info = await window.api.getFileInfo(p)
      return { local_path: p, file_name: info.name, file_size: info.size, file_type: getFileType(p) }
    }))
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.local_path))
      const added = newFiles.filter(f => !existing.has(f.local_path))
      if (!name && added[0]) setName(added[0].file_name.replace(/\.[^.]+$/, ''))
      return [...prev, ...added]
    })
  }

  // Files dropped on the app window before this dialog existed (global
  // drag & drop). Attach once on mount — the dialog is freshly mounted for
  // every window-level drop, never reused.
  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSelectFiles = async () => {
    const paths = await window.api.openDialog({
      multi: true,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (paths) await addFiles(paths)
  }

  const handleSelectPreview = async () => {
    const paths = await window.api.openPreviewDialog()
    if (paths?.[0]) setPreviewPath(paths[0])
  }

  const handlePastePreview = useCallback(async () => {
    const tmpPath = await window.api.clipboardImage()
    if (tmpPath) setPreviewPath(tmpPath)
    else alert('No image found in clipboard.\nCopy an image first, then paste.')
  }, [])

  // Ctrl+V pastes clipboard image when focus is not in a text field
  useEffect(() => {
    const handler = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        const tmpPath = await window.api.clipboardImage()
        if (tmpPath) setPreviewPath(tmpPath)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map(f => f.path)
    if (paths.length) await addFiles(paths)
  }

  // Drop on the preview zone sets the preview image. Only accepts images,
  // and only the first one if multiple were dropped — the preview is a
  // single slot.
  const handlePreviewDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setPreviewDragOver(false)
    const imageExts = ['png', 'jpg', 'jpeg', 'webp']
    const file = Array.from(e.dataTransfer.files).find(f =>
      imageExts.includes(f.path.split('.').pop().toLowerCase())
    )
    if (file) setPreviewPath(file.path)
  }

  const addTag = () => {
    const next = tagInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    setTags(prev => [...new Set([...prev, ...next])])
    setTagInput('')
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
    if (e.key === 'Tab' && suggestions.length > 0) { e.preventDefault(); applySuggestion(suggestions[0]) }
    if (e.key === 'Escape') { setTagInput('') }
  }

  const handleSave = async (andSync) => {
    if (!name.trim()) return alert('Asset name is required.')
    if (!files.length) return alert('Add at least one file.')
    if (application === '__custom__' && !customApplication.trim()) {
      return alert('Custom application name is required.')
    }
    setSaving(true)
    try {
      const id = await window.api.addAsset({
        asset: {
          name: name.trim(),
          description,
          category: effectiveCategory,
          application: effectiveApplication || 'Blender',
          blender_version: blenderVersion,
          poly_count: 0
        },
        tags,
        files,
        previewSrc: previewPath
      })
      // If user picked a custom category + icon, persist the icon mapping
      if (category === '__custom__' && customCategory.trim() && customIcon) {
        try { await window.api.setCategoryIcon(customCategory.trim(), customIcon) } catch {}
      }
      if (andSync) {
        const result = await window.api.pushAsset(id)
        if (!result.success) alert('Saved locally but upload failed: ' + result.error)
      }
      onComplete()
    } catch (e) {
      alert('Error: ' + e.message)
      setSaving(false)
    }
  }

  // Backdrop click should preserve work-in-progress — minimize, not close.
  // The explicit ✕ and the Cancel button still discard.
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onMinimize?.()
  }

  return (
    <div
      className="modal-overlay"
      onClick={handleBackdrop}
      // Hide the entire overlay while minimized but keep the component
      // mounted so React preserves every state field the user has filled in.
      style={minimized ? { display: 'none' } : undefined}
    >
      <div className="modal modal--upload" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Add Asset</h2>
          <div className="modal__header-actions">
            <button
              className="modal__minimize"
              onClick={onMinimize}
              title="Minimize — keep your draft and reopen via Add Asset"
              aria-label="Minimize"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round">
                <line x1="5" y1="19" x2="19" y2="19"/>
              </svg>
            </button>
            <button className="modal__close" onClick={onCancel} title="Discard and close">✕</button>
          </div>
        </div>

        <div className="upload-layout">
          {/* ── Left column: files & preview ── */}
          <div className="upload-left">
            <div
              className={`drop-zone ${dragOver ? 'drop-zone--over' : ''} ${files.length ? 'drop-zone--filled' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {files.length === 0 ? (
                <div className="drop-zone__empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Drop any files here</span>
                  <span className="text-muted">or use the button below</span>
                </div>
              ) : (
                <ul className="file-list">
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

            <button className="btn btn--ghost btn--full" onClick={handleSelectFiles}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Files
            </button>

            <div
              className={`preview-zone${previewDragOver ? ' preview-zone--over' : ''}`}
              onClick={!previewPath ? handleSelectPreview : undefined}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setPreviewDragOver(true) }}
              onDragLeave={e => { e.stopPropagation(); setPreviewDragOver(false) }}
              onDrop={handlePreviewDrop}
              title={previewPath ? 'Drop an image here to replace the preview' : 'Click or drop an image to set the preview'}
              style={{ cursor: previewPath ? 'default' : 'pointer', position: 'relative' }}>
              {previewPath
                ? <>
                    <PreviewImage path={previewPath} />
                    <button
                      className="preview-zone__clear"
                      title="Remove preview"
                      onClick={e => { e.stopPropagation(); setPreviewPath(null) }}
                    >✕</button>
                  </>
                : (
                  <div className="preview-zone__empty">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>Click to select preview</span>
                  </div>
                )
              }
            </div>
            <button
              className="btn btn--ghost btn--full"
              style={{ marginTop: 4 }}
              onClick={e => { e.stopPropagation(); handlePastePreview() }}
              title="Paste image from clipboard (Ctrl+V)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
              Paste Preview
            </button>
          </div>

          {/* ── Right column: metadata ── */}
          <div className="upload-right">
            <div className="form-group">
              <label className="form-label">Asset Name *</label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Medieval Shield"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">— Select category —</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {category === '__custom__' && (
                <>
                  <input
                    className="input"
                    style={{ marginTop: 6 }}
                    placeholder="e.g. Weapons"
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value)}
                  />
                  <div className="icon-picker-label">Icon for this category</div>
                  <div className="icon-picker">
                    {PICKER_ICONS.map(key => (
                      <button
                        key={key}
                        type="button"
                        className={`icon-picker__item${customIcon === key ? ' icon-picker__item--active' : ''}`}
                        onClick={() => setCustomIcon(key)}
                        title={ICON_LABELS[key] || key}
                      >
                        <CategoryIcon iconKey={key} size={16} />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Application</label>
              <select className="input" value={application} onChange={e => setApplication(e.target.value)}>
                {allApplications.map(a => <option key={a} value={a}>{a}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {application === '__custom__' && (
                <input
                  className="input"
                  style={{ marginTop: 6 }}
                  placeholder="e.g. Krita"
                  value={customApplication}
                  onChange={e => setCustomApplication(e.target.value)}
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="input input--textarea"
                placeholder="PBR textures included? Polycount? Rigged? Any notes..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
              />
              <div className="md-hint">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                </svg>
                Markdown supported — **bold**, *italic*, `code`, ## headings, - lists
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Tags</label>
              <div className="tag-input-row">
                <input
                  className="input"
                  placeholder="pbr, lowpoly, rigged (comma-separated)"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  autoComplete="off"
                />
                <button className="btn btn--ghost" onClick={addTag}>Add</button>
              </div>
              <div className="tag-suggestions">
                {suggestions.map(t => (
                  <button key={t} className="tag-suggestion" onClick={() => applySuggestion(t)}>
                    #{t}
                  </button>
                ))}
              </div>
              {tags.length > 0 && (
                <div className="tag-chips">
                  {tags.map(t => (
                    <span key={t} className="tag-chip">
                      #{t}
                      <button onClick={() => setTags(p => p.filter(x => x !== t))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Software Version</label>
              <input
                className="input"
                placeholder="e.g. 4.2"
                value={blenderVersion}
                onChange={e => setBlenderVersion(e.target.value)}
              />
            </div>

            <div className="upload-actions">
              <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
              <button className="btn btn--ghost" onClick={() => handleSave(false)} disabled={saving}>
                Save Locally
              </button>
              <button className="btn btn--primary" onClick={() => handleSave(true)} disabled={saving}>
                {saving ? 'Saving…' : 'Save + Upload to Drive'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
