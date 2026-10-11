const Database = require('better-sqlite3')
const { v4: uuidv4 } = require('uuid')
const path = require('path')
const fs = require('fs')
const config = require('./config')

let db

function getDb() {
  if (db) return db
  const dbPath = config.getDbPath()
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

function resetDb() {
  if (db) { try { db.close() } catch {} db = null }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      description          TEXT DEFAULT '',
      category             TEXT DEFAULT '',
      preview_path         TEXT DEFAULT '',
      preview_drive_file_id TEXT DEFAULT '',
      asset_folder         TEXT DEFAULT '',
      drive_folder_id      TEXT DEFAULT '',
      sync_state           TEXT DEFAULT 'local',
      blender_version      TEXT DEFAULT '',
      poly_count           INTEGER DEFAULT 0,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
      tag_id   INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS asset_files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id      TEXT REFERENCES assets(id) ON DELETE CASCADE,
      version_id    TEXT,
      local_path    TEXT NOT NULL,
      drive_file_id TEXT DEFAULT '',
      file_type     TEXT DEFAULT 'blend',
      file_name     TEXT NOT NULL,
      file_size     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS asset_versions (
      id              TEXT PRIMARY KEY,
      asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      version_num     INTEGER NOT NULL,
      label           TEXT DEFAULT '',
      drive_folder_id TEXT DEFAULT '',
      sync_state      TEXT DEFAULT 'local',
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `)

  const schemaVer = db.pragma('user_version', { simple: true })

  if (schemaVer < 2) {
    const cols = db.pragma('table_info(asset_files)').map(c => c.name)
    if (!cols.includes('version_id')) {
      db.exec(`ALTER TABLE asset_files ADD COLUMN version_id TEXT;`)
    }

    const unversioned = db.prepare(`
      SELECT a.* FROM assets a
      LEFT JOIN asset_versions av ON av.asset_id = a.id
      WHERE av.id IS NULL
    `).all()

    const insertVer = db.prepare(`
      INSERT INTO asset_versions (id, asset_id, version_num, label, drive_folder_id, sync_state)
      VALUES (?, ?, 1, 'Initial', ?, ?)
    `)
    const linkFiles = db.prepare(`
      UPDATE asset_files SET version_id = ? WHERE asset_id = ? AND (version_id IS NULL OR version_id = '')
    `)

    db.transaction(() => {
      for (const asset of unversioned) {
        const vid = uuidv4()
        insertVer.run(vid, asset.id, asset.drive_folder_id || '', asset.sync_state || 'local')
        linkFiles.run(vid, asset.id)
      }
    })()

    db.pragma('user_version = 2')
  }

  if (schemaVer < 3) {
    const assetCols = db.pragma('table_info(assets)').map(c => c.name)
    if (!assetCols.includes('asset_folder')) {
      db.exec(`ALTER TABLE assets ADD COLUMN asset_folder TEXT DEFAULT '';`)
    }
    db.pragma('user_version = 3')
  }

  if (schemaVer < 4) {
    const assetCols = db.pragma('table_info(assets)').map(c => c.name)
    if (!assetCols.includes('preview_drive_file_id')) {
      db.exec(`ALTER TABLE assets ADD COLUMN preview_drive_file_id TEXT DEFAULT '';`)
    }
    db.pragma('user_version = 4')
  }

  if (schemaVer < 5) {
    const assetCols = db.pragma('table_info(assets)').map(c => c.name)
    if (!assetCols.includes('label')) {
      db.exec(`ALTER TABLE assets ADD COLUMN label TEXT DEFAULT '';`)
    }
    if (!assetCols.includes('starred')) {
      db.exec(`ALTER TABLE assets ADD COLUMN starred INTEGER DEFAULT 0;`)
    }
    db.pragma('user_version = 5')
  }

  if (schemaVer < 6) {
    const assetCols = db.pragma('table_info(assets)').map(c => c.name)
    if (!assetCols.includes('drive_orphaned')) {
      db.exec(`ALTER TABLE assets ADD COLUMN drive_orphaned INTEGER DEFAULT 0;`)
    }
    db.pragma('user_version = 6')
  }

  if (schemaVer < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS category_icons (
        category TEXT PRIMARY KEY,
        icon_key TEXT NOT NULL
      );
    `)
    db.pragma('user_version = 7')
  }

  if (schemaVer < 8) {
    // Adds an "application" field to assets (which software made the asset —
    // Blender, Maya, etc.). Default 'Blender' so existing assets keep their
    // historical assumption. Mirrors the category_icons pattern: a separate
    // table holds custom icon keys for user-added applications.
    const assetCols = db.pragma('table_info(assets)').map(c => c.name)
    if (!assetCols.includes('application')) {
      db.exec(`ALTER TABLE assets ADD COLUMN application TEXT DEFAULT 'Blender';`)
      // SQLite ALTER TABLE ADD COLUMN with DEFAULT only applies the default
      // to *new* rows on some older versions. Backfill existing rows so they
      // are explicitly tagged 'Blender' (no NULLs floating around).
      db.exec(`UPDATE assets SET application = 'Blender' WHERE application IS NULL OR application = '';`)
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS application_icons (
        application TEXT PRIMARY KEY,
        icon_key TEXT NOT NULL
      );
    `)
    db.pragma('user_version = 8')
  }

  if (schemaVer < 9) {
    // Gallery — up to 3 reference images per asset. v9 was a Drive-only
    // experiment; v10 makes them local-first (see below). The CREATE here
    // matches the v9 columns; v10 adds local_path on top so 1.4.6 installs
    // upgrade cleanly.
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_gallery (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        slot          INTEGER NOT NULL,
        drive_file_id TEXT NOT NULL,
        file_name     TEXT NOT NULL,
        file_size     INTEGER DEFAULT 0,
        created_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_asset_gallery_asset ON asset_gallery(asset_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_gallery_slot ON asset_gallery(asset_id, slot);
    `)
    db.pragma('user_version = 9')
  }

  if (schemaVer < 10) {
    // Gallery is now local-first (mirrors how asset_files works): the source
    // of truth is a file in `<assetFolder>/gallery/`, and Drive sync is
    // optional. Add local_path so we can read images directly from disk
    // instead of round-tripping through a temp folder.
    //
    // 1.4.6 rows have a drive_file_id but no local copy; their local_path
    // starts empty and gets populated on first view via a lazy pull.
    const cols = db.pragma('table_info(asset_gallery)').map(c => c.name)
    if (!cols.includes('local_path')) {
      db.exec(`ALTER TABLE asset_gallery ADD COLUMN local_path TEXT DEFAULT '';`)
    }
    // drive_file_id was NOT NULL in v9; with local-first uploads happening
    // after the local copy is saved, we need to allow rows where drive_file_id
    // is empty until the asset is pushed. SQLite can't drop NOT NULL via
    // ALTER, so rebuild the table.
    const tableInfo = db.pragma('table_info(asset_gallery)')
    const driveCol = tableInfo.find(c => c.name === 'drive_file_id')
    if (driveCol && driveCol.notnull) {
      db.exec(`
        CREATE TABLE asset_gallery_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          slot          INTEGER NOT NULL,
          drive_file_id TEXT DEFAULT '',
          local_path    TEXT DEFAULT '',
          file_name     TEXT NOT NULL,
          file_size     INTEGER DEFAULT 0,
          created_at    TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO asset_gallery_new (id, asset_id, slot, drive_file_id, local_path, file_name, file_size, created_at)
          SELECT id, asset_id, slot, drive_file_id, local_path, file_name, file_size, created_at FROM asset_gallery;
        DROP TABLE asset_gallery;
        ALTER TABLE asset_gallery_new RENAME TO asset_gallery;
        CREATE INDEX IF NOT EXISTS idx_asset_gallery_asset ON asset_gallery(asset_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_gallery_slot ON asset_gallery(asset_id, slot);
      `)
    }
    db.pragma('user_version = 10')
  }
}

