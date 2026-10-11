import { useState, useEffect } from 'react'

// Gallery viewer. Reads images straight from local disk; no auto-pull —
// download is user-initiated via the Download button in AssetDetail (mirrors
// how versions handle cross-device sync). Cloud-only items appear as
// missing slots with a hint pointing at that button.
export default function GalleryViewer({ asset, onClose }) {
  const [items, setItems]       = useState([])
  const [urls, setUrls]         = useState({})    // galleryId → data URL
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await window.api.galleryList(asset.id)
      if (cancelled) return
      setItems(list)
      const next = {}
      for (const item of list) {
        if (item.local_path) {
          const u = await window.api.previewUrl(item.local_path)
          if (u) next[item.id] = u
        }
      }
      if (cancelled) return
      setUrls(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [asset.id])

  // Keyboard nav — left/right between slides, Esc to close.
  useEffect(() => {
    const handler = (e) => {
      const visibleLen = items.filter(i => urls[i.id]).length
      if (e.key === 'Escape') onClose()
      if (!visibleLen) return
      if (e.key === 'ArrowLeft')  setActiveIdx(i => (i - 1 + visibleLen) % visibleLen)
      if (e.key === 'ArrowRight') setActiveIdx(i => (i + 1) % visibleLen)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [items, urls, onClose])

  const visible = items.filter(i => !!urls[i.id])
  const cloudOnly = items.filter(i => !urls[i.id] && i.drive_file_id)
  const active  = visible[Math.min(activeIdx, visible.length - 1)]
  const isEmpty = !loading && items.length === 0
  const onlyCloud = !loading && items.length > 0 && visible.length === 0

  return (
    <div className="modal-overlay modal-overlay--gallery" onClick={onClose}>
      <div className="gallery-viewer" onClick={e => e.stopPropagation()}>
        <div className="gallery-viewer__header">
          <h2 className="gallery-viewer__title">{asset.name} — Gallery</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="gallery-viewer__state">
            <div className="spinner" />
            <div>Loading…</div>
          </div>
        )}

        {isEmpty && (
          <div className="gallery-viewer__state">
            <div className="text-muted">No gallery images for this asset.</div>
          </div>
        )}

        {onlyCloud && (
          <div className="gallery-viewer__state">
            <div className="text-muted">
              Gallery images for this asset are on Drive only.
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Click <strong>Download</strong> in the asset detail to fetch them locally.
            </div>
          </div>
        )}

        {!loading && active && (
          <>
            <div className="gallery-viewer__stage">
              {visible.length > 1 && (
                <button
                  className="gallery-viewer__nav gallery-viewer__nav--prev"
                  onClick={() => setActiveIdx(i => (i - 1 + visible.length) % visible.length)}
                  title="Previous (←)"
                  aria-label="Previous image"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
              )}
              <img src={urls[active.id]} alt={active.file_name} className="gallery-viewer__img" />
              {visible.length > 1 && (
                <button
                  className="gallery-viewer__nav gallery-viewer__nav--next"
                  onClick={() => setActiveIdx(i => (i + 1) % visible.length)}
                  title="Next (→)"
                  aria-label="Next image"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              )}
            </div>

            {visible.length > 1 && (
              <div className="gallery-viewer__thumbs">
                {visible.map((img, i) => (
                  <button
                    key={img.id}
                    className={`gallery-viewer__thumb${i === activeIdx ? ' gallery-viewer__thumb--active' : ''}`}
                    onClick={() => setActiveIdx(i)}
                  >
                    <img src={urls[img.id]} alt="" />
                  </button>
                ))}
              </div>
            )}

            <div className="gallery-viewer__caption text-muted">
              {Math.min(activeIdx + 1, visible.length)} / {visible.length} · {active.file_name}
              {cloudOnly.length > 0 && (
                <span style={{ marginLeft: 8, opacity: 0.7 }}>
                  ({cloudOnly.length} on Drive — Download in asset detail to view)
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
