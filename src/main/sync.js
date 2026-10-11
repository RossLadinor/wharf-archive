const { getAuthClient } = require('./auth')
const { DriveClient } = require('./drive')
const db = require('./db')
const config = require('./config')
const path = require('path')
const fs = require('fs')

// Gallery image hard cap. Enforced both renderer-side (fast feedback) and
// here in main as the authoritative check before any Drive bytes leave.
const GALLERY_MAX_BYTES = 2 * 1024 * 1024

// ── Cancellation registry ───────────────────────────────────────────────────
// Each long-running sync operation registers its AbortController here so a
// global cancel can stop everything in flight. There's at most ~1 active
// operation in practice (push/pull/download are sequential, queue is one-at-a-time).
const activeOps = new Set()

function startOp() {
  const ctrl = new AbortController()
  activeOps.add(ctrl)
  return ctrl
}
function endOp(ctrl) {
  activeOps.delete(ctrl)
}
function cancelAllOps() {
  for (const c of activeOps) {
    try { c.abort() } catch {}
  }
  return activeOps.size > 0
}
function isAbortError(err, ctrl) {
  return err?.name === 'AbortError' || ctrl?.signal?.aborted
}

function getFileType(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (ext === 'blend') return 'blend'
  if (['fbx', 'obj', 'glb', 'gltf', 'abc'].includes(ext)) return 'mesh'
  if (['hdr', 'exr'].includes(ext)) return 'hdr'
  if (['png', 'jpg', 'jpeg', 'tga', 'bmp'].includes(ext)) return 'texture'
  return 'file'
}

function buildAssetFolder(asset) {
  return path.join(config.getLibraryPath(), asset.category || 'Uncategorized', asset.id)
}

// ── Library manifest ─────────────────────────────────────────────────────────

// Serialise one local asset (that has a drive_folder_id) into a manifest entry.
function buildManifestEntry(asset) {
  const versions = db.getVersionsByAsset(asset.id)
  let preview_file_name = ''
  if (asset.asset_folder && fs.existsSync(asset.asset_folder)) {
    const f = fs.readdirSync(asset.asset_folder).find(n => n.startsWith('preview.'))
    if (f) preview_file_name = f
  }
  const gallery = db.getGalleryByAsset(asset.id).map(g => ({
    slot: g.slot,
    drive_file_id: g.drive_file_id,
    file_name: g.file_name,
    file_size: g.file_size || 0
  }))
  return {
    id: asset.id,
    name: asset.name,
    description: asset.description || '',
    category: asset.category || '',
    application: asset.application || 'Blender',
    tags: asset.tags || [],
    blender_version: asset.blender_version || '',
    poly_count: asset.poly_count || 0,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
    drive_folder_id: asset.drive_folder_id,
    preview_drive_file_id: asset.preview_drive_file_id || '',
    preview_file_name,
    gallery,
    versions: versions
      .filter(v => v.drive_folder_id)
      .map(v => ({
        id: v.id,
        version_num: v.version_num,
        label: v.label || '',
        drive_folder_id: v.drive_folder_id,
        created_at: v.created_at,
        files: v.files
          .filter(f => f.drive_file_id)
          .map(f => ({
            file_name: f.file_name,
            file_size: f.file_size || 0,
            file_type: f.file_type || 'file',
            drive_file_id: f.drive_file_id
          }))
      }))
  }
}