// ── Assets ──────────────────────────────────────────────────────────────────

function insertAsset(asset) {
  getDb().prepare(`
    INSERT INTO assets (id, name, description, category, application, preview_path, asset_folder, blender_version, poly_count)
    VALUES (@id, @name, @description, @category, @application, @preview_path, @asset_folder, @blender_version, @poly_count)
  `).run({ application: 'Blender', ...asset })
}

function updateAsset(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE assets SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id })
}

function deleteAsset(id) {
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(id)
}

function getAssets(filter = {}) {
  let query = `
    SELECT a.*,
      GROUP_CONCAT(DISTINCT t.name) as tags_raw,
      COUNT(DISTINCT av.id) as version_count,
      COUNT(DISTINCT ag.id) as gallery_count,
      MAX(CASE WHEN av.sync_state = 'syncing' THEN 1 ELSE 0 END) as _has_syncing,
      MAX(CASE WHEN av.sync_state = 'error'   THEN 1 ELSE 0 END) as _has_error,
      MIN(CASE WHEN av.sync_state = 'synced'  THEN 1 ELSE 0 END) as _all_synced,
      MIN(CASE WHEN av.sync_state = 'cloud'   THEN 1 ELSE 0 END) as _all_cloud
    FROM assets a
    LEFT JOIN asset_tags at2 ON a.id = at2.asset_id
    LEFT JOIN tags t ON at2.tag_id = t.id
    LEFT JOIN asset_versions av ON av.asset_id = a.id
    LEFT JOIN asset_gallery ag ON ag.asset_id = a.id
    WHERE 1=1
  `
  const params = []

  if (filter.search) {
    query += ` AND (a.name LIKE ? OR a.description LIKE ?)`
    params.push(`%${filter.search}%`, `%${filter.search}%`)
  }
  if (filter.category) {
    query += ` AND a.category LIKE ?`
    params.push(`${filter.category}%`)
  }
  if (filter.starred) {
    query += ` AND a.starred = 1`
  }
  if (filter.tags && filter.tags.length > 0) {
    query += ` AND a.id IN (
      SELECT at3.asset_id FROM asset_tags at3
      JOIN tags t3 ON at3.tag_id = t3.id
      WHERE t3.name IN (${filter.tags.map(() => '?').join(',')})
      GROUP BY at3.asset_id HAVING COUNT(DISTINCT t3.name) = ?
    )`
    params.push(...filter.tags, filter.tags.length)
  }

  query += ` GROUP BY a.id ORDER BY a.updated_at DESC`

  return getDb().prepare(query).all(...params).map(row => {
    let syncState = 'local'
    if (row._has_syncing)  syncState = 'syncing'
    else if (row._has_error) syncState = 'error'
    else if (row._all_synced && row.version_count > 0) syncState = 'synced'
    else if (row._all_cloud  && row.version_count > 0) syncState = 'cloud'

    return {
      ...row,
      tags: row.tags_raw ? row.tags_raw.split(',').filter(Boolean) : [],
      sync_state: syncState,
      version_count: row.version_count || 0,
      gallery_count: row.gallery_count || 0
    }
  })
}

