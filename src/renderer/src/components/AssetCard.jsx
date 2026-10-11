import { useState, useEffect } from 'react'

const SYNC_LABEL = { local: 'Local', syncing: 'Syncing', synced: 'Synced', error: 'Error', cloud: 'Cloud' }
const isCloud = s => s === 'cloud'

// Icon overlay reflecting the asset's sync state. Picks the right variant
// based on (drive_orphaned, sync_state). Returns null for syncing/error so
// the existing badge handles those.
function SyncStateIcon({ asset }) {
  let variant, title, icon
  if (asset.drive_orphaned) {
    variant = 'orphan'
    title   = 'Drive copy missing — push again to re-upload'
    icon = (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e0a020" strokeWidth="2">
        <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
        <line x1="9" y1="14" x2="15" y2="20"/><line x1="15" y1="14" x2="9" y2="20"/>
      </svg>
    )
  } else if (asset.sync_state === 'local') {
    variant = 'local'
    title   = 'Local only — not pushed to Drive yet'
    icon = (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e0a020" strokeWidth="2">
        <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
        <line x1="9" y1="14" x2="15" y2="20"/><line x1="15" y1="14" x2="9" y2="20"/>
      </svg>
    )
  } else if (asset.sync_state === 'synced') {
    variant = 'synced'
    title   = 'Fully synced with Drive'
    icon = (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3dba6e" strokeWidth="2">
        <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
        <polyline points="9 14 11 16 15 12" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  } else if (asset.sync_state === 'cloud') {
    variant = 'cloud'
    title   = 'On Drive only — click Download to fetch files'
    icon = (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" strokeWidth="2">
        <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
      </svg>
    )
  } else {
    return null
  }
  return (
    <span className={`asset-card__sync-icon asset-card__sync-icon--${variant}`} title={title}>
      {icon}
    </span>
  )
}

export default function AssetCard({ asset, onClick, onDownload, onOpenGallery }) {
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => {
    if (asset.preview_path) {
      window.api.previewUrl(asset.preview_path).then(setPreviewUrl)
    } else {
      setPreviewUrl(null)
    }
  }, [asset.preview_path])

  const vCount = asset.version_count || 0
  const gCount = asset.gallery_count || 0

  const handleContextMenu = (e) => {
    e.preventDefault()
    if (asset.asset_folder) window.api.showAssetContextMenu(asset.asset_folder, asset.name)
  }

  const handleDownload = (e) => {
    e.stopPropagation()
    onDownload?.(asset)
  }

  const handleGallery = (e) => {
    e.stopPropagation()
    onOpenGallery?.(asset)
  }

  return (
    <div
      className={`asset-card${isCloud(asset.sync_state) ? ' asset-card--cloud' : ''}`}
      onClick={onClick}
      onContextMenu={handleContextMenu}
    >
      <div className="asset-card__thumb">
        {previewUrl
          ? <img src={previewUrl} alt={asset.name} draggable={false} />
          : (
            <div className="asset-card__no-preview">
              {isCloud(asset.sync_state)
                ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5">
                    <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
                  </svg>
                : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
              }
            </div>
          )
        }
        <span className={`sync-badge sync-badge--${asset.sync_state}`}>
          {SYNC_LABEL[asset.sync_state] || asset.sync_state}
        </span>
        {isCloud(asset.sync_state) && (
          <button
            className="asset-card__download-btn"
            onClick={handleDownload}
            title="Download to local library"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </button>
        )}
        {!!asset.starred && (
          <span className="asset-card__star" title="Starred">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#f5c542" stroke="#f5c542" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </span>
        )}
        {gCount > 0 && (
          <button
            className="asset-card__gallery-btn"
            onClick={handleGallery}
            title={`Download and view gallery (${gCount} image${gCount === 1 ? '' : 's'})`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span className="asset-card__gallery-count">{gCount}</span>
          </button>
        )}
        <SyncStateIcon asset={asset} />
      </div>

      <div className="asset-card__body">
        <div className="asset-card__name" title={asset.name}>{asset.name}</div>
        {asset.label && (
          <div className="asset-card__label" title={asset.label}>{asset.label}</div>
        )}
        {asset.category && (
          <div className="asset-card__category">{asset.category}</div>
        )}
        <div className="asset-card__tags">
          {asset.tags?.slice(0, 4).map(t => (
            <span key={t} className="tag-pill">#{t}</span>
          ))}
          {asset.tags?.length > 4 && (
            <span className="tag-pill tag-pill--more">+{asset.tags.length - 4}</span>
          )}
        </div>
        <div className="asset-card__meta">
          <span className="asset-card__versions">
            {vCount} version{vCount !== 1 ? 's' : ''}
          </span>
          {(asset.application || asset.blender_version) && (
            <span>
              {(asset.application || 'Blender')}{asset.blender_version ? ` ${asset.blender_version}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
