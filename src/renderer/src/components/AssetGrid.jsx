import AssetCard from './AssetCard'

export default function AssetGrid({ assets, onSelect, onDownload, onOpenGallery }) {
  if (assets.length === 0) {
    return (
      <div className="empty-state">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.25">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <p>No assets found</p>
        <span className="text-muted">Add your first asset with the button above</span>
      </div>
    )
  }

  return (
    <div className="asset-grid">
      {assets.map(asset => (
        <AssetCard
          key={asset.id}
          asset={asset}
          onClick={() => onSelect(asset)}
          onDownload={onDownload}
          onOpenGallery={onOpenGallery}
        />
      ))}
    </div>
  )
}
