# Wharf Archive — Developer Handover

Local-first 3D/2D asset manager with Google Drive sync. Built as an Electron desktop app.
Originally Blender-only; now multi-application (Blender, Maya, ZBrush, etc. — pickable per asset).
For the current version see `package.json` / [CHANGELOG.md](../CHANGELOG.md).
For setup and building see [BUILDING.md](BUILDING.md); for publishing see [RELEASING.md](RELEASING.md).

This document is a self-contained reference for picking up development cold. It covers
architecture, data model, key components, the sync protocol, IPC contract, and the
non-obvious invariants that have been hard-won through bug fixes.

---

## 1. Overview

**Wharf Archive** lets a small team manage a shared Blender asset library. Assets live
locally as files-on-disk plus a SQLite index. Optionally they sync to a Google Drive
folder so other machines can import the same library.

Key design decisions:

- **Local-first**: every machine has its own SQLite DB and asset folder. Drive is a
  backend, not the source of truth for browsing.
- **Single Drive account model** (the "Access Pack"): one person owns the OAuth credentials
  and storage; collaborators paste an Access Pack and run as that account. Avoids the
  `drive.file` scope's per-account isolation.
- **Manifest-based sync**: a single `library.json` on Drive lists all shared assets.
  Browsing is free (read DB), file operations are explicit (push/pull/download buttons).
- **No automatic background sync**: every operation is user-initiated. Auto-refresh on
  launch is opt-in.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron main process                                      │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌────────────────┐  │
│  │ index   │  │   sync   │  │  auth  │  │ drive          │  │
│  │ (IPC)   │←→│  (push/  │←→│(OAuth) │←→│ (DriveClient)  │  │
│  │         │  │   pull)  │  │        │  │  → googleapis  │  │
│  └─────────┘  └──────────┘  └────────┘  └────────────────┘  │
│       ↕                                                     │
│  ┌─────────┐  ┌──────────┐                                  │
│  │   db    │  │  config  │                                  │
│  │ (SQLite)│  │  (JSON)  │                                  │
│  └─────────┘  └──────────┘                                  │
└─────────────────────────────────────────────────────────────┘
              ↕ contextBridge (preload/index.js)
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React 18)                                        │
│  ┌──────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐            │
│  │ App  │→│ TopBar  │ │ Sidebar  │ │ AssetGrid │            │
│  └──────┘ └─────────┘ └──────────┘ └───────────┘            │
│      ↓                                                      │
│  ┌────────────────┐ ┌────────────────┐ ┌──────────────┐     │
│  │ AssetDetail    │ │ UploadDialog   │ │ Settings     │     │
│  └────────────────┘ └────────────────┘ └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tech stack

| Layer | Library | Notes |
|---|---|---|
| Runtime | Electron 30 | Single window, no remote module |
| Build | electron-vite 2.x | `electron-vite build` outputs to `out/` |
| Packager | electron-builder 24 | Windows x64: NSIS installer + portable EXE. macOS arm64/x64: DMG + zip |
| UI | React 18 (functional + hooks) | No state management library |
| DB | better-sqlite3 9.x | Synchronous, native module, rebuilt on package |
| Drive API | googleapis 140 | OAuth2 + drive.files |
| Markdown | marked 18 | GFM + line-breaks for descriptions |
| IDs | uuid 9 | UUIDv4 for asset/version/file IDs |

Native dependency: `better-sqlite3` is unpacked from asar (`asarUnpack` in package.json)
and rebuilt for Electron's Node version via `electron-builder install-app-deps`.

---

## 4. Project structure

```
src/
├── main/                       Main process (Node.js)
│   ├── index.js                IPC handlers, window mgmt, download queue
│   ├── auth.js                 OAuth flow, credentials/tokens, Access Pack
│   ├── drive.js                DriveClient class wrapping googleapis
│   ├── sync.js                 Push/pull/download/manifest, cancellation
│   ├── db.js                   SQLite schema migrations + queries
│   └── config.js               app-config.json persistence
├── preload/
│   └── index.js                contextBridge → window.api
└── renderer/
    └── src/
        ├── App.jsx             Top-level state + effects
        ├── components/
        │   ├── TopBar.jsx
        │   ├── Sidebar.jsx
        │   ├── AssetGrid.jsx
        │   ├── AssetCard.jsx
        │   ├── AssetDetail.jsx
        │   ├── UploadDialog.jsx
        │   ├── AddVersionDialog.jsx
        │   ├── DriveLibraryModal.jsx
        │   ├── DownloadQueue.jsx
        │   ├── Settings.jsx
        │   └── CategoryIcons.jsx     Shared icon catalog
        ├── styles/
        │   └── globals.css
        └── utils/
            └── format.js             formatSpeed()

scripts/
└── generate-icon.js            Builds build/icon.ico + build/icon.icns before packaging

.github/workflows/build.yml     CI: builds macOS + Windows, drafts GitHub Releases on v* tags
docs/
├── DEVELOPER_GUIDE.md          This file
├── BUILDING.md                 Dev setup + building installers (macOS / Windows)
└── RELEASING.md                Release checklist
package.json                    electron-vite + electron-builder config
```