function getAssetById(id) {
  const row = getDb().prepare(`
    SELECT a.*, GROUP_CONCAT(DISTINCT t.name) as tags_raw
    FROM assets a
    LEFT JOIN asset_tags at2 ON a.id = at2.asset_id
    LEFT JOIN tags t ON at2.tag_id = t.id
    WHERE a.id = ?
    GROUP BY a.id
  `).get(id)
  if (!row) return null
  return { ...row, tags: row.tags_raw ? row.tags_raw.split(',').filter(Boolean) : [] }
}

// ── Versions ─────────────────────────────────────────────────────────────────

function getVersionsByAsset(assetId) {
  const versions = getDb().prepare(
    `SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version_num DESC`
  ).all(assetId)
  return versions.map(v => ({
    ...v,
    files: getDb().prepare(
      `SELECT * FROM asset_files WHERE version_id = ? ORDER BY file_type, file_name`
    ).all(v.id)
  }))
}

function getVersionById(id) {
  const row = getDb().prepare('SELECT * FROM asset_versions WHERE id = ?').get(id)
  if (!row) return null
  return { ...row, files: getDb().prepare('SELECT * FROM asset_files WHERE version_id = ?').all(id) }
}

function getVersionCount(assetId) {
  return getDb().prepare('SELECT COUNT(*) as cnt FROM asset_versions WHERE asset_id = ?').get(assetId)?.cnt || 0
}

function getNextVersionNum(assetId) {
  const row = getDb().prepare('SELECT MAX(version_num) as mx FROM asset_versions WHERE asset_id = ?').get(assetId)
  return (row?.mx || 0) + 1
}

function addVersion({ id, asset_id, version_num, label }) {
  getDb().prepare(`
    INSERT INTO asset_versions (id, asset_id, version_num, label, sync_state)
    VALUES (?, ?, ?, ?, 'local')
  `).run(id, asset_id, version_num, label || '')
}

