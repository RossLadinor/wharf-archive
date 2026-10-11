const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const CONFIG_FILE = path.join(app.getPath('userData'), 'app-config.json')

let _config = null

function load() {
  if (_config) return _config
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch {}
  if (!_config) _config = {}
  return _config
}

function save(updates) {
  _config = { ...load(), ...updates }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2))
  return _config
}

// Where the library DB and previews live.
// Falls back to userData so the app works on first launch with no config.
function getLibraryPath() {
  return load().libraryPath || app.getPath('userData')
}

function getDbPath() {
  return path.join(getLibraryPath(), 'library.db')
}

function getPreviewsDir() {
  return path.join(getLibraryPath(), 'previews')
}

module.exports = { load, save, getLibraryPath, getDbPath, getPreviewsDir }