---

## 5. Data model

### 5.1 SQLite tables (current schema_version = 10)

**`assets`** — one row per asset
```
id                       TEXT PK  (UUID)
name                     TEXT     immutable; never editable in UI (was a renaming bug)
description              TEXT     markdown-rendered in detail view
category                 TEXT     e.g. "Characters" or "Characters/Heroes"
preview_path             TEXT     absolute path to local preview image
asset_folder             TEXT     absolute path to <library>/<category>/<id>/
blender_version          TEXT
poly_count               INTEGER  reserved, not actively used
created_at, updated_at   DATETIME
drive_folder_id          TEXT     Drive folder ID; '' if not pushed
preview_drive_file_id    TEXT     Drive file ID for preview
label                    TEXT     local-only personal alias (v1.1.0+)
starred                  INTEGER  0/1, local-only favorite (v1.1.0+)
drive_orphaned           INTEGER  0/1, set on refresh when Drive copy gone (v1.3.0+)
application              TEXT     software the asset is for; defaults 'Blender' (v1.4.8+)
```

**`asset_versions`** — one row per version
```
id               TEXT PK  (UUID)
asset_id         TEXT FK
version_num      INTEGER
label            TEXT
drive_folder_id  TEXT     Drive subfolder ID; '' if version not pushed
sync_state       TEXT     'local' | 'syncing' | 'synced' | 'cloud' | 'error'
created_at       DATETIME
```

**`asset_files`** — one row per file inside a version
```
id              TEXT PK  (UUID)
asset_id        TEXT FK
version_id      TEXT FK
local_path      TEXT     absolute path or '' for cloud-only
file_name       TEXT
file_size       INTEGER
file_type       TEXT     'blend' | 'mesh' | 'texture' | 'hdr' | 'file'
drive_file_id   TEXT     '' if not yet uploaded
```

**`tags`** + **`asset_tags`** — many-to-many tags.

**`category_icons`** — `(category PK, icon_key)`. Custom icon picked in UploadDialog
when the user creates a custom category. Looked up by Sidebar.

**`application_icons`** — `(application PK, icon_key)`. Created by the v8
migration but **no longer written or read** as of v1.4.8. The table is left
in place so installs don't have to migrate again; treat it as dead schema.

**`asset_gallery`** — up to 3 reference images per asset. **Local-first
since v1.4.8** (the v9 Drive-only design was reverted because viewing
required a slow on-demand download every time).
```
id            INTEGER PK
asset_id      TEXT FK → assets ON DELETE CASCADE
slot          INTEGER  1..3 (unique per asset_id)
drive_file_id TEXT     '' until uploaded
local_path    TEXT     '' until pulled (added in v10)
file_name     TEXT     original picker filename, kept for display
file_size     INTEGER
created_at    DATETIME
```
On-disk layout: `<assetFolder>/gallery/slot-N.<ext>`. Slot-keyed names mean
removing + re-adding never leaves stale extensions behind. 1.4.6 rows
(Drive-only) get `local_path = ''` after the v10 migration; the viewer
lazy-pulls them on first open and writes the path back.

### 5.2 Asset sync state (computed on `getAssets`)

Versions store `sync_state` directly. The asset's effective state is computed from
its versions:

| Computed `sync_state` | Condition |
|---|---|
| `syncing` | any version is `syncing` |
| `error` | any version is `error` (and none syncing) |
| `synced` | all versions are `synced` |
| `cloud` | all versions are `cloud` (imported from Drive, not downloaded) |
| `local` | otherwise |

### 5.3 On-disk layout

```
<library>/
├── library.db
├── _previews/                       previews of cloud-only imported assets
│   └── <asset-id>.jpg
├── Characters/
│   └── <asset-id>/                  asset_folder
│       ├── preview.jpg / .png / .webp
│       ├── metadata.json            human-readable backup of asset+versions
│       ├── v1/
│       │   ├── warrior.blend
│       │   └── warrior_diffuse.png
│       └── v2/
│           └── warrior_v2.blend
└── Props/...
```

`metadata.json` is written by `writeAssetMetadata()` in `main/index.js` for human
readability. The DB is the source of truth.

### 5.4 Drive layout

```
WharfArchive/                        owner's root folder (auto-created)
├── library.json                     manifest (the cross-device index)
├── Characters/
│   └── <asset-name>/                drive_folder_id stored on asset row
│       ├── preview.jpg
│       ├── v1/                      drive_folder_id stored on version row
│       │   ├── warrior.blend
│       │   └── metadata.json        per-version snapshot
│       └── v2/...
```

Custom property on the root folder: `properties.libraryJsonFileId` lets a friend's
machine find `library.json` even when the corpus search doesn't include the file
(see "drive.file scope wall" below).

### 5.5 `library.json` manifest format