// Read the current library.json from Drive, merge local state into it, then
// write it back.  This prevents a partially-synced PC from wiping entries
// that were pushed by another device.
//
// "cloud-only" = imported from Drive but never downloaded (sync_state === 'cloud').
//   Drive is the authoritative source for these; we never overwrite or re-add them.
//
// Merge rules (matched by asset UUID):
//   • In Drive manifest only (never imported here)           → keep Drive entry as-is
//   • In Drive manifest, local is cloud-only                 → keep Drive entry as-is
//   • In Drive manifest, local has files (synced/local)      → overwrite with fresh local data
//   • In Drive manifest, local drive_folder_id cleared       → explicitly deleted here → remove
//   • Local has files + drive_folder_id, not in Drive manifest → new push from this device → add
//   • Local is cloud-only, not in Drive manifest             → deleted on Drive → skip (don't re-add)
async function updateLibraryManifest(client) {
  const allLocalAssets = db.getAssets({})

  // Index local assets by id for O(1) lookup
  const localById = new Map(allLocalAssets.map(a => [a.id, a]))

  // ── Read current Drive manifest ──────────────────────────────────────
  let driveEntries = []
  try {
    const existing = await client.readLibraryJson()
    if (existing && Array.isArray(existing.assets)) {
      driveEntries = existing.assets
    }
  } catch {
    // Drive manifest doesn't exist yet — start from empty
  }

  // ── Merge ────────────────────────────────────────────────────────────
  const merged = new Map() // id → entry

  // Pass 1: process every entry currently on Drive
  for (const driveEntry of driveEntries) {
    const local = localById.get(driveEntry.id)

    if (!local || local.sync_state === 'cloud') {
      // Never imported here, OR imported but never downloaded →
      // Drive is authoritative; keep its entry exactly as-is
      merged.set(driveEntry.id, driveEntry)
    } else if (local.drive_folder_id) {
      // We own this asset (have local files) → write fresh local metadata
      merged.set(driveEntry.id, buildManifestEntry(local))
    }
    // else: local exists, drive_folder_id cleared → explicitly deleted from Drive here → omit
  }

  // Pass 2: add assets that this device owns but aren't in the Drive manifest yet.
  // Cloud-only assets are excluded — if they're not in the Drive manifest it means
  // they were deleted on another device; re-adding them would resurrect a broken entry.
  for (const local of allLocalAssets) {
    if (local.drive_folder_id && local.sync_state !== 'cloud' && !merged.has(local.id)) {
      merged.set(local.id, buildManifestEntry(local))
    }
  }

  const manifest = {
    schema_version: '1.0',
    updated_at: new Date().toISOString(),
    assets: [...merged.values()]
  }

  await client.writeLibraryJson(manifest)
}

// ── Push ─────────────────────────────────────────────────────────────────────

async function pushVersion(versionId, onProgress, { skipManifest = false } = {}) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const version = db.getVersionById(versionId)
  if (!version) throw new Error('Version not found')
  const asset = db.getAssetById(version.asset_id)
  if (!asset) throw new Error('Asset not found')

  // Capture pre-state so we can clean up ONLY what this push created
  const preAssetFolderId   = asset.drive_folder_id || ''
  const preVersionFolderId = version.drive_folder_id || ''
  let assetFolderId, vFolderId, client

  const ctrl = startOp()
  db.updateVersion(versionId, { sync_state: 'syncing' })
  onProgress?.({ state: 'syncing', step: 'Preparing…' })

  try {
    client = new DriveClient(auth)

    // WharfArchive / Category / Asset Name
    const catFolderId = await client.ensureCategoryPath(asset.category || 'Uncategorized')
    if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

    assetFolderId = await client.ensureFolder(asset.name, catFolderId)
    db.updateAsset(asset.id, { drive_folder_id: assetFolderId, drive_orphaned: 0 })
    if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

    // Upload preview (asset-level); capture the Drive file ID
    if (asset.asset_folder) {
      try {
        const dirFiles = fs.readdirSync(asset.asset_folder)
        const previewFile = dirFiles.find(f => f.startsWith('preview.'))
        if (previewFile) {
          onProgress?.({ step: 'Uploading preview…' })
          const previewResult = await client.uploadFileByName(
            path.join(asset.asset_folder, previewFile), assetFolderId
          )
          db.updateAsset(asset.id, { preview_drive_file_id: previewResult.id })
        }
      } catch {}
    }
    if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

    // Version subfolder
    const vFolderName = version.label
      ? `v${version.version_num} - ${version.label}`
      : `v${version.version_num}`
    vFolderId = await client.ensureFolder(vFolderName, assetFolderId)
    if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

    // Upload each file (signal-aware)
    for (let i = 0; i < version.files.length; i++) {
      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      const file = version.files[i]
      if (!file.local_path || !fs.existsSync(file.local_path)) continue
      onProgress?.({ step: `Uploading ${file.file_name} (${i + 1}/${version.files.length})` })
      const driveFile = await client.uploadFile(
        file.local_path, vFolderId, file.drive_file_id || null,
        ({ speedBps }) => onProgress?.({
          step: `Uploading ${file.file_name} (${i + 1}/${version.files.length})`,
          speedBps
        }),
        ctrl.signal
      )
      db.getDb().prepare('UPDATE asset_files SET drive_file_id = ? WHERE id = ?').run(driveFile.id, file.id)
    }

    onProgress?.({ step: 'Writing metadata…' })
    await client.uploadJson(buildVersionMetadata(asset, version), 'metadata.json', vFolderId)

    db.updateVersion(versionId, { drive_folder_id: vFolderId, sync_state: 'synced' })

    if (!skipManifest) {
      try {
        onProgress?.({ step: 'Updating library manifest…' })
        await updateLibraryManifest(client)
      } catch (e) {
        console.error('Manifest update failed:', e.message)
      }
    }

    onProgress?.({ state: 'synced', step: 'Done' })
    return { success: true }
  } catch (err) {
    if (isAbortError(err, ctrl)) {
      onProgress?.({ state: 'cancelling', step: 'Cancelling — cleaning up…' })

      // Roll back what THIS push created so Drive doesn't accumulate orphans.
      // Only delete folders that didn't exist before we started.
      if (client && vFolderId && vFolderId !== preVersionFolderId) {
        try { await client.deleteItem(vFolderId) } catch {}
      }
      if (client && assetFolderId && assetFolderId !== preAssetFolderId) {
        // Only delete the asset folder if no other versions are still on Drive there
        const otherDriveVersions = db.getVersionsByAsset(asset.id)
          .filter(v => v.id !== versionId && v.drive_folder_id)
        if (otherDriveVersions.length === 0) {
          try { await client.deleteItem(assetFolderId) } catch {}
          db.updateAsset(asset.id, { drive_folder_id: preAssetFolderId, preview_drive_file_id: '' })
        }
      }

      // Clear any drive_file_ids we set during partial uploads — they may point to deleted files
      if (vFolderId && vFolderId !== preVersionFolderId) {
        db.getDb().prepare('UPDATE asset_files SET drive_file_id = ? WHERE version_id = ?').run('', versionId)
      }

      db.updateVersion(versionId, { sync_state: preVersionFolderId ? 'error' : 'local' })
      onProgress?.({ state: 'cancelled', step: 'Cancelled' })
      return { success: false, cancelled: true }
    }
    db.updateVersion(versionId, { sync_state: 'error' })
    onProgress?.({ state: 'error', step: err.message })
    throw err
  } finally {
    endOp(ctrl)
  }
}