function updateVersion(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE asset_versions SET ${fields} WHERE id = @id`).run({ ...updates, id })
}

function deleteVersion(id) {
  getDb().prepare('DELETE FROM asset_versions WHERE id = ?').run(id)
}

// ── Files ────────────────────────────────────────────────────────────────────

function addVersionFiles(versionId, assetId, files) {
  const stmt = getDb().prepare(`
    INSERT INTO asset_files (asset_id, version_id, local_path, file_type, file_name, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  files.forEach(f => stmt.run(assetId, versionId, f.local_path, f.file_type || 'file', f.file_name, f.file_size || 0))
}

// ── Drive cloud library upserts ──────────────────────────────────────────────

// Insert or update an asset from a Drive library manifest entry.
// Preserves local paths and sync_state if the asset is already downloaded.
function upsertAssetFromDrive({ id, name, description, category, application, tags, blender_version, poly_count,
  created_at, updated_at, drive_folder_id, preview_drive_file_id, preview_file_name }) {
  const existing = getDb().prepare('SELECT id, sync_state FROM assets WHERE id = ?').get(id)
  // Older manifests don't carry an "application" field — fall back to 'Blender'
  // so we don't end up with empty values. For updates of existing rows we leave
  // the column alone unless the manifest provides a value, so a user's local
  // change isn't blown away by a sync from an old client.
  const app = application || 'Blender'
  if (!existing) {
    getDb().prepare(`
      INSERT INTO assets
        (id, name, description, category, application, preview_drive_file_id, asset_folder, drive_folder_id,
         sync_state, blender_version, poly_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, 'cloud', ?, ?, ?, ?)
    `).run(id, name, description || '', category || '', app, preview_drive_file_id || '',
           drive_folder_id || '', blender_version || '', poly_count || 0, created_at, updated_at)
    if (tags?.length) setAssetTags(id, tags)
    return 'inserted'
  }
  // Update Drive metadata; keep local file paths and sync_state intact.
  // Only overwrite `application` when the manifest actually carries it.
  if (application) {
    getDb().prepare(`
      UPDATE assets SET
        name = ?, description = ?, category = ?, application = ?,
        drive_folder_id = ?, preview_drive_file_id = ?,
        blender_version = ?, poly_count = ?, updated_at = ?
      WHERE id = ?
    `).run(name, description || '', category || '', application,
           drive_folder_id || '', preview_drive_file_id || '',
           blender_version || '', poly_count || 0, updated_at, id)
  } else {
    getDb().prepare(`
      UPDATE assets SET
        name = ?, description = ?, category = ?,
        drive_folder_id = ?, preview_drive_file_id = ?,
        blender_version = ?, poly_count = ?, updated_at = ?
      WHERE id = ?
    `).run(name, description || '', category || '',
           drive_folder_id || '', preview_drive_file_id || '',
           blender_version || '', poly_count || 0, updated_at, id)
  }
  if (tags?.length) setAssetTags(id, tags)
  return 'updated'
}

// Insert or update a version from a Drive library manifest entry.
function upsertVersionFromDrive({ id, version_num, label, drive_folder_id, created_at, files }, assetId) {
  const existing = getDb().prepare('SELECT id FROM asset_versions WHERE id = ?').get(id)
  if (!existing) {
    getDb().prepare(`
      INSERT INTO asset_versions (id, asset_id, version_num, label, drive_folder_id, sync_state, created_at)
      VALUES (?, ?, ?, ?, ?, 'cloud', ?)
    `).run(id, assetId, version_num, label || '', drive_folder_id || '', created_at)
    if (files?.length) {
      const stmt = getDb().prepare(`
        INSERT INTO asset_files (asset_id, version_id, local_path, drive_file_id, file_type, file_name, file_size)
        VALUES (?, ?, '', ?, ?, ?, ?)
      `)
      files.forEach(f => stmt.run(assetId, id, f.drive_file_id || '', f.file_type || 'file', f.file_name, f.file_size || 0))
    }
  } else {
    getDb().prepare('UPDATE asset_versions SET drive_folder_id = ? WHERE id = ?')
      .run(drive_folder_id || '', id)
    // Refresh drive_file_id for existing file records
    if (files?.length) {
      const upd = getDb().prepare('UPDATE asset_files SET drive_file_id = ? WHERE version_id = ? AND file_name = ?')
      files.forEach(f => { if (f.drive_file_id) upd.run(f.drive_file_id, id, f.file_name) })
    }
  }
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function upsertTags(names) {
  const stmt = getDb().prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  names.forEach(n => stmt.run(n))
}

function setAssetTags(assetId, tagNames) {
  const clean = tagNames.map(t => t.trim().toLowerCase()).filter(Boolean)
  upsertTags(clean)
  getDb().prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId)
  if (!clean.length) return
  const tagIds = getDb().prepare(
    `SELECT id FROM tags WHERE name IN (${clean.map(() => '?').join(',')})`
  ).all(...clean)
  const stmt = getDb().prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)')
  tagIds.forEach(({ id }) => stmt.run(assetId, id))
}

function getAllTags() {
  // INNER JOIN ensures we only return tags that are actually attached to at least one asset.
  // Orphaned tag rows in the tags table (left behind after asset deletion) are excluded.
  return getDb().prepare(`
    SELECT t.name, COUNT(at2.asset_id) as count
    FROM tags t
    INNER JOIN asset_tags at2 ON t.id = at2.tag_id
    GROUP BY t.id ORDER BY count DESC
  `).all()
}