```json
{
  "schema_version": "1.0",
  "updated_at": "2026-05-10T12:00:00.000Z",
  "assets": [
    {
      "id": "uuid",
      "name": "Warrior",
      "description": "...",
      "category": "Characters",
      "tags": ["lowpoly", "rigged"],
      "blender_version": "4.2",
      "poly_count": 0,
      "created_at": "...",
      "updated_at": "...",
      "drive_folder_id": "...",
      "preview_drive_file_id": "...",
      "preview_file_name": "preview.jpg",
      "versions": [
        {
          "id": "uuid",
          "version_num": 1,
          "label": "",
          "drive_folder_id": "...",
          "created_at": "...",
          "files": [
            { "file_name": "warrior.blend", "file_size": 1234, "file_type": "blend", "drive_file_id": "..." }
          ]
        }
      ]
    }
  ]
}
```

**`label`, `starred`, and `drive_orphaned` are intentionally NOT in the manifest.**
They are local-only metadata and must never be overwritten by a sync.

**`application`** IS in the manifest (v1.4.8+) so other devices see the same
software for an asset. Older manifests written by pre-1.5 clients have no
`application` field; `upsertAssetFromDrive` falls back to `'Blender'` for
inserts and leaves the column alone on updates so a user's local choice
isn't blown away by a sync from an old client.

---

## 6. Sync model

### 6.1 The Access Pack (auth model)

Reason this exists: Google's `drive.file` OAuth scope is **per app + account**. A file
created by app A using owner's account is invisible to app A using friend's account,
even if the folder is shared. `files.list` won't find it. This makes traditional
"share Drive folder, friend authenticates" sharing impossible.

Solution: the **Access Pack** is a JSON blob `{ credentials, tokens }`.
- Owner generates it via `auth.exportAccessPack()` after they sign in.
- Friend pastes it in the Connect Drive dialog. Their `tokens.json` and
  `credentials.json` are written from the pack.
- All Drive operations on the friend's machine run as the owner's Google account.
- Friend's storage is never touched. Only the owner's quota matters.

`auth.saveCredentials(json)` auto-detects: if `json.credentials && json.tokens`, it's
a pack; otherwise it's a raw credentials.json from Google Cloud Console.

`auth.logout()` (Disconnect button) deletes BOTH `tokens.json` and `credentials.json`,
returning to first-launch state. (v1.4.2 fix; previously kept credentials.)

### 6.2 The OAuth scope

`https://www.googleapis.com/auth/drive.file` only — the app can read/write files it
itself created. It cannot enumerate the user's whole Drive. This is intentional
(privacy) and forces the owner-account model above.

### 6.3 Token expiry

`drive.file` is a non-sensitive scope, so the OAuth app can be **published** without
Google verification. While in Testing mode, refresh tokens expire after 7 days
(causing weekly logouts). Once published in Google Cloud Console, this restriction
is removed. The app is currently published.

### 6.4 Push: local → Drive

`sync.pushVersion(versionId)`:
1. Find/create category folder in Drive (`WharfArchive/<Category>/`)
2. Find/create asset folder, store `drive_folder_id` on asset
3. Upload preview if present
4. Find/create `v<N>` subfolder
5. Upload each file via `drive.uploadFile(localPath, parentId, existingFileId, signal)`
6. Upload `metadata.json` (per-version snapshot)
7. Set version `drive_folder_id`, `sync_state = 'synced'`
8. **Read-merge-write `library.json`** (see 6.6)

`sync.pushAsset(assetId)` calls `pushVersion` per version with `skipManifest: true`,
then writes the manifest once at the end.

**Critical invariant**: the asset's Drive folder name is set on first push and never
changed afterwards (renaming was removed in v1.1.0 to prevent orphaned Drive folders).
The DB asset name is just a display label; the Drive folder identity is stable.

### 6.5 Pull / Download

- `pullVersion(versionId)` — downloads files for a version. If the asset is
  cloud-only (`asset_folder` empty), it materialises the asset folder on the
  fly so a per-version download from a freshly imported library works
  end-to-end. (v1.4.8 fix; previously left `localVersionFolder` null so the
  download silently no-oped and only the manifest preview existed.)
- `pullAsset(assetId)` — pulls every version
- `downloadAsset(assetId)` — used by the queue for "cloud-only" assets that have no local files yet. Creates the asset folder and pulls everything.

All three accept progress callbacks that emit `{ step, speedBps, state }` where
`state` is `'syncing' | 'synced' | 'cancelled' | 'error'`.

### 6.6 Manifest merge (the read → merge → write protocol)

**Why it exists**: a partially-synced PC pushing without merging would overwrite
`library.json` with its incomplete view, erasing entries pushed from another device.