async function pushAsset(assetId, onProgress) {
  const versions = db.getVersionsByAsset(assetId)
  const results = []
  let cancelled = false
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i]
    onProgress?.({ step: `Pushing v${v.version_num}…`, index: i, total: versions.length })
    try {
      const r = await pushVersion(v.id, onProgress, { skipManifest: true })
      if (r?.cancelled) { cancelled = true; results.push({ id: v.id, success: false, cancelled: true }); break }
      results.push({ id: v.id, success: true })
    } catch (err) {
      results.push({ id: v.id, success: false, error: err.message })
    }
  }
  // Gallery is **not** auto-pushed here — uploads are user-initiated via the
  // Upload button in the AssetDetail gallery section, mirroring how versions
  // require an explicit Upload action.
  // Update manifest once after all versions are pushed — but NOT if cancelled,
  // because the cleanup already ran in pushVersion and we don't want to write
  // a manifest that reflects a half-pushed state.
  if (!cancelled) {
    try {
      const auth = await getAuthClient()
      if (auth) {
        onProgress?.({ step: 'Updating library manifest…' })
        await updateLibraryManifest(new DriveClient(auth))
      }
    } catch (e) {
      console.error('Manifest update failed in pushAsset:', e.message)
    }
  } else {
    onProgress?.({ state: 'cancelled', step: 'Cancelled' })
  }
  return { success: !cancelled, cancelled, results }
}

// ── Pull ─────────────────────────────────────────────────────────────────────

