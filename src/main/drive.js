const { google } = require('googleapis')
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(app.getPath('userData'), 'drive-config.json')

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {}
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) } catch { return {} }
}
function saveConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)) }

const MIME_MAP = {
  '.blend': 'application/octet-stream', '.fbx': 'application/octet-stream',
  '.obj':   'application/octet-stream', '.glb': 'model/gltf-binary',
  '.gltf':  'model/gltf+json',          '.hdr': 'application/octet-stream',
  '.exr':   'application/octet-stream', '.png': 'image/png',
  '.jpg':   'image/jpeg',               '.jpeg': 'image/jpeg',
  '.webp':  'image/webp',               '.json': 'application/json',
  '.tga':   'application/octet-stream', '.bmp':  'image/bmp',
  '.abc':   'application/octet-stream', '.zip':  'application/zip'
}

// Extract a Drive folder ID from a URL or return the string as-is if it looks like a raw ID.
// Handles: https://drive.google.com/drive/folders/ID
//          https://drive.google.com/drive/u/0/folders/ID
//          bare IDs
function parseFolderId(input) {
  if (!input) return null
  const trimmed = input.trim()
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : trimmed
}

class DriveClient {
  constructor(auth) {
    this.drive = google.drive({ version: 'v3', auth })
    this.config = loadConfig()
  }

  // ── Own library root ────────────────────────────────────────────────────────

  async getRootFolderId() {
    if (this.config.rootFolderId) return this.config.rootFolderId
    const id = await this.ensureFolder('WharfArchive', 'root')
    this.config.rootFolderId = id
    saveConfig(this.config)
    return id
  }

  // ── Shared / connected library folder ──────────────────────────────────────

  // The folder ID used when importing someone else's library.
  // If null, the user's own WharfArchive root is used.
  getConnectedFolderId() {
    return this.config.connectedFolderId || null
  }

  setConnectedFolderId(idOrUrl) {
    const id = parseFolderId(idOrUrl)
    this.config.connectedFolderId = id || null
    saveConfig(this.config)
    return id
  }

  clearConnectedFolder() {
    delete this.config.connectedFolderId
    saveConfig(this.config)
  }

  // Returns the active library root: connected (shared) folder if set, own WharfArchive otherwise.
  // This makes push/pull work against the shared folder when the user is a collaborator.
  async getActiveFolderId() {
    return this.getConnectedFolderId() || await this.getRootFolderId()
  }

  // ── Folder helpers ──────────────────────────────────────────────────────────