`updateLibraryManifest(client)`:
1. Read current `library.json` from Drive (treat 404 as empty)
2. Build a map keyed by asset UUID
3. **Pass 1** — process every entry currently on Drive:
   - Local row absent OR `sync_state === 'cloud'` → keep Drive entry as-is
     (Drive is authoritative for assets we don't fully own here)
   - Local row has `drive_folder_id` and files → overwrite with fresh local entry
   - Local row has cleared `drive_folder_id` → drop (explicit delete-from-Drive on this PC)
4. **Pass 2** — add local-owned assets not yet in the Drive manifest:
   - Skip cloud-only assets (they were imported, not pushed by us; if they're gone
     from the manifest someone else deleted them on Drive)
5. Write merged result

This protocol is in `sync.js` at `updateLibraryManifest`. Don't break it.

### 6.7 Refresh: Drive → local

`syncFromDriveLibrary()`:
1. Read `library.json`
2. **Detect orphans**: for every local asset with `drive_folder_id` set, files locally
   (`sync_state !== 'cloud'`), and not in the manifest → mark `drive_orphaned = 1`,
   clear all Drive references locally so push creates a fresh folder.
3. For each manifest entry: `db.upsertAssetFromDrive(asset)` + `db.upsertVersionFromDrive(v)`.
4. Download missing previews.

The orphan flag clears automatically inside `pushVersion` when the asset is pushed
again.

### 6.8 Sync state icons (AssetCard)

Defined in `AssetCard.SyncStateIcon`. Priority: orphan > local > synced > cloud.

| State | Icon | Color | Animation |
|---|---|---|---|
| `drive_orphaned = 1` | cloud-with-X | amber | pulsing |
| `sync_state === 'local'` | cloud-with-X | amber | none |
| `sync_state === 'synced'` | cloud-with-check | green | none |
| `sync_state === 'cloud'` | plain cloud | blue | none |
| syncing/error | (none — handled by separate sync-badge) | | |

---

## 7. Cancellation system (v1.4.2+)

`sync.js` maintains `const activeOps = new Set<AbortController>`. Each long-running
op (`pushVersion`, `pullVersion`, `downloadAsset`) calls `startOp()` to register a
controller and `endOp()` in `finally`.

`cancelAllOps()` aborts every active controller.

IPC: `sync:cancelActive` → `sync.cancelAllOps()`.

The signal is threaded through to `drive.uploadFile(..., signal)` and
`drive.downloadFile(..., signal)`. gaxios honors it for HTTP requests; the download
function also subscribes to the signal directly so it can:
- Destroy the response stream
- Destroy the writable stream
- **Delete the partial file from disk** before rejecting

### Cancellation cleanup contracts

**Push cancel** (in `pushVersion` catch block):
- Captures `preAssetFolderId`, `preVersionFolderId` at start
- If a NEW version folder was created during this push: `client.deleteItem(vFolderId)`
- If a NEW asset folder was created AND no other versions of this asset are still on
  Drive: delete it and revert local DB's `drive_folder_id`
- Wipe `drive_file_id` on partially-uploaded files (they may point to deleted files)
- Set version `sync_state` to `'error'` if it was previously synced, `'local'` if fresh

**Pull cancel**: `downloadFile` already cleans the partial local file. Other completed
files in the same op stay (they're real). Version state set to `'error'`.

**Download (queue) cancel**: same as pull. Queue item gets status `'cancelled'`.

**Push cancel does NOT write `library.json`**: in `pushAsset` the manifest update is
gated on `if (!cancelled)` (v1.4.3 fix). Inner `pushVersion` doesn't reach the
manifest line because the cancel exception is thrown before it.

### Renderer behavior on cancel

- `App.jsx` clears `syncProgress` on `state === 'cancelled'` (1.5s delay vs 3s for synced/error)
- All push/pull handlers in `AssetDetail.jsx` check `!result.cancelled` before showing
  an alert (v1.4.3 fix; previously showed "Push failed: undefined")

---

## 8. IPC contract (the `window.api` surface)

All defined in `src/preload/index.js`. The renderer never imports anything from
`main/` directly.

### Assets / DB
```js
getAssets(filter?)              // filter: { search, category, tags[], starred }
addAsset({ asset, tags, files, previewSrc })  → assetId
updateAsset({ id, asset, tags?, previewSrc? })
deleteAsset(id)
getTags()                       // [{ name, count }]
getCategories()                 // string[]
getCategoryIcons()              // [{ category, icon_key }]
setCategoryIcon(category, iconKey)
getApplications()               // string[] — distinct app values from assets
```

### Versions
```js
getVersionsByAsset(assetId)
addVersion({ assetId, label, files })  → { success, versionId } | { success:false, error }
deleteVersion(versionId)
```

### Files / dialogs
```js
openDialog({ multi?, filters? })       // returns string[] | null
openPreviewDialog()                    // image picker
selectFolder({ title })                // string | null
getFileInfo(path)                      // { exists, size, name }
previewUrl(path)                       // base64 data: URL or null
startDrag(assetId, filePaths[])        // OS-level drag-out (used in AssetDetail)
clipboardImage()                       // tmp PNG path or null
showAssetContextMenu(folder, name)     // right-click → "Open in Explorer"
openExternal(url)                      // open in default browser (https/http/mailto only)
```

### Auth
```js
authStatus()                    // { hasCredentials, isAuthenticated, credentialsPath }
login()                         // OAuth dance via local HTTP callback on :42813
logout()                        // wipes BOTH tokens.json AND credentials.json
saveCredentials(json)           // raw JSON or Access Pack
exportDriveAccessPack()         // → { success, pack: {credentials, tokens} }
```

### Settings / config
```js
getConfig()                     // { libraryPath, dbPath, isDefault, autoRefresh }
setLibraryPath(folder)          // switch to new library, resetDb()
importLibrary(folder)           // open existing library.db
setAutoRefresh(bool)
```

### Sync
```js
pushVersion(id) / pushAsset(id)         // → { success, cancelled?, error? }
pullVersion(id) / pullAsset(id)
deleteFromDrive(assetId)
deleteVersionFromDrive(versionId)
importDriveLibrary({ folderId? })       // alias of refresh; UI uses refresh only now
refreshDriveLibrary()                   // → { success, inserted, updated, previewsDownloaded, orphaned, total }
cancelSync()                            // aborts every active op
```

### Gallery (v1.4.8+)
```js
galleryList(assetId)                    // [{ id, slot, drive_file_id, local_path, file_name, file_size }]
galleryPickImage()                      // { path, size, name, oversize } | null  (image-only file picker)
galleryPasteFromClipboard()             // same shape; writes the clipboard image to a tmp PNG and returns its path
galleryAdd(assetId, sourcePath)         // copies to <assetFolder>/gallery/, no Drive upload
galleryRemove(galleryId)                // deletes local file + Drive file + DB row
galleryPushPending(assetId)             // uploads every row that has local_path but no drive_file_id
galleryPullMissing(assetId)             // downloads every row that has drive_file_id but no local_path
onGalleryPushProgress(cb)               // { step, current, total }
onGalleryPullProgress(cb)               // { step, current, total }
```
2 MB hard cap is enforced renderer-side (preflight via `galleryPickImage` /
`galleryPasteFromClipboard`) and main-side (authoritative check in
`addGalleryImage`). On-Drive layout: `<asset>/gallery/<original-name>`. The
viewer reads images directly from the local disk (instant); cloud-only
items are shown as placeholders, with a hint pointing at the Download
button in AssetDetail — there is **no auto-pull**.

**Sync model mirrors versions** (since v1.4.8): adding a gallery image
never auto-uploads. The user clicks **Upload** in the gallery section to
push pending rows (`galleryPushPending`) and **Download** to pull
cloud-only rows (`galleryPullMissing`). Per-slot sync state badge —
`Not synced` / `Synced` / `Cloud` / `Syncing…` — is computed in the
renderer from `local_path` / `drive_file_id` plus the in-flight action.

### Download queue
```js
queueDownload(assetId, assetName)
getDownloadQueue()
clearDoneDownloads()
```

### Events (renderer subscribes; returns unsubscribe fn)
```js
onSyncProgress(cb)              // { step, speedBps, state, ... }
onImportProgress(cb)            // { step, current, total }
onDownloadQueueUpdate(cb)       // full queue array
onAssetDownloaded(cb)           // { assetId }
onLibraryChanged(cb)            // library switch event
```

---

## 9. Main-process modules

### Single-instance lock (`main/index.js`, top of file)

`app.requestSingleInstanceLock()` runs before any lifecycle registration.
A second launch attempt finds the lock held, calls `app.quit()`, and never
gets past module init — no IPC handlers, no DB connection, no OAuth port
:42813 collision. The primary instance receives a `'second-instance'` event
and brings its existing window to the front. This is what stops two
SQLite handles from racing on the same library and corrupting WAL state.
(Added v1.4.8.)

### `auth.js`
- OAuth2 flow: opens system browser to Google's consent URL, runs a local HTTP server
  on port 42813 to catch the redirect, exchanges code for tokens.
- `getAuthClient()` — lazy-init OAuth2Client; returns `null` if creds or tokens missing.
- `saveCredentials(json)` — accepts raw or Access Pack form.
- `exportAccessPack()` — read-only; throws if not signed in.
- `logout()` — wipes both files (full reset).

### `drive.js` — `class DriveClient`
Methods used by sync:
- `ensureCategoryPath(name)` / `ensureFolder(name, parent)` — find or create
- `uploadFile(localPath, parentId, existingFileId?, onProgress?, signal?)` — returns
  `{ id, name }`. The progress callback receives `{ pct, bytes, total, speedBps }`.
- `downloadFile(fileId, destPath, onProgress?, signal?)` — auto-cleans partial files on abort.
- `uploadJson(obj, name, parentId)` / `uploadFileByName(localPath, parentId)`
- `listFolderFiles(folderId)` / `getRootFolderId()` / `getActiveFolderId()`
- `readLibraryJson()` / `writeLibraryJson(obj)` — uses folder property
  `libraryJsonFileId` to locate the manifest reliably across share boundaries.
- `deleteItem(fileId)` — **idempotent**: swallows 404. (v1.3.1 fix; previously
  threw "File not found" when the user deleted a manifest-listed asset whose
  folder was already gone on Drive.)

### `sync.js`
Public exports: `pushVersion, pushAsset, pullVersion, pullAsset, syncFromDriveLibrary,
downloadAsset, deleteVersionFromDrive, deleteAssetFromDrive, cancelAllOps`.

Internal helpers:
- `buildManifestEntry(asset)` — serializes one asset for `library.json`
- `updateLibraryManifest(client)` — read → merge → write
- `startOp()` / `endOp()` / `cancelAllOps()` / `isAbortError()`
- `buildVersionMetadata(asset, version)` — for per-version `metadata.json`

### `db.js`
Schema migrations live in `initSchema()`, gated by `db.pragma('user_version')`.

Migration history:
- **v1**: initial tables (assets, asset_files, tags, asset_tags)
- **v2**: `asset_versions` table + `version_id` on `asset_files`; existing assets get
  an auto v1 row
- **v3**: `assets.asset_folder` column
- **v4**: `assets.preview_drive_file_id` column
- **v5**: `assets.label` and `assets.starred`
- **v6**: `assets.drive_orphaned`
- **v7**: `category_icons` table
- **v8**: `assets.application` column (default `'Blender'`, backfilled for existing
  rows) + `application_icons` table
- **v9**: `asset_gallery` table for up to 3 Drive-only reference images per asset
- **v10**: `asset_gallery.local_path` (gallery becomes local-first); rebuilds
  the table to drop the `NOT NULL` constraint on `drive_file_id`

Important queries:
- `getAssets(filter)` — supports `search`, `category` (LIKE prefix), `tags` (must
  match all), `starred`. Computes `sync_state` from versions.
- `upsertAssetFromDrive(data)` — never touches `label`, `starred`, or `drive_orphaned`.
- `upsertVersionFromDrive(data, assetId)`

`MAX_VERSIONS = 10` (defined in 3 places — `main/index.js`, `AssetDetail.jsx`,
`AddVersionDialog.jsx`).

### `config.js`
Reads/writes `<userData>/app-config.json`. Keys currently used:
- `libraryPath` — falls back to `userData` when unset
- `autoRefresh` — bool, default false

---

## 10. Renderer components

### `App.jsx` — global state owner
- `assets`, `tags`, `categories`, `categoryIcons`, `authStatus`, `syncProgress`, `downloadQueue`, `selectedAsset`, `selectedCategory`, `selectedTags`, `showStarred`, `search`
- `loadAssets()` and `loadMeta()` are the cache-refresh primitives
- `buildFilter()` builds the filter object passed to `getAssets`
- `handleAssetUpdate()` re-fetches both filtered AND unfiltered (so detail panel
  stays open even if asset no longer matches current filter — e.g. un-starred while
  in Starred view)
- Auto-refresh effect: runs once per session when authenticated, if `cfg.autoRefresh`

### `TopBar.jsx`
- Search bar with `#tag` autocomplete suggestion overlay (absolute-positioned, doesn't
  shift layout). Tag suggestions use `flex-wrap: nowrap; overflow: hidden` to silently
  drop overflow.
- Sync toast: shows current step + speed pill + cancel ✕
- Auth modal: 3 mutually-exclusive states (authenticated → export pack / disconnect;
  no creds → paste credentials/Access Pack; has creds → sign in with Google)

### `Sidebar.jsx`
- Browse: All Assets / Starred filter
- Categories: built-in + custom; uses shared `CategoryIcon` with `categoryIcons` map
  (custom icons looked up by category name)
- Tags: list with selection + "Clear (N)" button (visible only when ≥1 selected)

### `AssetCard.jsx`
- Thumbnail, sync badge, download button (cloud-only), star overlay, sync-state icon
  overlay (`SyncStateIcon`), label subtitle

### `AssetDetail.jsx` (largest)
Versions of complexity:
- Per-version action buttons are labelled **Upload** (push) and **Download**
  (pull) since v1.4.8; internal IPC names still use push/pull for backward
  compatibility.
- Star toggle in header, name is read-only (renaming removed in v1.1.0)
- Inline label input in left panel (auto-saves on blur)
- Tags & description editable via Edit mode; description renders markdown via
  `marked.parse()` with a click handler that intercepts `<a>` clicks and routes them
  to `window.api.openExternal` (so they open in default browser, not Electron)
- Push All / Pull All in header (Push first to mirror per-version order)
- Per-version card with: Push (disabled if `v.sync_state === 'cloud'`), Pull
  (disabled if `!v.drive_folder_id`), Delete-from-Drive (only shown when
  `v.drive_folder_id` exists), Delete-local (trash). All push/pull handlers check
  `!result.cancelled` before alerting on failure.
- Add Version button (disabled at `MAX_VERSIONS`)
- Files inside each version are draggable (`window.api.startDrag`) — for dropping
  into Blender etc.

### `UploadDialog.jsx`
- Drag-and-drop OR Add Files button (no file-type filter; accepts anything)
- Preview from file picker, paste-from-clipboard, or auto-detected from dropped images
- Tag suggestions: fixed-height row, shows existing tags matching the last
  comma-segment. Tab applies first suggestion; Enter commits; Escape clears.
- Custom category branch shows a 6-column icon picker (from `CategoryIcons.PICKER_ICONS`)
  and persists via `setCategoryIcon` after asset creation.
- Application dropdown (v1.4.8+) mirrors the category dropdown: presets
  ("Blender", "Maya", "3ds Max", "ZBrush", etc.) plus a Custom… option that
  reveals a text field. Custom apps appear in the dropdown on subsequent
  uploads via `getAllApplications()` (`SELECT DISTINCT application FROM
  assets`). No icons — the application is rendered as plain text. Default
  selection is `Blender` to keep historical behaviour for users only working
  with Blender.

### `DriveLibraryModal.jsx`
- Single "Sync from Drive" card (Import was merged with Refresh in v1.4.0;
  `importDriveLibrary` IPC kept for backward compat but unused by UI).
- Shows progress bar, count, and result stats including orphan count.

### `DownloadQueue.jsx`
- Bottom-right floating widget. Items have status badges: pending / downloading /
  done / error / cancelled. Downloading rows show speed pill + cancel ✕.

### `Settings.jsx`
- Library folder switching/import
- Sync preferences: Auto-refresh on launch toggle
- Folder structure docs (informational)

### `CategoryIcons.jsx` — shared icon catalog
- `ICON_PATHS`: `{ key → SVG path d-attribute }`
- `PICKER_ICONS`: list of keys shown in the icon picker
- `ICON_LABELS`: tooltips
- `resolveIconKey(name, overrideKey)` — override > built-in name match (case-insensitive,
  uses category prefix before `/`) > `default`
- Default export: `<CategoryIcon name? iconKey? size strokeWidth />`

### `utils/format.js`
- `formatSpeed(bytesPerSec)` — `B/s` / `KB/s` / `MB/s` / `GB/s`, returns `''` for 0/null

---

## 11. Critical invariants (read before refactoring)

These are bug-driven rules. Breaking them causes user-visible regressions.

1. **`drive.file` scope means each Google account has its own file corpus.**
   Sharing folders between accounts doesn't make files visible to a different
   account's app session. Hence the Access Pack model.

2. **The Drive folder name for an asset is set on first push and never changes.**
   The DB asset name is purely a display label. (Renaming UI was removed in v1.1.0
   to prevent orphaned Drive folders on rename.)

3. **`label`, `starred`, `drive_orphaned` are local-only.** Never serialize them
   into `library.json`. Never overwrite them in `upsertAssetFromDrive`.

4. **`updateLibraryManifest` MUST be read-merge-write.** Never just write local
   state directly — that erases entries pushed by other devices. See section 6.6.

5. **Cloud-only assets are not "owned" by this PC.** During manifest merge, treat
   the Drive entry as authoritative (Pass 1 keeps it as-is). Don't re-add them in
   Pass 2 if missing — if they're missing, someone deleted them on Drive.

6. **`deleteItem` swallows 404.** Required for the manifest-but-no-folder case
   (asset deleted from Drive externally).

7. **Cancellation cleanup is the developer's responsibility per op.** When adding a
   new long-running operation, call `startOp()`, thread `signal` through, and write
   the cleanup branch. Tests for the contract: no orphan Drive folders, no partial
   local files, no DB rows pointing to deleted Drive IDs.

8. **`pushAsset` skips the manifest update on cancel.** Don't put unconditional
   `updateLibraryManifest()` calls in cancellable paths.

9. **Push button must be disabled when `version.sync_state === 'cloud'`** —
   uploading nothing creates corrupted Drive entries (v1.2.4 fix).

10. **DB writes happen AFTER successful Drive ops, not before.** Specifically: on
    download, only update `drive_file_id`/`local_path` after the file completes.
    A canceled download therefore leaves DB consistent automatically.

11. **The `name` field on assets is immutable from the UI.** Don't add a name input
    to AssetDetail edit mode without first solving the rename-causes-Drive-orphan
    problem.

12. **Gallery is local-first with manual sync (since v1.4.8).** Source of
    truth is `<assetFolder>/gallery/slot-N.<ext>`. Adding an image **never**
    touches Drive — the row is created with `drive_file_id = ''` and stays
    that way until the user clicks Upload, which calls
    `pushPendingGalleryImages`. Likewise downloads from Drive are only
    triggered by the user clicking Download (`pullGalleryImages`). The
    GalleryViewer **does not auto-pull** — cloud-only items show a
    placeholder. This mirrors how `asset_versions` work: never auto-sync,
    always explicit. `removeGalleryImage` always wipes the local file
    regardless of Drive state — losing a Drive deletion is a smaller
    disaster than a row the user can't get rid of.

    Cascade rules: `ON DELETE CASCADE` clears rows on full asset delete; the
    demote-to-cloud path keeps Drive-backed rows but blanks their
    `local_path` (the wipe of `<assetFolder>` removed the files; viewer will
    re-pull) and drops rows without a Drive ID (those were local-only and
    are now gone for good); `deleteAssetFromDrive` explicitly clears all
    rows since the Drive folder is gone.

13. **Deleting a Drive-synced asset locally must NOT remove its DB row.**
    `db:deleteAsset` demotes the asset to cloud-only state instead (clears
    `asset_folder`, moves preview to `_previews/`, flips Drive-backed
    versions to `sync_state = 'cloud'`, deletes local-only versions). Only
    assets without a `drive_folder_id` get fully deleted. Returns
    `{ success, demoted }` so the renderer can decide whether to close the
    detail panel. (v1.4.8 fix; previously the row was dropped outright,
    making the asset disappear from the library while still existing on
    Drive until the next refresh.)

---

## 12. Build & run

```bash
# Install (same on macOS and Windows; see BUILDING.md for why --ignore-scripts)
npm install --ignore-scripts
npm run setup              # Electron binary + prebuilt better-sqlite3 for Electron

# Dev (electron-vite hot reload)
npm run dev

# Package installers (must run on the target OS)
npm run package -- --win   # dist/Wharf-Archive-X.Y.Z-win-x64-Setup.exe + -Portable.exe
npm run package -- --mac   # dist/Wharf-Archive-X.Y.Z-mac-{arm64,x64}.dmg + .zip

# Rebuild native modules manually if needed
npm run rebuild
```

`package.json` `build` config does:
- Unpacks `better-sqlite3` and `bindings` from asar (native module requirement)
- Builds NSIS installer (one-click false → user picks install dir + creates
  Desktop/Start Menu shortcut)
- Builds portable target and macOS DMG/zip for both architectures, all named
  `Wharf-Archive-<version>-<platform>-<arch>` (no spaces, so GitHub keeps the names)

Full details and troubleshooting: [BUILDING.md](BUILDING.md).

Versioning convention: patch for fixes, minor for features, no major bumps yet.
Releases are built by GitHub Actions when a `vX.Y.Z` tag is pushed. See [RELEASING.md](RELEASING.md).

---

## 13. Common workflows / gotchas

### Adding a new IPC handler
1. Define handler in `src/main/index.js` `registerIPC()`
2. Expose in `src/preload/index.js`
3. Use as `window.api.yourMethod()` in renderer

### Adding a new DB column
1. Bump `schemaVer` in `db.js` and add an `if (schemaVer < N)` block with
   `ALTER TABLE` + `db.pragma('user_version = N')`
2. Update `getAssets`/`getAssetById` if you want it returned
3. **Decide if it's local-only** — if yes, exclude from `buildManifestEntry` AND
   from `upsertAssetFromDrive`

### Debugging a sync issue
1. Check `db.getAssets({})` to see DB state
2. Check actual Drive folder contents in browser
3. Read `library.json` directly from Drive (open it in browser)
4. Compare with the merge rules in section 6.6

### Hot-reload doesn't pick up main-process changes
`electron-vite dev` only hot-reloads renderer. For main/preload changes, kill and
restart `npm run dev`. SQLite locks may persist briefly between runs; if you get
"database is locked", wait 1–2 seconds.

---

## 14. Roadmap / planned ideas

(From conversation history; nothing committed.)

- **Pre-emptive token refresh + invalid_grant detection** — even with the app
  published, refresh tokens can die from revocation, password change, 6-month
  inactivity. Currently the user just sees errors. A wrapper around `getAuthClient`
  could catch `invalid_grant`, prompt re-auth, retry the original op.
- **Resume cancelled pushes** — currently cancel deletes the partial Drive folder.
  An alternative is to mark the version as "partial" and let the user resume,
  uploading only files whose `drive_file_id` is empty.
- **Per-asset auto-sync** — opt-in flag to push on save / pull on launch for
  specific assets.
- **Search by file name** — currently searches name + description, not file names
  inside versions.
- **Batch operations** — multi-select assets in the grid for bulk push/delete.

---

## 15. Quick reference for "where is X"

| Concept | File |
|---|---|
| Manifest merge logic | `src/main/sync.js` → `updateLibraryManifest` |
| Cancellation registry | `src/main/sync.js` → top of file |
| OAuth callback server | `src/main/auth.js` → `authenticate` |
| Access Pack | `src/main/auth.js` → `exportAccessPack`, `saveCredentials` |
| DB migrations | `src/main/db.js` → `initSchema` |
| Sync state computation | `src/main/db.js` → `getAssets` row map |
| Speed tracking | `src/main/drive.js` → `uploadFile`, `downloadFile` |
| Sync icon priority | `src/renderer/src/components/AssetCard.jsx` → `SyncStateIcon` |
| Tag autocomplete | `src/renderer/src/components/UploadDialog.jsx` (lines around `suggestions`) |
| Search `#tag` overlay | `src/renderer/src/components/TopBar.jsx` |
| Markdown link external-open | `src/renderer/src/components/AssetDetail.jsx` `md-content` onClick |
| Auto-refresh on launch | `src/renderer/src/App.jsx` (the autoRefreshDone effect) |
| MAX_VERSIONS constant | 3 places: `main/index.js`, `AssetDetail.jsx`, `AddVersionDialog.jsx` |