async function pullVersion(versionId, onProgress) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const version = db.getVersionById(versionId)
  if (!version) throw new Error('Version not found')
  if (!version.drive_folder_id) throw new Error('This version has not been pushed to Drive yet.')

  const asset = db.getAssetById(version.asset_id)
  if (!asset) throw new Error('Asset not found')

  // For cloud-only assets, asset_folder is empty (set when imported from Drive
  // manifest). We need to materialize it now so files have somewhere to land —
  // otherwise the download silently no-ops and the version flips to 'synced'
  // with no actual files (only the manifest preview existed in _previews/).
  let assetFolder = asset.asset_folder
  if (!assetFolder) {
    assetFolder = buildAssetFolder(asset)
    fs.mkdirSync(assetFolder, { recursive: true })
    db.updateAsset(asset.id, { asset_folder: assetFolder })
  }
  const localVersionFolder = path.join(assetFolder, `v${version.version_num}`)

  const ctrl = startOp()
  db.updateVersion(versionId, { sync_state: 'syncing' })
  onProgress?.({ state: 'syncing', step: 'Listing Drive files…' })

  try {
    const client = new DriveClient(auth)
    const driveFiles = await client.listFolderFiles(version.drive_folder_id)
    const filesToDownload = driveFiles.filter(f => f.name !== 'metadata.json')

    fs.mkdirSync(localVersionFolder, { recursive: true })

    for (let i = 0; i < filesToDownload.length; i++) {
      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      const df = filesToDownload[i]
      onProgress?.({ step: `Downloading ${df.name} (${i + 1}/${filesToDownload.length})` })
      const destPath = path.join(localVersionFolder, df.name)
      await client.downloadFile(df.id, destPath, ({ speedBps }) => {
        onProgress?.({
          step: `Downloading ${df.name} (${i + 1}/${filesToDownload.length})`,
          speedBps
        })
      }, ctrl.signal)
      const existing = version.files.find(f => f.file_name === df.name || f.drive_file_id === df.id)
      if (existing) {
        db.getDb().prepare('UPDATE asset_files SET drive_file_id = ?, local_path = ? WHERE id = ?')
          .run(df.id, destPath, existing.id)
      } else {
        db.addVersionFiles(versionId, asset.id, [{
          local_path: destPath, file_name: df.name,
          file_type: getFileType(df.name), file_size: parseInt(df.size) || 0, drive_file_id: df.id
        }])
      }
    }

    // Pull preview from Drive asset folder if available
    if (asset.drive_folder_id) {
      try {
        const assetDriveFiles = await client.listFolderFiles(asset.drive_folder_id)
        const previewDriveFile = assetDriveFiles.find(f => f.name.startsWith('preview.'))
        if (previewDriveFile) {
          const previewDest = path.join(assetFolder, previewDriveFile.name)
          onProgress?.({ step: 'Downloading preview…' })
          await client.downloadFile(previewDriveFile.id, previewDest, null, ctrl.signal)
          db.updateAsset(asset.id, { preview_path: previewDest })
        }
      } catch {}
    }

    db.updateVersion(versionId, { sync_state: 'synced' })
    onProgress?.({ state: 'synced', step: 'Done' })
    return { success: true }
  } catch (err) {
    if (isAbortError(err, ctrl)) {
      // downloadFile already deleted the partial file. Other completed files
      // in this version are intact. Mark as error so the user knows it's incomplete.
      db.updateVersion(versionId, { sync_state: 'error' })
      onProgress?.({ state: 'cancelled', step: 'Cancelled' })
      return { success: false, cancelled: true }
    }
    db.updateVersion(versionId, { sync_state: 'error' })
    onProgress?.({ state: 'error', step: err.message })
    throw err
  } finally {
    endOp(ctrl)
  }
}

async function pullAsset(assetId, onProgress) {
  const versions = db.getVersionsByAsset(assetId)
  const results = []
  let cancelled = false
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i]
    onProgress?.({ step: `Pulling v${v.version_num}…`, index: i, total: versions.length })
    try {
      const r = await pullVersion(v.id, onProgress)
      if (r?.cancelled) { cancelled = true; results.push({ id: v.id, success: false, cancelled: true }); break }
      results.push({ id: v.id, success: true })
    } catch (err) {
      results.push({ id: v.id, success: false, error: err.message })
    }
  }
  if (cancelled) onProgress?.({ state: 'cancelled', step: 'Cancelled' })
  return { success: !cancelled, cancelled, results }
}

// ── Import / Refresh from Drive library ──────────────────────────────────────


