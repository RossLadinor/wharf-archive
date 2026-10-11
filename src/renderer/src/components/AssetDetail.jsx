import { useState, useEffect, useMemo } from 'react'
import { marked } from 'marked'
import AddVersionDialog from './AddVersionDialog'
import GalleryViewer from './GalleryViewer'

// Configure marked once
marked.use({ breaks: true, gfm: true })

const MAX_VERSIONS = 10
const GALLERY_MAX = 3
const GALLERY_MAX_BYTES = 2 * 1024 * 1024

function formatSize(b) {
  if (!b) return '—'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

const SYNC_LABEL = { local: 'Local', syncing: 'Syncing…', synced: 'Synced', error: 'Error' }

const isCloud = s => s === 'cloud'

export default function AssetDetail({ asset, onClose, onUpdate, onDelete, onDownload }) {
  const [previewUrl, setPreviewUrl]    = useState(null)
  const [versions, setVersions]        = useState([])
  const [editMode, setEditMode]        = useState(false)
  const [description, setDescription] = useState(asset.description || '')
  const [tagInput, setTagInput]        = useState('')
  const [tags, setTags]                = useState(asset.tags || [])
  const [newPreviewPath, setNewPreviewPath] = useState(null)
  const [label, setLabel]              = useState(asset.label || '')
  const [starred, setStarred]          = useState(!!asset.starred)
  const [showAddVersion, setShowAddVersion] = useState(false)
  const [busyIds, setBusyIds]          = useState(new Set())  // versionIds currently pushing/pulling
  const [expanded, setExpanded]        = useState({})
  const [gallery, setGallery]          = useState([])
  const [galleryBusy, setGalleryBusy]  = useState(false)
  const [galleryAction, setGalleryAction] = useState(null) // 'pushing' | 'pulling' | null
  const [showGallery, setShowGallery]  = useState(false)

  const loadGallery = () =>
    window.api.galleryList(asset.id).then(setGallery)

  // Compute the same five-state sync vocabulary used by versions, derived
  // from local_path / drive_file_id presence + the in-flight `galleryAction`.
  const galleryItemState = (item) => {
    if (galleryAction === 'pushing' && item.local_path && !item.drive_file_id) return 'syncing'
    if (galleryAction === 'pulling' && item.drive_file_id && !item.local_path) return 'syncing'
    if (item.local_path && item.drive_file_id) return 'synced'
    if (item.local_path) return 'local'
    if (item.drive_file_id) return 'cloud'
    return 'local'
  }
  const galleryHasLocalOnly = gallery.some(g => g.local_path && !g.drive_file_id)
  const galleryHasCloudOnly = gallery.some(g => g.drive_file_id && !g.local_path)

  const loadVersions = () =>
    window.api.getVersionsByAsset(asset.id).then(setVersions)

  // Keep edit-state fields fresh whenever the asset prop is updated by the parent.
  useEffect(() => {
    setDescription(asset.description || '')
    setTags(asset.tags || [])
    setLabel(asset.label || '')
    setStarred(!!asset.starred)
  }, [asset.id, asset.description, asset.tags, asset.label, asset.starred])

  useEffect(() => {
    window.api.previewUrl(asset.preview_path).then(setPreviewUrl)
    loadVersions()
    loadGallery()
  }, [asset.id, asset.preview_path])

  useEffect(() => {
    const unsub = window.api.onSyncProgress((data) => {
      if (data.state === 'synced' || data.state === 'error') loadVersions()
    })
    return unsub
  }, [])

  const setBusy = (id, val) =>
    setBusyIds(prev => { const s = new Set(prev); val ? s.add(id) : s.delete(id); return s })

  const handlePushVersion = async (versionId) => {
    setBusy(versionId, true)
    const result = await window.api.pushVersion(versionId)
    setBusy(versionId, false)
    if (!result.success && !result.cancelled) alert('Upload failed: ' + result.error)
    await loadVersions()
    onUpdate()
  }

  const handlePullVersion = async (versionId) => {
    setBusy(versionId, true)
    const result = await window.api.pullVersion(versionId)
    setBusy(versionId, false)
    if (!result.success && !result.cancelled) alert('Download failed: ' + result.error)
    await loadVersions()
    onUpdate()
  }

  const handlePushAll = async () => {
    const result = await window.api.pushAsset(asset.id)
    if (!result.success && !result.cancelled) alert('Upload failed: ' + result.error)
    await loadVersions()
    onUpdate()
  }

  const handlePullAll = async () => {
    const result = await window.api.pullAsset(asset.id)
    if (!result.success && !result.cancelled) alert('Download failed: ' + result.error)
    await loadVersions()
    onUpdate()
  }

  const handleDeleteVersion = async (versionId) => {
    const v = versions.find(x => x.id === versionId)
    const label = v ? `v${v.version_num}${v.label ? ' - ' + v.label : ''}` : 'this version'
    if (!confirm(`Delete ${label} locally?\n\nLocal files are removed. Drive files are not deleted.`)) return
    const result = await window.api.deleteVersion(versionId)
    if (!result.success) { alert(result.error); return }
    await loadVersions()
    onUpdate()
  }

  const handlePastePreview = async () => {
    const tmpPath = await window.api.clipboardImage()
    if (tmpPath) {
      setNewPreviewPath(tmpPath)
      const url = await window.api.previewUrl(tmpPath)
      setPreviewUrl(url)
    } else {
      alert('No image found in clipboard.\nCopy an image first, then paste.')
    }
  }

  // Ctrl+V pastes clipboard image when in edit mode and focus is not in a text field
  useEffect(() => {
    if (!editMode) return
    const handler = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        const tmpPath = await window.api.clipboardImage()
        if (tmpPath) {
          setNewPreviewPath(tmpPath)
          const url = await window.api.previewUrl(tmpPath)
          setPreviewUrl(url)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editMode])

  const handleStarToggle = async () => {
    const next = starred ? 0 : 1
    setStarred(!!next)
    await window.api.updateAsset({ id: asset.id, asset: { starred: next } })
    onUpdate()
  }

  const handleLabelSave = async (val) => {
    const trimmed = val.trim()
    setLabel(trimmed)
    await window.api.updateAsset({ id: asset.id, asset: { label: trimmed } })
    onUpdate()
  }

  const handleSaveEdit = async () => {
    await window.api.updateAsset({
      id: asset.id,
      asset: { description },
      tags,
      ...(newPreviewPath ? { previewSrc: newPreviewPath } : {})
    })
    setEditMode(false)
    setNewPreviewPath(null)
    await onUpdate()
  }

  const handleDeleteVersionFromDrive = async (versionId) => {
    const v = versions.find(x => x.id === versionId)
    const label = v ? `v${v.version_num}${v.label ? ' - ' + v.label : ''}` : 'this version'
    if (!confirm(
      `Delete ${label} from Google Drive?\n\nDrive files for this version are permanently deleted. Your local files are kept.`
    )) return
    setBusy(versionId, true)
    const result = await window.api.deleteVersionFromDrive(versionId)
    setBusy(versionId, false)
    if (!result.success) { alert('Failed: ' + result.error); return }
    await loadVersions()
    onUpdate()
  }

  const handleDeleteFromDrive = async () => {
    if (!confirm(
      `Delete "${asset.name}" from Google Drive?\n\nAll Drive files for this asset are permanently deleted. Your local files are kept.`
    )) return
    const result = await window.api.deleteFromDrive(asset.id)
    if (!result.success) { alert('Failed: ' + result.error); return }
    await loadVersions()
    await onUpdate()
  }

  // ── Gallery ────────────────────────────────────────────────────────────────
  // Shared add path used by both the file picker and the clipboard-paste
  // button. Both produce the same { path, size, oversize } shape.
  const addGalleryFromPicked = async (picked) => {
    if (!picked) return
    if (picked.oversize) {
      alert(`That image is ${(picked.size / 1024 / 1024).toFixed(2)} MB. Gallery images must be 2 MB or smaller.`)
      return
    }
    setGalleryBusy(true)
    try {
      const result = await window.api.galleryAdd(asset.id, picked.path)
      if (!result.success) alert('Failed to add gallery image: ' + result.error)
      await loadGallery()
      onUpdate()
    } finally {
      setGalleryBusy(false)
    }
  }

  const handleAddGalleryImage = async () => {
    if (gallery.length >= GALLERY_MAX) return
    const picked = await window.api.galleryPickImage()
    await addGalleryFromPicked(picked)
  }

  const handlePasteGalleryImage = async () => {
    if (gallery.length >= GALLERY_MAX) return
    const picked = await window.api.galleryPasteFromClipboard()
    if (!picked) {
      alert('No image found in clipboard.\nCopy an image first, then paste.')
      return
    }
    await addGalleryFromPicked(picked)
  }

  const handleUploadGallery = async () => {
    if (!galleryHasLocalOnly) return
    setGalleryBusy(true)
    setGalleryAction('pushing')
    try {
      const result = await window.api.galleryPushPending(asset.id)
      if (!result.success) {
        const detail = result.error
          || (result.errors?.length ? result.errors.map(e => `slot ${e.slot}: ${e.error}`).join('\n') : 'Unknown error')
        alert('Upload failed:\n' + detail)
      }
      await loadGallery()
      onUpdate()
    } finally {
      setGalleryBusy(false)
      setGalleryAction(null)
    }
  }

  const handleDownloadGallery = async () => {
    if (!galleryHasCloudOnly) return
    setGalleryBusy(true)
    setGalleryAction('pulling')
    try {
      const result = await window.api.galleryPullMissing(asset.id)
      if (!result.success) alert('Download failed: ' + result.error)
      await loadGallery()
      onUpdate()
    } finally {
      setGalleryBusy(false)
      setGalleryAction(null)
    }
  }

  const handleRemoveGalleryImage = async (galleryId) => {
    const item = gallery.find(g => g.id === galleryId)
    const driveNote = item?.drive_file_id
      ? '\n\nIt will be removed locally and from Drive.'
      : ''
    if (!confirm('Remove this gallery image?' + driveNote)) return
    setGalleryBusy(true)
    try {
      const result = await window.api.galleryRemove(galleryId)
      if (!result.success) alert('Failed to remove gallery image: ' + result.error)
      await loadGallery()
      onUpdate()
    } finally {
      setGalleryBusy(false)
    }
  }

  const addTag = () => {
    const next = tagInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    setTags(prev => [...new Set([...prev, ...next])])
    setTagInput('')
  }

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const nextVersionNum = versions.length > 0 ? Math.max(...versions.map(v => v.version_num)) + 1 : 2
  const atMaxVersions  = versions.length >= MAX_VERSIONS

  // Sync icon (upload arrow ↑)
  const IconPush = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
    </svg>
  )

  // Download arrow ↓
  const IconPull = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="8 17 12 21 16 17"/>
      <line x1="12" y1="21" x2="12" y2="9"/>
      <path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/>
    </svg>
  )

  return (
    <div className="modal-overlay">
      <div className="modal modal--detail" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <button
              className={`star-btn${starred ? ' star-btn--on' : ''}`}
              onClick={handleStarToggle}
              title={starred ? 'Remove from starred' : 'Add to starred'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24"
                fill={starred ? '#f5c542' : 'none'}
                stroke={starred ? '#f5c542' : 'currentColor'}
                strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
            <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</h2>
          </div>
          <div className="modal__header-actions">
            {editMode ? (
              <>
                <button className="btn btn--primary btn--sm" onClick={handleSaveEdit}>Save</button>
                <button className="btn btn--ghost btn--sm" onClick={() => {
                  setEditMode(false); setTags(asset.tags || [])
                }}>Cancel</button>
              </>
            ) : (
              <button className="btn btn--ghost btn--sm" onClick={() => setEditMode(true)}>Edit</button>
            )}
            <button className="modal__close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="detail-layout">
          {/* ── Left: preview + meta ── */}
          <div className="detail-left">
            <div className="detail-preview">
              {previewUrl
                ? <img src={previewUrl} alt={asset.name} />
                : <div className="detail-preview--empty">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span>No preview</span>
                  </div>
              }
            </div>

            {editMode && (
              <div className="detail-preview-actions">
                <button className="btn btn--ghost btn--sm" style={{ flex: 1 }}
                  onClick={async () => {
                    const paths = await window.api.openPreviewDialog()
                    if (paths?.[0]) {
                      setNewPreviewPath(paths[0])
                      const url = await window.api.previewUrl(paths[0])
                      setPreviewUrl(url)
                    }
                  }}
                  title="Select preview image from file">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Browse
                </button>
                <button className="btn btn--ghost btn--sm" style={{ flex: 1 }}
                  onClick={handlePastePreview}
                  title="Paste preview from clipboard (Ctrl+V)">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                  Paste
                </button>
              </div>
            )}

            <div className="detail-label-wrap">
              <input
                className="detail-label-input"
                value={label}
                onChange={e => setLabel(e.target.value)}
                onBlur={e => handleLabelSave(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
                placeholder="Add a local label…"
                maxLength={80}
              />
            </div>

            <div className="detail-badges">
              {asset.category && <span className="category-badge">{asset.category}</span>}
              {(asset.application || asset.blender_version) && (
                <span className="category-badge">
                  {(asset.application || 'Blender')}{asset.blender_version ? ` ${asset.blender_version}` : ''}
                </span>
              )}
              <span className="category-badge">{versions.length}/{MAX_VERSIONS} version{versions.length !== 1 ? 's' : ''}</span>
              {asset.drive_orphaned ? (
                <span className="category-badge category-badge--orphan">⚠ Drive copy missing</span>
              ) : asset.sync_state === 'local' ? (
                <span className="category-badge category-badge--orphan">⚠ Local only — not on Drive</span>
              ) : asset.sync_state === 'synced' ? (
                <span className="category-badge category-badge--synced">✓ Synced with Drive</span>
              ) : asset.sync_state === 'cloud' ? (
                <span className="category-badge category-badge--cloud">☁ Cloud only</span>
              ) : null}
            </div>

            {isCloud(asset.sync_state) && (
              <div className="detail-cloud-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                  <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                </svg>
                <div>
                  <div className="detail-cloud-banner__title">Not downloaded yet</div>
                  <div className="detail-cloud-banner__sub">Files live on Drive. Download to use locally or push/pull versions.</div>
                </div>
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => onDownload?.(asset)}
                  style={{ marginLeft: 'auto', flexShrink: 0 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </button>
              </div>
            )}

            <div className="detail-tags">
              {(editMode ? tags : asset.tags)?.map(t => (
                <span key={t} className="tag-pill">
                  #{t}
                  {editMode && <button onClick={() => setTags(p => p.filter(x => x !== t))}>✕</button>}
                </span>
              ))}
            </div>

            {editMode && (
              <div className="tag-input-row">
                <input className="input input--sm" placeholder="Add tags…" value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                />
                <button className="btn btn--ghost btn--sm" onClick={addTag}>+</button>
              </div>
            )}

            <div className="detail-left-actions">
              {asset.drive_folder_id && (
                <button className="btn btn--danger btn--sm" style={{ width: '100%', justifyContent: 'center', marginBottom: 6 }}
                  onClick={handleDeleteFromDrive}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                    <line x1="9" y1="14" x2="15" y2="20"/><line x1="15" y1="14" x2="9" y2="20"/>
                  </svg>
                  Delete from Drive
                </button>
              )}
              <button className="btn btn--danger btn--sm" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  const msg = asset.drive_folder_id
                    ? `Delete local files for "${asset.name}"?\n\nThe Drive copy is kept and the asset stays visible in the library. You can download it again any time. To remove it from Drive too, use "Delete from Drive" first.`
                    : `Delete "${asset.name}"?\n\nThis asset isn't on Drive, so deleting it removes it from the library entirely. This cannot be undone.`
                  if (confirm(msg)) onDelete()
                }}>
                {asset.drive_folder_id ? 'Delete Local Files' : 'Delete Asset'}
              </button>
            </div>
          </div>

          {/* ── Right: description + versions ── */}
          <div className="detail-right">
            <section className="detail-section">
              <h3>Description</h3>
              {editMode ? (
                <>
                  <textarea className="input input--textarea" value={description}
                    onChange={e => setDescription(e.target.value)} rows={5} />
                  <div className="md-hint">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.5">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                    </svg>
                    Markdown supported — **bold**, *italic*, `code`, ## headings, - lists
                  </div>
                </>
              ) : description ? (
                <div
                  className="md-content"
                  onClick={e => {
                    const a = e.target.closest('a')
                    if (a && a.href) {
                      e.preventDefault()
                      window.api.openExternal(a.href)
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: marked.parse(description) }}
                />
              ) : (
                <p className="text-muted">No description added.</p>
              )}
            </section>

            <section className="detail-section">
              <div className="versions-header">
                <h3>Gallery ({gallery.length}/{GALLERY_MAX})</h3>
                <div className="versions-header-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={handleUploadGallery}
                    disabled={galleryBusy || !galleryHasLocalOnly || !asset.drive_folder_id}
                    title={
                      !galleryHasLocalOnly
                        ? 'All gallery images are already on Drive'
                        : !asset.drive_folder_id
                        ? 'Upload the asset to Drive first'
                        : 'Upload pending gallery images to Drive'
                    }
                  >
                    <IconPush /> Upload
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={handleDownloadGallery}
                    disabled={galleryBusy || !galleryHasCloudOnly}
                    title={
                      !galleryHasCloudOnly
                        ? 'No gallery images need downloading'
                        : 'Download missing gallery images from Drive'
                    }
                  >
                    <IconPull /> Download
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setShowGallery(true)}
                    disabled={gallery.length === 0}
                    title={gallery.length === 0 ? 'No gallery images yet' : 'Open gallery viewer'}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    View
                  </button>
                  {editMode && (
                    <>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={handlePasteGalleryImage}
                        disabled={galleryBusy || gallery.length >= GALLERY_MAX}
                        title={gallery.length >= GALLERY_MAX ? `Max ${GALLERY_MAX} images` : 'Paste image from clipboard (≤ 2 MB)'}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
                          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                        </svg>
                        Paste
                      </button>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={handleAddGalleryImage}
                        disabled={galleryBusy || gallery.length >= GALLERY_MAX}
                        title={gallery.length >= GALLERY_MAX ? `Max ${GALLERY_MAX} images` : 'Add image from file (≤ 2 MB)'}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add Image
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="gallery-slots">
                {Array.from({ length: GALLERY_MAX }).map((_, i) => {
                  const item = gallery.find(g => g.slot === i + 1)
                  if (item) {
                    return (
                      <GallerySlot
                        key={i}
                        item={item}
                        syncState={galleryItemState(item)}
                        editMode={editMode}
                        busy={galleryBusy}
                        onRemove={() => handleRemoveGalleryImage(item.id)}
                        onClick={() => setShowGallery(true)}
                      />
                    )
                  }
                  return (
                    <div key={i} className="gallery-slot gallery-slot--empty">
                      <span className="gallery-slot__hint">Slot {i + 1}</span>
                    </div>
                  )
                })}
              </div>

              {editMode && (
                <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Up to 3 reference images, ≤ 2 MB each. Stored locally for instant preview;
                  uploaded to Drive when the asset is{asset.drive_folder_id ? ' synced (immediately).' : ' next pushed.'}
                </p>
              )}
            </section>

            <section className="detail-section detail-section--versions">
              <div className="versions-header">
                <h3>Versions ({versions.length}/{MAX_VERSIONS})</h3>
                <div className="versions-header-actions">
                  <button className="btn btn--ghost btn--sm" onClick={handlePushAll}
                    title={isCloud(asset.sync_state) ? 'Download asset first' : 'Upload all versions to Drive'}
                    disabled={isCloud(asset.sync_state)}>
                    <IconPush /> Upload All
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={handlePullAll}
                    title={
                      isCloud(asset.sync_state)
                        ? 'Download asset first'
                        : !asset.drive_folder_id
                        ? 'Asset is not on Drive yet — upload it first'
                        : 'Download all versions from Drive'
                    }
                    disabled={isCloud(asset.sync_state) || !asset.drive_folder_id}>
                    <IconPull /> Download All
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => setShowAddVersion(true)}
                    disabled={atMaxVersions}
                    title={atMaxVersions ? `Max ${MAX_VERSIONS} versions reached` : 'Add new version'}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add Version
                  </button>
                </div>
              </div>

              {atMaxVersions && (
                <p className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                  Maximum {MAX_VERSIONS} versions reached. Delete an older version to add a new one.
                </p>
              )}

              <div className="version-list">
                {versions.map(v => {
                  const isBusy   = busyIds.has(v.id) || v.sync_state === 'syncing'
                  const isOpen   = expanded[v.id] ?? false
                  const canPull  = !!v.drive_folder_id
                  const canPush  = v.sync_state !== 'cloud'
                  return (
                    <div key={v.id} className={`version-card version-card--${v.sync_state}`}>
                      <div className="version-card__header" onClick={() => toggleExpand(v.id)}>
                        <div className="version-card__title">
                          <span className="version-num">v{v.version_num}</span>
                          {v.label && <span className="version-label">{v.label}</span>}
                        </div>
                        <div className="version-card__right">
                          <span className={`sync-badge sync-badge--${v.sync_state}`} style={{ position: 'static' }}>
                            {isBusy ? 'Syncing…' : SYNC_LABEL[v.sync_state] || v.sync_state}
                          </span>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={e => { e.stopPropagation(); handlePushVersion(v.id) }}
                            disabled={isBusy || !canPush}
                            title={canPush ? 'Upload to Drive (overwrite)' : 'Download this version first before uploading'}
                          >
                            <IconPush />
                            Upload
                          </button>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={e => { e.stopPropagation(); handlePullVersion(v.id) }}
                            disabled={isBusy || !canPull}
                            title={canPull ? 'Download from Drive (overwrite local)' : 'Not on Drive yet'}
                          >
                            <IconPull />
                            Download
                          </button>
                          {v.drive_folder_id && (
                            <button
                              className="btn btn--ghost btn--sm btn--icon-danger"
                              onClick={e => { e.stopPropagation(); handleDeleteVersionFromDrive(v.id) }}
                              disabled={isBusy}
                              title="Delete this version from Drive (keeps local files)"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                                <line x1="9" y1="14" x2="15" y2="20"/><line x1="15" y1="14" x2="9" y2="20"/>
                              </svg>
                            </button>
                          )}
                          <button
                            className="btn btn--ghost btn--sm btn--icon-danger"
                            onClick={e => { e.stopPropagation(); handleDeleteVersion(v.id) }}
                            title="Delete this version locally"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                              <path d="M10 11v6M14 11v6"/>
                            </svg>
                          </button>
                          <svg className="version-card__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="version-card__body">
                          <div className="version-meta">
                            <span>{v.files.length} file{v.files.length !== 1 ? 's' : ''}</span>
                            <span>Added {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                          {v.files.length > 0 && (
                            <ul className="file-list">
                              {v.files.map((f, i) => (
                                <li
                                  key={i}
                                  className="file-item file-item--draggable"
                                  draggable
                                  onDragStart={e => {
                                    e.preventDefault()
                                    window.api.startDrag(asset.id, [f.local_path])
                                  }}
                                  title={`Drag to use in Blender or Explorer\n${f.local_path}`}
                                >
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.35" style={{ flexShrink: 0 }}>
                                    <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/>
                                    <circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>
                                    <circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>
                                  </svg>
                                  <span className="file-item__type">{f.file_type}</span>
                                  <span className="file-item__name" title={f.local_path}>{f.file_name}</span>
                                  <span className="file-item__size">{formatSize(f.file_size)}</span>
                                  {f.drive_file_id && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#3dba6e" strokeWidth="2">
                                      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                                    </svg>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {versions.length === 0 && (
                  <div className="text-muted" style={{ fontSize: 12, padding: '12px 0' }}>No versions yet.</div>
                )}
              </div>
            </section>

            <section className="detail-section">
              <div className="detail-meta-row">
                <span className="text-muted">Added</span>
                <span>{new Date(asset.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </div>
            </section>
          </div>
        </div>
      </div>

      {showGallery && (
        <GalleryViewer asset={asset} onClose={() => setShowGallery(false)} />
      )}



      {showAddVersion && (
        <AddVersionDialog
          asset={asset}
          nextVersionNum={nextVersionNum}
          currentVersionCount={versions.length}
          onComplete={async () => {
            setShowAddVersion(false)
            await loadVersions()
            onUpdate()
          }}
          onCancel={() => setShowAddVersion(false)}
        />
      )}
    </div>
  )
}

// Filled gallery slot — shows a thumbnail when the local file is available,
// falls back to a "Cloud" placeholder when the row only has a Drive ID
// (came in via manifest from another device, hasn't been pulled yet). Click
// the slot to open the viewer.
//
// `syncState` is one of: 'local' | 'syncing' | 'synced' | 'cloud' | 'error',
// derived in the parent so the badge mirrors how versions show their state.
const GALLERY_SYNC_LABEL = {
  local:   'Not synced',
  syncing: 'Syncing…',
  synced:  'Synced',
  cloud:   'Cloud',
  error:   'Error'
}

function GallerySlot({ item, syncState, editMode, busy, onRemove, onClick }) {
  const [thumb, setThumb] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (item.local_path) {
      window.api.previewUrl(item.local_path).then(u => { if (!cancelled) setThumb(u) })
    } else {
      setThumb(null)
    }
    return () => { cancelled = true }
  }, [item.local_path])

  return (
    <div
      className="gallery-slot gallery-slot--filled"
      title={item.file_name}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {thumb ? (
        <img className="gallery-slot__img" src={thumb} alt={item.file_name} />
      ) : (
        <div className="gallery-slot__placeholder">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" opacity="0.55">
            <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
          </svg>
          <span style={{ fontSize: 10 }}>On Drive</span>
        </div>
      )}
      <span
        className={`gallery-slot__badge gallery-slot__badge--${syncState}`}
        title={GALLERY_SYNC_LABEL[syncState] || syncState}
      >
        {GALLERY_SYNC_LABEL[syncState] || syncState}
      </span>
      {editMode && (
        <button
          className="gallery-slot__remove"
          onClick={e => { e.stopPropagation(); onRemove() }}
          disabled={busy}
          title="Remove image"
        >✕</button>
      )}
    </div>
  )
}
