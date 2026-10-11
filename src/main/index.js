const { app, BrowserWindow, ipcMain, protocol, dialog, nativeImage, Menu, shell, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { v4: uuidv4 } = require('uuid')

const db = require('./db')
const auth = require('./auth')
const sync = require('./sync')
const config = require('./config')

// ── Single-instance lock ─────────────────────────────────────────────────────
// Two instances opening the same SQLite library at once is a recipe for "database
// is locked" errors and corrupted WAL state, and a second OAuth callback server
// trying to bind :42813 would fail outright. Grab the lock before doing any work;
// if another instance already holds it, surface their window and exit fast.
//
// `gotSingleInstanceLock` gates the lifecycle registrations below
// (`app.whenReady`, `app.on('window-all-closed')`, `app.on('second-instance')`).
// Module-scope helper functions stay declared regardless — they're harmless
// without their event listeners.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

const MAX_VERSIONS = 10

// Drag icon fallback (32x32 transparent-ish blue square)
const DRAG_ICON_B64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAANklEQVRYhe3OMQEAAAjDMKb' +
  'K/pd2isUBBR4AAAAAAAAAAAAAAAAAAAAAAAAA8GcBAAD//wMAClwC9QAAAABJRU5ErkJggg=='

function getAssetFolder(assetId, category) {
  return path.join(config.getLibraryPath(), category || 'Uncategorized', assetId)
}

function copyFilesToFolder(files, destFolder) {
  fs.mkdirSync(destFolder, { recursive: true })
  return files.map(f => {
    if (f.local_path && fs.existsSync(f.local_path)) {
      const dest = path.join(destFolder, f.file_name)
      fs.copyFileSync(f.local_path, dest)
      return { ...f, local_path: dest }
    }
    return f
  })
}

function writeAssetMetadata(assetFolder, asset, tags, versions) {
  try {
    const meta = {
      id: asset.id,
      name: asset.name,
      description: asset.description || '',
      category: asset.category || '',
      application: asset.application || 'Blender',
      tags: tags || [],
      blender_version: asset.blender_version || '',
      created_at: asset.created_at || new Date().toISOString(),
      versions: versions.map(v => ({
        num: v.version_num,
        label: v.label || '',
        files: (v.files || []).map(f => f.file_name)
      }))
    }
    fs.writeFileSync(path.join(assetFolder, 'metadata.json'), JSON.stringify(meta, null, 2))
  } catch {}
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1f',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1a1f', symbolColor: '#9090a8', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

if (gotSingleInstanceLock) {
  // Someone tried to launch Wharf Archive while we were already running —
  // restore + focus our existing window instead of doing nothing.
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    const win = wins[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    registerIPC()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, payload))
}

// ── Download queue ────────────────────────────────────────────────────────────
const downloadQueue = []
let downloadBusy = false

function broadcastQueue() {
  broadcast('download:queueUpdate', downloadQueue.map(q => ({ ...q })))
}

async function processQueue() {
  if (downloadBusy) return
  const next = downloadQueue.find(q => q.status === 'pending')
  if (!next) return
  downloadBusy = true
  next.status = 'downloading'
  broadcastQueue()
  try {
    const r = await sync.downloadAsset(next.assetId, p => {
      next.progress = p.step
      next.speedBps = p.speedBps || 0
      broadcastQueue()
    })
    if (r?.cancelled) {
      next.status = 'cancelled'
      next.error  = 'Cancelled by user'
    } else {
      next.status = 'done'
    }
  } catch (err) {
    next.status = 'error'
    next.error = err.message
  }
  downloadBusy = false
  broadcastQueue()
  broadcast('download:assetDone', { assetId: next.assetId })
  processQueue()
}

function switchLibrary(folderPath) {
  try {
    config.save({ libraryPath: folderPath })
    db.resetDb()
    const assets = db.getAssets()
    return { success: true, path: folderPath, assetCount: assets.length }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function registerIPC() {
  // ── Assets ──────────────────────────────────────────────────────────────────
  ipcMain.handle('db:getAssets', (_, filter) => db.getAssets(filter))

  ipcMain.handle('db:addAsset', (_, { asset, tags, files, previewSrc }) => {
    const assetId = uuidv4()
    const versionId = uuidv4()

    // Create asset folder: <library>/<category>/<assetId>/
    const assetFolder = getAssetFolder(assetId, asset.category)
    fs.mkdirSync(assetFolder, { recursive: true })

    // Copy preview image into asset folder
    let previewPath = ''
    if (previewSrc && fs.existsSync(previewSrc)) {
      const ext = path.extname(previewSrc)
      previewPath = path.join(assetFolder, `preview${ext}`)
      fs.copyFileSync(previewSrc, previewPath)
    }

    // Copy version 1 files into <assetFolder>/v1/
    const v1Folder = path.join(assetFolder, 'v1')
    const copiedFiles = copyFilesToFolder(files || [], v1Folder)

    db.insertAsset({
      ...asset,
      id: assetId,
      preview_path: previewPath,
      asset_folder: assetFolder,
      poly_count: asset.poly_count || 0
    })
    if (tags?.length) db.setAssetTags(assetId, tags)

    db.addVersion({ id: versionId, asset_id: assetId, version_num: 1, label: '' })
    if (copiedFiles.length) db.addVersionFiles(versionId, assetId, copiedFiles)

    writeAssetMetadata(assetFolder, { ...asset, id: assetId }, tags || [], [
      { version_num: 1, label: '', files: copiedFiles }
    ])

    return assetId
  })

  ipcMain.handle('db:updateAsset', (_, { id, asset, tags, previewSrc }) => {
    // Handle preview image replacement
    if (previewSrc && fs.existsSync(previewSrc)) {
      const existing = db.getAssetById(id)
      if (existing?.asset_folder) {
        const ext = path.extname(previewSrc) || '.png'
        const newPreviewPath = path.join(existing.asset_folder, `preview${ext}`)
        // Remove old preview file if path differs
        if (existing.preview_path && existing.preview_path !== newPreviewPath && fs.existsSync(existing.preview_path)) {
          try { fs.unlinkSync(existing.preview_path) } catch {}
        }
        fs.copyFileSync(previewSrc, newPreviewPath)
        db.updateAsset(id, { preview_path: newPreviewPath })
      }
    }
    if (asset) db.updateAsset(id, asset)
    if (tags) db.setAssetTags(id, tags)
    // Refresh metadata.json
    const updated = db.getAssetById(id)
    if (updated?.asset_folder) {
      const versions = db.getVersionsByAsset(id)
      writeAssetMetadata(updated.asset_folder, updated, updated.tags || [], versions)
    }
    return true
  })

  ipcMain.handle('db:deleteAsset', (_, id) => {
    const asset = db.getAssetById(id)
    if (!asset) return true

    // If a Drive copy exists we keep the asset visible in the library and
    // demote it to "cloud-only" instead of deleting the row. Otherwise the
    // user would lose access to a synced asset just by reclaiming local disk
    // space — the Drive copy would still be there but unreachable from the
    // app until the next manifest refresh.
    if (asset.drive_folder_id) {
      // Stash the preview in _previews/ so the thumbnail keeps working after
      // the asset folder is wiped. Mirrors how syncFromDriveLibrary handles
      // freshly imported cloud-only assets.
      let newPreviewPath = ''
      if (asset.preview_path && fs.existsSync(asset.preview_path)) {
        try {
          const ext = path.extname(asset.preview_path) || '.jpg'
          const previewsDir = path.join(config.getLibraryPath(), '_previews')
          fs.mkdirSync(previewsDir, { recursive: true })
          newPreviewPath = path.join(previewsDir, `${id}${ext}`)
          // Copy first, then remove the asset folder — copy can fail if the
          // file is locked, in which case we still want the demote to proceed
          // with an empty preview rather than abort.
          fs.copyFileSync(asset.preview_path, newPreviewPath)
        } catch { newPreviewPath = '' }
      }

      if (asset.asset_folder && fs.existsSync(asset.asset_folder)) {
        try { fs.rmSync(asset.asset_folder, { recursive: true, force: true }) } catch {}
      }

      db.updateAsset(id, {
        asset_folder: '',
        preview_path: newPreviewPath,
        drive_orphaned: 0
      })

      // Versions still on Drive flip to cloud-only. Versions never pushed are
      // local-only by definition, so deleting their files means deleting the
      // version itself — there's nothing left to point at.
      const versions = db.getVersionsByAsset(id)
      for (const v of versions) {
        if (v.drive_folder_id) {
          db.updateVersion(v.id, { sync_state: 'cloud' })
          db.getDb().prepare(`UPDATE asset_files SET local_path = '' WHERE version_id = ?`).run(v.id)
        } else {
          db.deleteVersion(v.id)
        }
      }

      // Same logic for gallery rows. Local files inside <assetFolder>/gallery/
      // were just rm-rf'd, so we either keep the row + clear local_path (will
      // re-pull from Drive on viewer open) or drop the row entirely.
      const galleryItems = db.getGalleryByAsset(id)
      for (const g of galleryItems) {
        if (g.drive_file_id) {
          db.updateGalleryItem(g.id, { local_path: '' })
        } else {
          db.removeGalleryItem(g.id)
        }
      }

      return { success: true, demoted: true }
    }

    // No Drive copy — full delete (preserves pre-1.4.5 behaviour for
    // local-only assets).
    if (asset.asset_folder && fs.existsSync(asset.asset_folder)) {
      try { fs.rmSync(asset.asset_folder, { recursive: true, force: true }) } catch {}
    }
    db.deleteAsset(id)
    return { success: true, demoted: false }
  })

  ipcMain.handle('db:getTags',          () => db.getAllTags())
  ipcMain.handle('db:getCategories',    () => db.getAllCategories())
  ipcMain.handle('db:getCategoryIcons', () => db.getCategoryIcons())
  ipcMain.handle('db:setCategoryIcon',  (_, { category, iconKey }) => {
    db.setCategoryIcon(category, iconKey)
    return true
  })
  ipcMain.handle('db:getApplications', () => db.getAllApplications())

  // ── Versions ──────────────────────────────────────────────────────────────
  ipcMain.handle('versions:getByAsset', (_, assetId) => db.getVersionsByAsset(assetId))

  ipcMain.handle('versions:add', (_, { assetId, label, files }) => {
    const asset = db.getAssetById(assetId)
    if (!asset) return { success: false, error: 'Asset not found' }

    const currentCount = db.getVersionCount(assetId)
    if (currentCount >= MAX_VERSIONS) {
      return {
        success: false,
        error: `Maximum ${MAX_VERSIONS} versions per asset. Delete an older version first.`
      }
    }

    const versionId = uuidv4()
    const versionNum = db.getNextVersionNum(assetId)

    // Copy files into <assetFolder>/v<N>/
    const versionFolder = asset.asset_folder
      ? path.join(asset.asset_folder, `v${versionNum}`)
      : null
    const copiedFiles = versionFolder
      ? copyFilesToFolder(files || [], versionFolder)
      : (files || [])

    db.addVersion({ id: versionId, asset_id: assetId, version_num: versionNum, label: label || '' })
    if (copiedFiles.length) db.addVersionFiles(versionId, assetId, copiedFiles)
    db.updateAsset(assetId, { updated_at: new Date().toISOString() })

    // Refresh metadata.json
    if (asset.asset_folder) {
      const allVersions = db.getVersionsByAsset(assetId)
      writeAssetMetadata(asset.asset_folder, asset, asset.tags || [], allVersions)
    }

    return { success: true, versionId }
  })

  ipcMain.handle('versions:delete', (_, versionId) => {
    const version = db.getVersionById(versionId)
    if (!version) return { success: false, error: 'Version not found' }
    if (db.getVersionCount(version.asset_id) <= 1) {
      return { success: false, error: 'Cannot delete the last version. Delete the asset instead.' }
    }

    // Delete the version's local folder
    const asset = db.getAssetById(version.asset_id)
    if (asset?.asset_folder) {
      const vFolder = path.join(asset.asset_folder, `v${version.version_num}`)
      if (fs.existsSync(vFolder)) {
        try { fs.rmSync(vFolder, { recursive: true, force: true }) } catch {}
      }
    }

    db.deleteVersion(versionId)

    // Refresh metadata.json
    if (asset?.asset_folder) {
      const allVersions = db.getVersionsByAsset(version.asset_id)
      writeAssetMetadata(asset.asset_folder, asset, asset.tags || [], allVersions)
    }

    return { success: true }
  })

  // ── Files ──────────────────────────────────────────────────────────────────
  ipcMain.handle('files:openDialog', (_, opts = {}) => {
    return dialog.showOpenDialogSync({
      title: opts.title || 'Select Files',
      filters: opts.filters || [
        { name: 'Blender / 3D Files', extensions: ['blend', 'fbx', 'obj', 'glb', 'gltf', 'abc', 'hdr', 'exr'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])]
    }) || null
  })

  ipcMain.handle('files:openPreviewDialog', () => {
    return dialog.showOpenDialogSync({
      title: 'Select Preview Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    }) || null
  })

  ipcMain.handle('files:selectFolder', (_, opts = {}) => {
    return dialog.showOpenDialogSync({
      title: opts.title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory']
    })?.[0] || null
  })

  ipcMain.handle('files:getInfo', (_, filePath) => {
    try {
      const stat = fs.statSync(filePath)
      return { exists: true, size: stat.size, name: path.basename(filePath) }
    } catch {
      return { exists: false, size: 0, name: path.basename(filePath) }
    }
  })

  ipcMain.handle('files:previewUrl', (_, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return null
    try {
      const ext  = path.extname(filePath).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const b64  = fs.readFileSync(filePath).toString('base64')
      return `data:${mime};base64,${b64}`
    } catch { return null }
  })

  // Drag files out of the app to OS (e.g. into Blender).
  ipcMain.on('files:startDrag', (event, { assetId, filePaths }) => {
    if (!filePaths?.length) return
    let icon
    try {
      const asset = db.getAssetById(assetId)
      if (asset?.preview_path && fs.existsSync(asset.preview_path)) {
        icon = nativeImage.createFromPath(asset.preview_path).resize({ width: 64, height: 64 })
      }
    } catch {}
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromDataURL(DRAG_ICON_B64)
    }
    event.sender.startDrag({ files: filePaths, icon })
  })

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:getConfig', () => ({
    libraryPath: config.getLibraryPath(),
    dbPath:      config.getDbPath(),
    isDefault:   !config.load().libraryPath,
    autoRefresh: !!config.load().autoRefresh
  }))

  ipcMain.handle('settings:setAutoRefresh', (_, enabled) => {
    config.save({ autoRefresh: !!enabled })
    return { success: true }
  })

  ipcMain.handle('settings:setLibraryPath', (_, folderPath) => {
    const result = switchLibrary(folderPath)
    if (result.success) broadcast('library:changed', result)
    return result
  })

  ipcMain.handle('settings:importLibrary', (_, folderPath) => {
    const dbPath = path.join(folderPath, 'library.db')
    if (!fs.existsSync(dbPath)) {
      return {
        success: false,
        error: 'No library.db found in that folder.\nMake sure you selected the root library folder.'
      }
    }
    const result = switchLibrary(folderPath)
    if (result.success) broadcast('library:changed', result)
    return result
  })

  // ── Auth ──────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:status',          () => auth.getAuthStatus())
  ipcMain.handle('auth:login',           () => auth.authenticate())
  ipcMain.handle('auth:logout',          () => auth.logout())
  ipcMain.handle('auth:saveCredentials', (_, json) => {
    try { auth.saveCredentials(JSON.parse(json)); return { success: true } }
    catch { return { success: false, error: 'Invalid JSON — paste the full credentials file content.' } }
  })
  ipcMain.handle('auth:exportPack', () => {
    try { return { success: true, pack: auth.exportAccessPack() } }
    catch (err) { return { success: false, error: err.message } }
  })

  // ── Sync (push / pull) ────────────────────────────────────────────────────
  ipcMain.handle('sync:pushVersion', async (event, versionId) => {
    try {
      return await sync.pushVersion(versionId, p => event.sender.send('sync:progress', { versionId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:pushAsset', async (event, assetId) => {
    try {
      return await sync.pushAsset(assetId, p => event.sender.send('sync:progress', { assetId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:pullVersion', async (event, versionId) => {
    try {
      return await sync.pullVersion(versionId, p => event.sender.send('sync:progress', { versionId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:pullAsset', async (event, assetId) => {
    try {
      return await sync.pullAsset(assetId, p => event.sender.send('sync:progress', { assetId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:deleteFromDrive', async (event, assetId) => {
    try {
      return await sync.deleteAssetFromDrive(assetId, p => event.sender.send('sync:progress', { assetId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:cancelActive', () => {
    const cancelled = sync.cancelAllOps()
    return { success: true, cancelled }
  })

  // ── Gallery (local-first) ─────────────────────────────────────────────────
  ipcMain.handle('gallery:list', (_, assetId) => db.getGalleryByAsset(assetId))

  // Image-only file picker with size-preflight so the renderer can show a
  // helpful error before round-tripping the actual upload.
  ipcMain.handle('gallery:pickImage', async () => {
    const paths = dialog.showOpenDialogSync({
      title: 'Select gallery image (max 2 MB)',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (!paths?.[0]) return null
    try {
      const stat = fs.statSync(paths[0])
      return {
        path: paths[0],
        size: stat.size,
        name: path.basename(paths[0]),
        oversize: stat.size > sync.GALLERY_MAX_BYTES
      }
    } catch {
      return null
    }
  })

  // Pull the current clipboard image into a temp PNG file and return the
  // metadata in the same shape as gallery:pickImage. Renderer can then
  // pass `path` straight to gallery:add.
  ipcMain.handle('gallery:pasteFromClipboard', () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const tmpPath = path.join(os.tmpdir(), `wharf-gallery-paste-${Date.now()}.png`)
    try {
      fs.writeFileSync(tmpPath, img.toPNG())
      const size = fs.statSync(tmpPath).size
      return {
        path: tmpPath,
        size,
        name: `clipboard-${Date.now()}.png`,
        oversize: size > sync.GALLERY_MAX_BYTES
      }
    } catch (e) {
      return null
    }
  })

  ipcMain.handle('gallery:add', async (_, { assetId, sourcePath }) => {
    try {
      return await sync.addGalleryImage(assetId, sourcePath)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('gallery:remove', async (_, galleryId) => {
    try {
      return await sync.removeGalleryImage(galleryId)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Manual upload — pushes every gallery row that has a local file but no
  // drive_file_id yet. Equivalent of the per-version Upload button.
  ipcMain.handle('gallery:pushPending', async (event, assetId) => {
    try {
      return await sync.pushPendingGalleryImages(assetId, p =>
        event.sender.send('gallery:pushProgress', { assetId, ...p })
      )
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Manual download — pulls every gallery row that has a Drive ID but no
  // local file. Used both for cross-device sync and as the explicit
  // counterpart to Upload.
  ipcMain.handle('gallery:pullMissing', async (event, assetId) => {
    try {
      return await sync.pullGalleryImages(assetId, p =>
        event.sender.send('gallery:pullProgress', { assetId, ...p })
      )
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:deleteVersionFromDrive', async (event, versionId) => {
    try {
      return await sync.deleteVersionFromDrive(versionId, p => event.sender.send('sync:progress', { versionId, ...p }))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Drive cloud library ───────────────────────────────────────────────────
  ipcMain.handle('sync:importDriveLibrary', async (event, { folderId } = {}) => {
    try {
      return await sync.syncFromDriveLibrary(p => event.sender.send('sync:importProgress', p), folderId || null)
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sync:refreshDriveLibrary', async (event) => {
    try {
      return await sync.syncFromDriveLibrary(p => event.sender.send('sync:importProgress', p))
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ── Download queue ────────────────────────────────────────────────────────
  ipcMain.handle('download:queue', (_, { assetId, assetName }) => {
    if (downloadQueue.find(q => q.assetId === assetId && (q.status === 'pending' || q.status === 'downloading'))) {
      return { queued: false, reason: 'Already in queue' }
    }
    downloadQueue.push({ id: uuidv4(), assetId, assetName, status: 'pending', progress: null, error: null })
    broadcastQueue()
    processQueue()
    return { queued: true }
  })

  ipcMain.handle('download:getQueue', () => downloadQueue.map(q => ({ ...q })))

  ipcMain.handle('download:clearDone', () => {
    const before = downloadQueue.length
    downloadQueue.splice(0, downloadQueue.length,
      ...downloadQueue.filter(q => q.status !== 'done' && q.status !== 'error' && q.status !== 'cancelled'))
    broadcastQueue()
    return { removed: before - downloadQueue.length }
  })

  // ── Clipboard ─────────────────────────────────────────────────────────────
  ipcMain.handle('clipboard:readImage', () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    const tmpPath = path.join(os.tmpdir(), `wharf-paste-${Date.now()}.png`)
    fs.writeFileSync(tmpPath, img.toPNG())
    return tmpPath
  })

  // ── Open external URL in default browser ──────────────────────────────────
  ipcMain.on('shell:openExternal', (_, url) => {
    if (typeof url !== 'string') return
    // Whitelist common safe protocols only
    if (/^(https?|mailto):/i.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
  })

  // ── Context menu ──────────────────────────────────────────────────────────
  ipcMain.on('context-menu:asset', (event, { assetFolder, assetName }) => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open in Explorer',
        click: () => {
          if (assetFolder && fs.existsSync(assetFolder)) {
            shell.openPath(assetFolder)
          }
        }
      }
    ])
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) menu.popup({ window: win })
  })
}