// Reads library.json from Drive and upserts all assets into the local DB.
// Downloads previews for any asset that doesn't have one yet.
// Works as both initial "Import" and subsequent "Refresh" — upsert logic handles both.
// Pass folderId to read from a specific shared folder instead of the configured one.
async function syncFromDriveLibrary(onProgress, folderId = null) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const client = new DriveClient(auth)

  onProgress?.({ step: 'Reading library manifest from Drive…', current: 0, total: 0 })

  // Resolve the folder to read from:
  //   1. Explicit folderId passed in (friend clicking Import after connecting)
  //   2. Saved connectedFolderId (friend refreshing later)
  //   3. Own root (owner importing their own library on a second device)
  const targetFolderId = folderId || client.getConnectedFolderId() || await client.getRootFolderId()
  const manifest = await client.readLibraryJsonFromFolder(targetFolderId)

  if (!manifest) {
    return {
      success: false,
      error: 'No library.json found in the connected folder.\nIf you are the owner, open Drive Library → Publish to Drive Library.'
    }
  }

  const assets = manifest.assets || []
  let inserted = 0, updated = 0, previewsDownloaded = 0, orphaned = 0

  // ── Detect orphans: local assets that were on Drive but no longer appear
  // in the manifest. Only flag assets that have local files (sync_state !== 'cloud').
  // Cloud-only entries that vanish from the manifest are simply removed/cleaned later.
  const driveAssetIds = new Set(assets.map(a => a.id))
  const allLocalAssets = db.getAssets({})
  for (const local of allLocalAssets) {
    if (
      local.drive_folder_id &&
      local.sync_state !== 'cloud' &&
      !driveAssetIds.has(local.id)
    ) {
      // Drive copy is gone — clear all Drive references and flag as orphaned.
      // The user can push again to re-upload (creating a new Drive folder).
      db.updateAsset(local.id, {
        drive_folder_id: '',
        preview_drive_file_id: '',
        drive_orphaned: 1
      })
      const versions = db.getVersionsByAsset(local.id)
      for (const v of versions) {
        if (v.drive_folder_id) {
          db.updateVersion(v.id, { drive_folder_id: '', sync_state: 'local' })
          db.getDb()
            .prepare('UPDATE asset_files SET drive_file_id = ? WHERE version_id = ?')
            .run('', v.id)
        }
      }
      orphaned++
    }
  }

  for (let i = 0; i < assets.length; i++) {
    const assetData = assets[i]
    onProgress?.({
      step: `Processing "${assetData.name}"…`,
      current: i + 1,
      total: assets.length
    })

    const result = db.upsertAssetFromDrive(assetData)
    if (result === 'inserted') inserted++; else updated++

    // Upsert all versions
    for (const vData of (assetData.versions || [])) {
      db.upsertVersionFromDrive(vData, assetData.id)
    }

    // Replace gallery rows with the manifest version. The manifest is the
    // source of truth — local rows that aren't there were either removed on
    // another device or never synced.
    if (Array.isArray(assetData.gallery)) {
      db.replaceGalleryFromManifest(assetData.id, assetData.gallery)
    }

    // Download preview if we have a Drive file ID and no local preview exists
    if (assetData.preview_drive_file_id) {
      const current = db.getAssetById(assetData.id)
      if (!current.preview_path || !fs.existsSync(current.preview_path)) {
        try {
          onProgress?.({ step: `Downloading preview for "${assetData.name}"…`, current: i + 1, total: assets.length })
          const previewDir = path.join(config.getLibraryPath(), '_previews')
          fs.mkdirSync(previewDir, { recursive: true })
          const ext = assetData.preview_file_name
            ? path.extname(assetData.preview_file_name)
            : '.jpg'
          const previewPath = path.join(previewDir, `${assetData.id}${ext}`)
          await client.downloadFile(assetData.preview_drive_file_id, previewPath)
          db.updateAsset(assetData.id, { preview_path: previewPath })
          previewsDownloaded++
        } catch {}
      }
    }
  }

  return { success: true, inserted, updated, previewsDownloaded, orphaned, total: assets.length }
}

// ── Download asset (full file download) ──────────────────────────────────────

async function downloadAsset(assetId, onProgress) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const asset = db.getAssetById(assetId)
  if (!asset) throw new Error('Asset not found')
  if (!asset.drive_folder_id) throw new Error('Asset has no Drive folder — push it first.')

  const client = new DriveClient(auth)
  const versions = db.getVersionsByAsset(assetId)

  // Create local asset folder
  const assetFolder = buildAssetFolder(asset)
  fs.mkdirSync(assetFolder, { recursive: true })
  db.updateAsset(assetId, { asset_folder: assetFolder })

  const ctrl = startOp()
  onProgress?.({ state: 'downloading', step: 'Starting…' })

  try {
    // Download preview
    try {
      const driveFiles = await client.listFolderFiles(asset.drive_folder_id)
      const previewDriveFile = driveFiles.find(f => f.name.startsWith('preview.'))
      if (previewDriveFile) {
        const previewDest = path.join(assetFolder, previewDriveFile.name)
        onProgress?.({ step: 'Downloading preview…' })
        await client.downloadFile(previewDriveFile.id, previewDest, null, ctrl.signal)
        db.updateAsset(assetId, { preview_path: previewDest })
      }
    } catch (err) { if (isAbortError(err, ctrl)) throw err }

    // Download each version
    for (let vi = 0; vi < versions.length; vi++) {
      if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      const version = versions[vi]
      if (!version.drive_folder_id) continue

      const versionFolder = path.join(assetFolder, `v${version.version_num}`)
      fs.mkdirSync(versionFolder, { recursive: true })

      onProgress?.({
        step: `Downloading v${version.version_num}…`,
        versionIndex: vi,
        versionTotal: versions.length
      })

      const driveFiles = await client.listFolderFiles(version.drive_folder_id)
      const filesToDownload = driveFiles.filter(f => f.name !== 'metadata.json')

      for (let fi = 0; fi < filesToDownload.length; fi++) {
        if (ctrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
        const df = filesToDownload[fi]
        const destPath = path.join(versionFolder, df.name)
        onProgress?.({ step: `Downloading ${df.name} (v${version.version_num}, ${fi + 1}/${filesToDownload.length})` })
        await client.downloadFile(df.id, destPath, ({ speedBps }) => {
          onProgress?.({
            step: `Downloading ${df.name} (v${version.version_num}, ${fi + 1}/${filesToDownload.length})`,
            speedBps
          })
        }, ctrl.signal)

        const existingFile = version.files.find(f => f.file_name === df.name || f.drive_file_id === df.id)
        if (existingFile) {
          db.getDb().prepare('UPDATE asset_files SET local_path = ?, drive_file_id = ? WHERE id = ?')
            .run(destPath, df.id, existingFile.id)
        } else {
          db.addVersionFiles(version.id, assetId, [{
            local_path: destPath, file_name: df.name,
            file_type: getFileType(df.name), file_size: parseInt(df.size) || 0, drive_file_id: df.id
          }])
        }
      }
      db.updateVersion(version.id, { sync_state: 'synced' })
    }

    db.updateAsset(assetId, { asset_folder: assetFolder, sync_state: 'synced' })
    onProgress?.({ state: 'synced', step: 'Download complete' })
    return { success: true }
  } catch (err) {
    if (isAbortError(err, ctrl)) {
      // downloadFile cleaned up its own partial file. Other completed files
      // and version state are intact — they're real, just incomplete.
      onProgress?.({ state: 'cancelled', step: 'Cancelled' })
      return { success: false, cancelled: true }
    }
    throw err
  } finally {
    endOp(ctrl)
  }
}