  async ensureFolder(name, parentId) {
    const existing = await this.findFolder(name, parentId)
    if (existing) return existing

    const folder = await this.drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true
    })
    return folder.data.id
  }

  // Lookup-only counterpart to ensureFolder. Returns the folder ID if a child
  // by that name exists under `parentId`, or null otherwise — never creates.
  // Used by the gallery cleanup path so we don't accidentally re-create a
  // folder we're trying to delete.
  async findFolder(name, parentId) {
    const safeName = name.replace(/'/g, "\\'")
    const res = await this.drive.files.list({
      q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    })
    return res.data.files[0]?.id || null
  }

  async ensureCategoryPath(categoryStr) {
    const segments = (categoryStr || 'Uncategorized').split('/').map(s => s.trim()).filter(Boolean)
    let id = await this.getActiveFolderId()
    for (const seg of segments) id = await this.ensureFolder(seg, id)
    return id
  }

  // ── Upload ──────────────────────────────────────────────────────────────────

  async uploadFile(localPath, parentId, existingFileId, onProgress, signal) {
    const name = path.basename(localPath)
    const ext = path.extname(name).toLowerCase()
    const mime = MIME_MAP[ext] || 'application/octet-stream'
    const size = fs.statSync(localPath).size

    // Speed tracker: smoothed bytes/sec via 200 ms sampling window.
    let prevBytes = 0, prevTime = Date.now(), lastSpeed = 0
    const progressCb = evt => {
      if (!onProgress) return
      const bytes = evt.bytesRead
      const now = Date.now()
      const dt = now - prevTime
      if (dt >= 200) {
        lastSpeed = ((bytes - prevBytes) * 1000) / dt
        prevBytes = bytes
        prevTime  = now
      }
      onProgress({ pct: size > 0 ? bytes / size : 0, bytes, total: size, speedBps: lastSpeed })
    }

    // Bail early if already aborted
    if (signal?.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e }

    if (existingFileId) {
      try {
        const res = await this.drive.files.update({
          fileId: existingFileId,
          media: { mimeType: mime, body: fs.createReadStream(localPath) },
          fields: 'id, name',
          supportsAllDrives: true
        }, { onUploadProgress: progressCb, signal })
        return res.data
      } catch (err) {
        if (err.code !== 404 && err.status !== 404) throw err
      }
    }

    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType: mime, body: fs.createReadStream(localPath) },
      fields: 'id, name',
      supportsAllDrives: true
    }, { onUploadProgress: progressCb, signal })
    return res.data
  }

  async uploadFileByName(localPath, parentId) {
    const name = path.basename(localPath)
    await this._deleteByName(name, parentId)
    const ext = path.extname(name).toLowerCase()
    const mime = MIME_MAP[ext] || 'application/octet-stream'
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType: mime, body: fs.createReadStream(localPath) },
      fields: 'id, name',
      supportsAllDrives: true
    })
    return res.data
  }

  // ── Library manifest ────────────────────────────────────────────────────────

  async writeLibraryJson(data) {
    const rootId = await this.getActiveFolderId()
    const fileId = await this.uploadJson(data, 'library.json', rootId)
    // Stamp the file ID onto the folder as a custom property.
    // files.get(folderId, fields='properties') works for any user with folder access,
    // even when files.list corpus search wouldn't find the file (shared-with-me scenario).
    try {
      await this.drive.files.update({
        fileId: rootId,
        requestBody: { properties: { libraryJsonFileId: fileId } },
        supportsAllDrives: true
      })
    } catch {}
    return fileId
  }

  // Read library.json from a specific folder.
  // Strategy 1 (reliable for shared-with-me folders): read the file ID stored in the
  //   folder's custom properties via files.get, then fetch the file by ID.
  // Strategy 2 (fallback for own-drive folders or legacy): files.list name search.
  async readLibraryJsonFromFolder(folderId) {
    let fileId = null

    // Strategy 1 — folder property (works across share boundaries)
    try {
      const folder = await this.drive.files.get({
        fileId: folderId,
        fields: 'properties',
        supportsAllDrives: true
      })
      fileId = folder.data.properties?.libraryJsonFileId || null
    } catch {}

    // Strategy 2 — corpus search (own drive fallback / first-time before property is set)
    if (!fileId) {
      try {
        const res = await this.drive.files.list({
          q: `name='library.json' and '${folderId}' in parents and trashed=false`,
          fields: 'files(id)',
          spaces: 'drive',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        })
        fileId = res.data.files?.[0]?.id || null
      } catch {}
    }

    if (!fileId) return null

    // Download by file ID — always works as long as the user has file access
    try {
      const content = await this.drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
      )
      return JSON.parse(Buffer.from(content.data).toString('utf8'))
    } catch (err) {
      // File ID is stale (e.g. library.json was replaced) — signal not found
      if (err.response?.status === 404 || err.code === 404) return null
      throw err
    }
  }

  // Read library.json — uses connectedFolderId if set, otherwise own root.
  async readLibraryJson() {
    const folderId = await this.getActiveFolderId()
    return this.readLibraryJsonFromFolder(folderId)
  }

  async uploadJson(data, name, parentId) {
    const { Readable } = require('stream')
    await this._deleteByName(name, parentId)
    const res = await this.drive.files.create({
      requestBody: { name, parents: [parentId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: Readable.from(JSON.stringify(data, null, 2)) },
      fields: 'id',
      supportsAllDrives: true
    })
    return res.data.id
  }

  // ── Download ────────────────────────────────────────────────────────────────

  // List all non-folder files inside a Drive folder (works for shared folders too).
  async listFolderFiles(folderId) {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, size)',
      spaces: 'drive',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    })
    return res.data.files || []
  }

  // Download a Drive file to a local path (works for shared files too).
  async downloadFile(fileId, destPath, onProgress, signal) {
    if (signal?.aborted) { const e = new Error('Aborted'); e.name = 'AbortError'; throw e }
    const res = await this.drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', signal }
    )
    const total = parseInt(res.headers?.['content-length'] || '0', 10)
    let bytes = 0, prevBytes = 0, prevTime = Date.now(), lastSpeed = 0

    return new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destPath)
      let aborted = false

      const cleanupPartial = () => {
        try { dest.destroy() } catch {}
        try { res.data.destroy() } catch {}
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath) } catch {}
      }

      const onAbort = () => {
        if (aborted) return
        aborted = true
        cleanupPartial()
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      }

      if (signal) {
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }

      if (onProgress) {
        res.data.on('data', chunk => {
          bytes += chunk.length
          const now = Date.now()
          const dt = now - prevTime
          if (dt >= 200) {
            lastSpeed = ((bytes - prevBytes) * 1000) / dt
            prevBytes = bytes
            prevTime  = now
          }
          onProgress({ pct: total > 0 ? bytes / total : 0, bytes, total, speedBps: lastSpeed })
        })
      }
      res.data.pipe(dest)
      dest.on('finish', () => {
        if (!aborted) {
          if (signal) signal.removeEventListener?.('abort', onAbort)
          resolve()
        }
      })
      dest.on('error', err => { if (!aborted) reject(err) })
      res.data.on('error', err => { if (!aborted) reject(err) })
    })
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async deleteItem(fileId) {
    try {
      await this.drive.files.delete({ fileId, supportsAllDrives: true })
    } catch (err) {
      // 404 = already gone; deletion is idempotent so treat as success.
      // Anything else (permission, network, etc.) bubbles up.
      const status = err?.code || err?.response?.status
      const msg = err?.message || ''
      if (status === 404 || /File not found/i.test(msg)) return
      throw err
    }
  }

  async _deleteByName(name, parentId) {
    try {
      const res = await this.drive.files.list({
        q: `name='${name}' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      })
      await Promise.all(res.data.files.map(f => this.drive.files.delete({ fileId: f.id, supportsAllDrives: true })))
    } catch {}
  }
}

module.exports = { DriveClient }