function getAllCategories() {
  return getDb().prepare(
    `SELECT DISTINCT category FROM assets WHERE category != '' ORDER BY category`
  ).all().map(r => r.category)
}

// Distinct application values currently used by any asset. Custom apps
// only persist after the first asset using them is saved (no separate
// icon registry any more).
function getAllApplications() {
  return getDb().prepare(
    `SELECT DISTINCT application FROM assets WHERE application != '' AND application IS NOT NULL ORDER BY application`
  ).all().map(r => r.application)
}

// ── Category icons ──────────────────────────────────────────────────────────

function setCategoryIcon(category, iconKey) {
  if (!category || !iconKey) return
  getDb().prepare(`
    INSERT INTO category_icons (category, icon_key) VALUES (?, ?)
    ON CONFLICT(category) DO UPDATE SET icon_key = excluded.icon_key
  `).run(category, iconKey)
}

function getCategoryIcons() {
  return getDb().prepare(`SELECT category, icon_key FROM category_icons`).all()
}

// ── Gallery ──────────────────────────────────────────────────────────────────

const GALLERY_MAX = 3

function getGalleryByAsset(assetId) {
  return getDb().prepare(
    `SELECT * FROM asset_gallery WHERE asset_id = ? ORDER BY slot ASC`
  ).all(assetId)
}

function getGalleryItem(id) {
  return getDb().prepare(`SELECT * FROM asset_gallery WHERE id = ?`).get(id)
}

// First free slot 1..3 for a given asset, or null if all three are taken.
function getNextGallerySlot(assetId) {
  const used = new Set(
    getDb().prepare(`SELECT slot FROM asset_gallery WHERE asset_id = ?`).all(assetId).map(r => r.slot)
  )
  for (let s = 1; s <= GALLERY_MAX; s++) if (!used.has(s)) return s
  return null
}

function addGalleryItem({ asset_id, slot, drive_file_id, local_path, file_name, file_size }) {
  const result = getDb().prepare(`
    INSERT INTO asset_gallery (asset_id, slot, drive_file_id, local_path, file_name, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(asset_id, slot, drive_file_id || '', local_path || '', file_name, file_size || 0)
  return result.lastInsertRowid
}

function updateGalleryItem(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
  getDb().prepare(`UPDATE asset_gallery SET ${fields} WHERE id = @id`).run({ ...updates, id })
}

function removeGalleryItem(id) {
  getDb().prepare(`DELETE FROM asset_gallery WHERE id = ?`).run(id)
}

function clearGalleryForAsset(assetId) {
  getDb().prepare(`DELETE FROM asset_gallery WHERE asset_id = ?`).run(assetId)
}

// Replace an asset's gallery rows with the manifest-supplied list. Used by
// upsertAssetFromDrive when refreshing from Drive. Preserves local_path on
// rows that match by drive_file_id so we don't lose the local cache for
// images this device has already pulled.
function replaceGalleryFromManifest(assetId, items) {
  const tx = getDb().transaction((rows) => {
    // Snapshot current local paths keyed by drive_file_id for survival
    const currentByDriveId = new Map(
      getDb().prepare(`SELECT drive_file_id, local_path FROM asset_gallery WHERE asset_id = ?`)
        .all(assetId)
        .filter(r => r.drive_file_id)
        .map(r => [r.drive_file_id, r.local_path])
    )
    getDb().prepare(`DELETE FROM asset_gallery WHERE asset_id = ?`).run(assetId)
    const insert = getDb().prepare(`
      INSERT INTO asset_gallery (asset_id, slot, drive_file_id, local_path, file_name, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const r of rows) {
      const preservedLocal = r.drive_file_id ? (currentByDriveId.get(r.drive_file_id) || '') : ''
      insert.run(assetId, r.slot, r.drive_file_id || '', preservedLocal, r.file_name || '', r.file_size || 0)
    }
  })
  tx(items || [])
}

module.exports = {
  getDb, resetDb,
  insertAsset, updateAsset, deleteAsset, getAssets, getAssetById,
  getVersionsByAsset, getVersionById, getVersionCount, getNextVersionNum,
  addVersion, updateVersion, deleteVersion,
  addVersionFiles,
  upsertAssetFromDrive, upsertVersionFromDrive,
  setAssetTags, getAllTags, getAllCategories, getAllApplications,
  setCategoryIcon, getCategoryIcons,
  GALLERY_MAX,
  getGalleryByAsset, getGalleryItem, getNextGallerySlot,
  addGalleryItem, updateGalleryItem, removeGalleryItem, clearGalleryForAsset,
  replaceGalleryFromManifest
}