// ── Delete from Drive ─────────────────────────────────────────────────────────

async function deleteVersionFromDrive(versionId, onProgress) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const version = db.getVersionById(versionId)
  if (!version) throw new Error('Version not found')
  if (!version.drive_folder_id) throw new Error('This version has not been pushed to Drive yet.')

  const asset = db.getAssetById(version.asset_id)
  if (!asset) throw new Error('Asset not found')

  onProgress?.({ state: 'syncing', step: 'Deleting from Drive…' })

  try {
    const client = new DriveClient(auth)
    await client.deleteItem(version.drive_folder_id)

    // Clear Drive references, mark version as local
    db.updateVersion(versionId, { drive_folder_id: '', sync_state: 'local' })
    db.getDb().prepare('UPDATE asset_files SET drive_file_id = \'\' WHERE version_id = ?').run(versionId)

    // Update manifest so other devices stop seeing this version
    try {
      onProgress?.({ step: 'Updating library manifest…' })
      await updateLibraryManifest(client)
    } catch {}

    onProgress?.({ state: 'synced', step: 'Deleted from Drive' })
    return { success: true }
  } catch (err) {
    onProgress?.({ state: 'error', step: err.message })
    throw err
  }
}

async function deleteAssetFromDrive(assetId, onProgress) {
  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const asset = db.getAssetById(assetId)
  if (!asset) throw new Error('Asset not found')
  if (!asset.drive_folder_id) throw new Error('This asset has no Drive folder — it hasn\'t been pushed yet.')

  onProgress?.({ state: 'syncing', step: 'Deleting from Drive…' })

  try {
    const client = new DriveClient(auth)
    await client.deleteItem(asset.drive_folder_id)

    db.updateAsset(assetId, { drive_folder_id: '', preview_drive_file_id: '' })
    const versions = db.getVersionsByAsset(assetId)
    for (const v of versions) {
      db.updateVersion(v.id, { drive_folder_id: '', sync_state: 'local' })
      db.getDb().prepare('UPDATE asset_files SET drive_file_id = \'\' WHERE version_id = ?').run(v.id)
    }
    // Gallery lives inside the asset's Drive folder — already gone with the
    // delete above. Drop the rows so we don't show stale image counts.
    db.clearGalleryForAsset(assetId)

    // Update manifest (asset is now gone from Drive)
    try { await updateLibraryManifest(client) } catch {}

    onProgress?.({ state: 'synced', step: 'Deleted from Drive' })
    return { success: true }
  } catch (err) {
    onProgress?.({ state: 'error', step: err.message })
    throw err
  }
}

// ── Gallery (local-first reference images) ───────────────────────────────────
//
// Up to GALLERY_MAX images per asset. The source of truth is a file in
// `<assetFolder>/gallery/slot-N.<ext>` — viewing reads straight from disk
// for instant display. Drive sync is optional: on add we upload immediately
// if the asset is already on Drive, and the `pushAsset` path uploads any
// stragglers that were saved while local-only. Pulling fills in local
// copies for rows that arrived via manifest refresh from another device.
//
// 1.4.6 had a Drive-only design with a temp folder. That model is gone —
// `local_path` is now the primary handle, `drive_file_id` is auxiliary.

