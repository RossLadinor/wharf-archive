const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Assets
  getAssets:     (filter) => ipcRenderer.invoke('db:getAssets', filter),
  addAsset:      (data)   => ipcRenderer.invoke('db:addAsset', data),
  updateAsset:   (data)   => ipcRenderer.invoke('db:updateAsset', data),
  deleteAsset:   (id)     => ipcRenderer.invoke('db:deleteAsset', id),
  getTags:          ()       => ipcRenderer.invoke('db:getTags'),
  getCategories:    ()       => ipcRenderer.invoke('db:getCategories'),
  getCategoryIcons: ()       => ipcRenderer.invoke('db:getCategoryIcons'),
  setCategoryIcon:  (category, iconKey) => ipcRenderer.invoke('db:setCategoryIcon', { category, iconKey }),
  getApplications:     ()                           => ipcRenderer.invoke('db:getApplications'),

  // Versions
  getVersionsByAsset: (assetId) => ipcRenderer.invoke('versions:getByAsset', assetId),
  addVersion:         (data)    => ipcRenderer.invoke('versions:add', data),
  deleteVersion:      (id)      => ipcRenderer.invoke('versions:delete', id),

  // Files
  openDialog:        (opts) => ipcRenderer.invoke('files:openDialog', opts),
  openPreviewDialog: ()     => ipcRenderer.invoke('files:openPreviewDialog'),
  selectFolder:      (opts) => ipcRenderer.invoke('files:selectFolder', opts),
  getFileInfo:       (p)    => ipcRenderer.invoke('files:getInfo', p),
  previewUrl:        (p)    => ipcRenderer.invoke('files:previewUrl', p),

  // Drag a file out of the app (e.g. into Blender). Must be called from a dragstart handler.
  startDrag: (assetId, filePaths) => ipcRenderer.send('files:startDrag', { assetId, filePaths }),

  // Clipboard
  clipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  // Open URL in default browser
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  // Context menu
  showAssetContextMenu: (assetFolder, assetName) => ipcRenderer.send('context-menu:asset', { assetFolder, assetName }),

  // Auth
  authStatus:           ()     => ipcRenderer.invoke('auth:status'),
  login:                ()     => ipcRenderer.invoke('auth:login'),
  logout:               ()     => ipcRenderer.invoke('auth:logout'),
  saveCredentials:      (json) => ipcRenderer.invoke('auth:saveCredentials', json),
  exportDriveAccessPack: ()    => ipcRenderer.invoke('auth:exportPack'),

  // Settings
  getConfig:      ()           => ipcRenderer.invoke('settings:getConfig'),
  setLibraryPath: (folderPath) => ipcRenderer.invoke('settings:setLibraryPath', folderPath),
  importLibrary:  (folderPath) => ipcRenderer.invoke('settings:importLibrary', folderPath),
  setAutoRefresh: (enabled)    => ipcRenderer.invoke('settings:setAutoRefresh', enabled),

  // Drive sync — push: local → Drive, pull: Drive → local
  cancelSync:      ()   => ipcRenderer.invoke('sync:cancelActive'),
  pushVersion:     (id) => ipcRenderer.invoke('sync:pushVersion',    id),
  pushAsset:       (id) => ipcRenderer.invoke('sync:pushAsset',      id),
  pullVersion:     (id) => ipcRenderer.invoke('sync:pullVersion',    id),
  pullAsset:       (id) => ipcRenderer.invoke('sync:pullAsset',      id),
  deleteFromDrive:        (id) => ipcRenderer.invoke('sync:deleteFromDrive',        id),
  deleteVersionFromDrive: (id) => ipcRenderer.invoke('sync:deleteVersionFromDrive', id),

  // Drive cloud library
  importDriveLibrary:     (folderId) => ipcRenderer.invoke('sync:importDriveLibrary', { folderId }),
  refreshDriveLibrary:    ()         => ipcRenderer.invoke('sync:refreshDriveLibrary'),

  // Gallery (local-first reference images, max 3 per asset, ≤ 2 MB each)
  galleryList:             (assetId)             => ipcRenderer.invoke('gallery:list', assetId),
  galleryPickImage:        ()                    => ipcRenderer.invoke('gallery:pickImage'),
  galleryPasteFromClipboard: ()                  => ipcRenderer.invoke('gallery:pasteFromClipboard'),
  galleryAdd:              (assetId, sourcePath) => ipcRenderer.invoke('gallery:add', { assetId, sourcePath }),
  galleryRemove:           (galleryId)           => ipcRenderer.invoke('gallery:remove', galleryId),
  galleryPushPending:      (assetId)             => ipcRenderer.invoke('gallery:pushPending', assetId),
  galleryPullMissing:      (assetId)             => ipcRenderer.invoke('gallery:pullMissing', assetId),
  onGalleryPushProgress: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('gallery:pushProgress', h)
    return () => ipcRenderer.removeListener('gallery:pushProgress', h)
  },
  onGalleryPullProgress: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('gallery:pullProgress', h)
    return () => ipcRenderer.removeListener('gallery:pullProgress', h)
  },
  // Download queue
  queueDownload:    (assetId, assetName) => ipcRenderer.invoke('download:queue', { assetId, assetName }),
  getDownloadQueue: ()                   => ipcRenderer.invoke('download:getQueue'),
  clearDoneDownloads: ()                 => ipcRenderer.invoke('download:clearDone'),

  // Events
  onSyncProgress: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('sync:progress', h)
    return () => ipcRenderer.removeListener('sync:progress', h)
  },
  onImportProgress: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('sync:importProgress', h)
    return () => ipcRenderer.removeListener('sync:importProgress', h)
  },
  onDownloadQueueUpdate: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('download:queueUpdate', h)
    return () => ipcRenderer.removeListener('download:queueUpdate', h)
  },
  onAssetDownloaded: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('download:assetDone', h)
    return () => ipcRenderer.removeListener('download:assetDone', h)
  },
  onLibraryChanged: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('library:changed', h)
    return () => ipcRenderer.removeListener('library:changed', h)
  }
})
