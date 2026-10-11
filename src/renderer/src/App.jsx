import { useState, useEffect, useCallback, useRef } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import AssetGrid from './components/AssetGrid'
import UploadDialog from './components/UploadDialog'
import AssetDetail from './components/AssetDetail'
import Settings from './components/Settings'
import DriveLibraryModal from './components/DriveLibraryModal'
import DownloadQueue from './components/DownloadQueue'
import GalleryViewer from './components/GalleryViewer'

export default function App() {
  const [assets, setAssets] = useState([])
  const [tags, setTags] = useState([])
  const [categories, setCategories] = useState([])
  const [categoryIcons, setCategoryIcons] = useState({})  // { categoryName: iconKey }
  const [applications, setApplications] = useState([])
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [showStarred, setShowStarred]   = useState(false)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadMinimized, setUploadMinimized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showDriveLibrary, setShowDriveLibrary] = useState(false)
  const [authStatus, setAuthStatus] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)
  const [downloadQueue, setDownloadQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [galleryAsset, setGalleryAsset] = useState(null)
  // Files handed over from a window-level drop; seeds a fresh UploadDialog.
  const [dropSeedFiles, setDropSeedFiles] = useState(null)

  const buildFilter = useCallback(() => {
    const filter = {}
    if (search) filter.search = search
    if (selectedCategory) filter.category = selectedCategory
    if (selectedTags.length) filter.tags = selectedTags
    if (showStarred) filter.starred = true
    return filter
  }, [search, selectedCategory, selectedTags, showStarred])

  const loadAssets = useCallback(async () => {
    const result = await window.api.getAssets(buildFilter())
    setAssets(result)
    setLoading(false)
  }, [buildFilter])

  const loadMeta = useCallback(async () => {
    const [t, c, a, ic, apps] = await Promise.all([
      window.api.getTags(),
      window.api.getCategories(),
      window.api.authStatus(),
      window.api.getCategoryIcons(),
      window.api.getApplications()
    ])
    setTags(t)
    setCategories(c)
    setAuthStatus(a)
    setCategoryIcons(Object.fromEntries(ic.map(r => [r.category, r.icon_key])))
    setApplications(apps)
  }, [])

  useEffect(() => { loadAssets() }, [loadAssets])
  useEffect(() => { loadMeta() }, [loadMeta])

  // Auto-refresh from Drive on app launch (if enabled in settings + authenticated)
  const [autoRefreshDone, setAutoRefreshDone] = useState(false)
  useEffect(() => {
    if (autoRefreshDone || !authStatus?.isAuthenticated) return
    let cancelled = false
    ;(async () => {
      const cfg = await window.api.getConfig()
      if (cancelled) return
      if (cfg?.autoRefresh) {
        setAutoRefreshDone(true)
        try { await window.api.refreshDriveLibrary() } catch {}
        if (!cancelled) { loadAssets(); loadMeta() }
      } else {
        setAutoRefreshDone(true)
      }
    })()
    return () => { cancelled = true }
  }, [authStatus?.isAuthenticated, autoRefreshDone, loadAssets, loadMeta])

  // Sync progress events
  useEffect(() => {
    const unsub = window.api.onSyncProgress((data) => {
      setSyncProgress(data)
      if (data.state === 'synced' || data.state === 'error' || data.state === 'cancelled') {
        loadAssets()
        setTimeout(() => setSyncProgress(null), data.state === 'cancelled' ? 1500 : 3000)
      }
    })
    return unsub
  }, [loadAssets])

  // Download queue events
  useEffect(() => {
    window.api.getDownloadQueue().then(setDownloadQueue)
    const unsubQ = window.api.onDownloadQueueUpdate(setDownloadQueue)
    const unsubA = window.api.onAssetDownloaded(() => {
      loadAssets()
      loadMeta()
    })
    return () => { unsubQ(); unsubA() }
  }, [loadAssets, loadMeta])

  const handleDownloadAsset = (asset) => {
    window.api.queueDownload(asset.id, asset.name)
  }

  // Library switch events (triggered by Settings dialog)
  useEffect(() => {
    const unsub = window.api.onLibraryChanged(() => {
      setSelectedAsset(null)
      setSelectedCategory('')
      setSelectedTags([])
      setShowStarred(false)
      setSearch('')
      setLoading(true)
      loadAssets()
      loadMeta()
    })
    return unsub
  }, [loadAssets, loadMeta])

  const handleUploadComplete = async () => {
    setShowUpload(false)
    setUploadMinimized(false)
    setDropSeedFiles(null)
    await loadAssets()
    await loadMeta()
  }

  // Dropping files anywhere on the app opens Add Asset with them attached —
  // but only when nothing else is open: no dialog, panel or viewer, and no
  // minimized Add Asset draft (attaching to a hidden draft would silently
  // change state the user can't see; opening a fresh one would discard it).
  const anythingOpen = showUpload || !!selectedAsset || showSettings || showDriveLibrary || !!galleryAsset
  const anythingOpenRef = useRef(anythingOpen)
  anythingOpenRef.current = anythingOpen

  useEffect(() => {
    // HTML5 drags that originate inside the app must not open Add Asset if
    // dropped back on the window. Prevented dragstarts (the native drag-out
    // in AssetDetail) never produce a dragend, so skip those — they can only
    // happen while AssetDetail is open, which the check below blocks anyway.
    let internalDrag = false
    const onDragStart = (e) => { if (!e.defaultPrevented) internalDrag = true }
    const onDragEnd   = () => { internalDrag = false }
    // Window-level preventDefault also stops Electron from navigating to a
    // file dropped outside a dedicated drop zone.
    const onDragOver = (e) => e.preventDefault()
    const onDrop = (e) => {
      e.preventDefault()
      if (internalDrag) { internalDrag = false; return }
      if (anythingOpenRef.current) return
      const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean)
      if (!paths.length) return
      setDropSeedFiles(paths)
      setUploadMinimized(false)
      setShowUpload(true)
    }
    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // "Add Asset" top-bar button. If a draft is currently minimized we restore
  // it (preserving every field the user already filled in); otherwise we
  // mount a fresh dialog.
  const handleOpenUpload = () => {
    if (showUpload && uploadMinimized) {
      setUploadMinimized(false)
      return
    }
    setUploadMinimized(false)
    setShowUpload(true)
  }

  // Minimize hides the dialog but keeps it mounted so its internal state
  // (files, name, description, etc.) survives untouched until the user
  // restores it via the top-bar button.
  const handleUploadMinimize = () => setUploadMinimized(true)

  // Full close — explicit discard. Triggered by ✕, Cancel, or completion.
  const handleUploadClose = () => {
    setShowUpload(false)
    setUploadMinimized(false)
    setDropSeedFiles(null)
  }

  const handleAssetUpdate = useCallback(async () => {
    const updated = await window.api.getAssets(buildFilter())
    setAssets(updated)
    if (selectedAsset) {
      // always fetch the full asset regardless of current filter so the detail
      // panel stays open even if the asset no longer matches (e.g. un-starred
      // while in Starred view)
      const fresh = (await window.api.getAssets({})).find(a => a.id === selectedAsset.id)
      setSelectedAsset(fresh || null)
    }
  }, [buildFilter, selectedAsset])

  const handleToggleTag = (tag) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const handleToggleStarred = () => {
    setShowStarred(prev => !prev)
  }

  const handleLibraryChanged = () => {
    setSelectedAsset(null)
    setSelectedCategory('')
    setSelectedTags([])
    setShowStarred(false)
    setSearch('')
    setLoading(true)
    loadAssets()
    loadMeta()
  }

  return (
    <div className="app">
      <TopBar
        search={search}
        onSearch={setSearch}
        onUpload={handleOpenUpload}
        uploadMinimized={showUpload && uploadMinimized}
        authStatus={authStatus}
        onAuthChange={loadMeta}
        syncProgress={syncProgress}
        onOpenSettings={() => setShowSettings(true)}
        onOpenDriveLibrary={() => setShowDriveLibrary(true)}
        tags={tags}
        onSelectTag={tag => {
          setSearch(prev => prev.replace(/#\w+$/, '').trim())
          setSelectedTags(prev => [...new Set([...prev, tag])])
        }}
      />
      <div className="app__body">
        <Sidebar
          categories={categories}
          tags={tags}
          selectedCategory={selectedCategory}
          selectedTags={selectedTags}
          showStarred={showStarred}
          categoryIcons={categoryIcons}
          onSelectCategory={setSelectedCategory}
          onToggleTag={handleToggleTag}
          onToggleStarred={handleToggleStarred}
          onClearTags={() => setSelectedTags([])}
        />
        <main className="app__main">
          {loading
            ? <div className="empty-state"><div className="spinner" /></div>
            : <AssetGrid
                assets={assets}
                onSelect={setSelectedAsset}
                onDownload={handleDownloadAsset}
                onOpenGallery={setGalleryAsset}
              />
          }
          <DownloadQueue
            queue={downloadQueue}
            onClearDone={async () => {
              await window.api.clearDoneDownloads()
            }}
          />
        </main>
      </div>

      {showUpload && (
        <UploadDialog
          categories={categories}
          applications={applications}
          initialFiles={dropSeedFiles}
          minimized={uploadMinimized}
          onComplete={handleUploadComplete}
          onCancel={handleUploadClose}
          onMinimize={handleUploadMinimize}
        />
      )}

      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onUpdate={handleAssetUpdate}
          onDelete={async () => {
            const result = await window.api.deleteAsset(selectedAsset.id)
            // If the asset was demoted to cloud-only (Drive copy exists), keep
            // the detail panel open so the user can see the new state and
            // re-download if they change their mind.
            if (!result?.demoted) setSelectedAsset(null)
            await loadAssets()
            await loadMeta()
            if (result?.demoted) {
              // Refresh selectedAsset with its new cloud-only state
              const fresh = (await window.api.getAssets({})).find(a => a.id === selectedAsset.id)
              if (fresh) setSelectedAsset(fresh)
            }
          }}
          onDownload={handleDownloadAsset}
        />
      )}

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onLibraryChanged={handleLibraryChanged}
        />
      )}

      {showDriveLibrary && (
        <DriveLibraryModal
          onClose={() => setShowDriveLibrary(false)}
          onImported={() => {
            loadAssets()
            loadMeta()
          }}
        />
      )}

      {galleryAsset && (
        <GalleryViewer
          asset={galleryAsset}
          onClose={() => setGalleryAsset(null)}
        />
      )}
    </div>
  )
}