function getAssetGalleryFolder(asset) {
  return asset.asset_folder ? path.join(asset.asset_folder, 'gallery') : null
}

// Materialise the local asset folder if it's missing. Cloud-only assets
// don't have one until we pull something — gallery is no exception. Mirrors
// the same fix used in pullVersion.
function ensureAssetFolder(asset) {
  if (asset.asset_folder && fs.existsSync(asset.asset_folder)) return asset.asset_folder
  const folder = buildAssetFolder(asset)
  fs.mkdirSync(folder, { recursive: true })
  if (!asset.asset_folder) {
    db.updateAsset(asset.id, { asset_folder: folder })
  }
  return folder
}

function ensureLocalGalleryDir(asset) {
  const assetFolder = ensureAssetFolder(asset)
  const dir = path.join(assetFolder, 'gallery')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function validateGallerySource(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('Source file not found.')
  }
  const stat = fs.statSync(sourcePath)
  if (stat.size > GALLERY_MAX_BYTES) {
    throw new Error(`Image is too large (${(stat.size / 1024 / 1024).toFixed(2)} MB). Max 2 MB.`)
  }
  const ext = path.extname(sourcePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    throw new Error('Only PNG / JPG / WebP / GIF / BMP images are allowed.')
  }
  return { stat, ext }
}

// Add a gallery image. Local-only — the row starts in the "not synced" state
// and stays there until the user explicitly clicks Upload (which triggers
// `pushPendingGalleryImages`). This mirrors how `asset_versions` works —
// adding never auto-pushes to Drive.
async function addGalleryImage(assetId, sourcePath) {
  const { stat, ext } = validateGallerySource(sourcePath)

  const asset = db.getAssetById(assetId)
  if (!asset) throw new Error('Asset not found')

  const slot = db.getNextGallerySlot(assetId)
  if (!slot) throw new Error('Gallery is full (3 images max). Remove one first.')

  // Always write a stable name keyed on slot so removing + re-adding doesn't
  // leave stale files of a different extension behind. The original name is
  // kept in the DB row for display purposes.
  const galleryDir = ensureLocalGalleryDir(asset)
  const localName = `slot-${slot}${ext}`
  const localPath = path.join(galleryDir, localName)
  // Defensive: if a stray file with this name exists from a previous run
  // (different ext on the same slot), remove it before copying.
  try {
    for (const e of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']) {
      const stray = path.join(galleryDir, `slot-${slot}${e}`)
      if (stray !== localPath && fs.existsSync(stray)) fs.unlinkSync(stray)
    }
  } catch {}
  fs.copyFileSync(sourcePath, localPath)

  const displayName = path.basename(sourcePath)

  const rowId = db.addGalleryItem({
    asset_id: assetId,
    slot,
    drive_file_id: '',
    local_path: localPath,
    file_name: displayName,
    file_size: stat.size
  })

  return { success: true, id: rowId, slot }
}

// Remove a gallery image. Removes the local file, the Drive file (if any),
// and the DB row. Errors on the Drive side are logged but don't block the
// local removal — we'd rather risk a tiny Drive orphan than leave the user
// with a row they can't delete.
//
// If this was the last gallery row with a Drive copy for the asset, the
// `gallery/` subfolder on Drive is also removed so users don't accumulate
// empty folders after clearing out a gallery.
async function removeGalleryImage(galleryId) {
  const item = db.getGalleryItem(galleryId)
  if (!item) return { success: true } // already gone

  if (item.local_path && fs.existsSync(item.local_path)) {
    try { fs.unlinkSync(item.local_path) } catch {}
  }

  let client = null
  if (item.drive_file_id) {
    try {
      const auth = await getAuthClient()
      if (auth) {
        client = new DriveClient(auth)
        try { await client.deleteItem(item.drive_file_id) } catch {}
      }
    } catch (e) {
      console.error('Gallery Drive delete failed:', e.message)
    }
  }

  db.removeGalleryItem(galleryId)

  // If the row we just deleted had a Drive copy, check whether any
  // gallery rows for this asset still reference Drive. None left → the
  // `gallery/` folder is now empty (or near-empty) and should be removed
  // so the asset's Drive folder doesn't accumulate dead containers.
  if (client && item.drive_file_id) {
    try {
      const asset = db.getAssetById(item.asset_id)
      const remainingOnDrive = db.getGalleryByAsset(item.asset_id)
        .filter(g => g.drive_file_id)
      if (asset?.drive_folder_id && remainingOnDrive.length === 0) {
        const folderId = await client.findFolder('gallery', asset.drive_folder_id)
        if (folderId) {
          try { await client.deleteItem(folderId) } catch {}
        }
      }
      try { await updateLibraryManifest(client) } catch {}
    } catch (e) {
      console.error('Empty gallery folder cleanup failed:', e.message)
    }
  }

  return { success: true }
}

// Pull gallery images from Drive into the local asset folder for any rows
// that have a drive_file_id but no local file on disk. Used both as a
// stand-alone "Pull Gallery" and as part of pulling a cloud-only asset.
async function pullGalleryImages(assetId, onProgress) {
  const items = db.getGalleryByAsset(assetId)
  const missing = items.filter(i =>
    i.drive_file_id && (!i.local_path || !fs.existsSync(i.local_path))
  )
  if (!missing.length) return { success: true, downloaded: 0 }

  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const asset = db.getAssetById(assetId)
  if (!asset) throw new Error('Asset not found')

  const client = new DriveClient(auth)
  const galleryDir = ensureLocalGalleryDir(asset)
  let downloaded = 0

  for (let i = 0; i < missing.length; i++) {
    const item = missing[i]
    onProgress?.({
      step: `Downloading gallery image ${i + 1}/${missing.length}…`,
      current: i + 1,
      total: missing.length
    })
    const ext = path.extname(item.file_name) || '.jpg'
    const dest = path.join(galleryDir, `slot-${item.slot}${ext}`)
    try {
      await client.downloadFile(item.drive_file_id, dest, null, null)
      db.updateGalleryItem(item.id, { local_path: dest })
      downloaded++
    } catch (err) {
      // One bad image shouldn't sink the whole pull — log and continue.
      console.error(`Gallery pull failed for slot ${item.slot}:`, err.message)
    }
  }

  return { success: true, downloaded }
}

// Upload any gallery images that exist locally but haven't reached Drive
// yet. Triggered by the Upload button in AssetDetail's gallery section.
// Refreshes the manifest at the end so other devices see the new images.
async function pushPendingGalleryImages(assetId, onProgress) {
  const asset = db.getAssetById(assetId)
  if (!asset?.drive_folder_id) {
    throw new Error('Upload the asset to Drive before uploading gallery images.')
  }

  const pending = db.getGalleryByAsset(assetId).filter(i =>
    !i.drive_file_id && i.local_path && fs.existsSync(i.local_path)
  )
  if (!pending.length) return { success: true, uploaded: 0 }

  const auth = await getAuthClient()
  if (!auth) throw new Error('Not authenticated with Google Drive. Connect via the Google icon.')

  const client = new DriveClient(auth)
  const galleryFolderId = await client.ensureFolder('gallery', asset.drive_folder_id)
  let uploaded = 0
  const errors = []
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i]
    onProgress?.({
      step: `Uploading gallery image ${i + 1}/${pending.length}…`,
      current: i + 1,
      total: pending.length
    })
    try {
      const driveFile = await client.uploadFile(item.local_path, galleryFolderId, null, null, null)
      db.updateGalleryItem(item.id, { drive_file_id: driveFile.id })
      uploaded++
    } catch (e) {
      console.error(`Gallery push failed for slot ${item.slot}:`, e.message)
      errors.push({ slot: item.slot, error: e.message })
    }
  }

  // Manifest refresh so cross-device devices see the new images
  try { await updateLibraryManifest(client) } catch {}

  return { success: errors.length === 0, uploaded, errors }
}

// ── Metadata helper ───────────────────────────────────────────────────────────

function buildVersionMetadata(asset, version) {
  return {
    assetId: asset.id, assetName: asset.name,
    description: asset.description, category: asset.category,
    tags: asset.tags || [],
    versionId: version.id, versionNum: version.version_num, versionLabel: version.label,
    files: (version.files || []).map(f => ({ name: f.file_name, type: f.file_type, driveId: f.drive_file_id || '' })),
    createdAt: version.created_at, syncedAt: new Date().toISOString(),
    schemaVersion: '3.0.0'
  }
}

module.exports = {
  pushVersion, pushAsset,
  pullVersion, pullAsset,
  syncFromDriveLibrary,
  downloadAsset,
  deleteVersionFromDrive,
  deleteAssetFromDrive,
  cancelAllOps,
  // Gallery (local-first)
  addGalleryImage, removeGalleryImage,
  pullGalleryImages, pushPendingGalleryImages,
  GALLERY_MAX_BYTES
}
