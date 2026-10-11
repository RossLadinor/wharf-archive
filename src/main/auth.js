const { app, shell } = require('electron')
const { google } = require('googleapis')
const http = require('http')
const path = require('path')
const fs = require('fs')

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const TOKEN_PATH = path.join(app.getPath('userData'), 'tokens.json')
const CREDS_PATH = path.join(app.getPath('userData'), 'credentials.json')
const REDIRECT_PORT = 42813

let oAuth2Client = null

function getCredentials() {
  if (!fs.existsSync(CREDS_PATH)) return null
  try { return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')) } catch { return null }
}

function saveCredentials(credsJson) {
  // Accept either a plain credentials.json  OR  an Access Pack { credentials, tokens }
  if (credsJson.credentials && credsJson.tokens) {
    fs.writeFileSync(CREDS_PATH, JSON.stringify(credsJson.credentials, null, 2))
    saveTokens(credsJson.tokens)
    oAuth2Client = null   // force re-init on next getAuthClient()
  } else {
    fs.writeFileSync(CREDS_PATH, JSON.stringify(credsJson, null, 2))
  }
}

function exportAccessPack() {
  const creds = getCredentials()
  const tokens = loadTokens()
  if (!creds) throw new Error('No credentials found.')
  if (!tokens) throw new Error('Not signed in to Google Drive yet. Sign in first, then export.')
  return { credentials: creds, tokens }
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) } catch { return null }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))
}

function clearTokens() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH)
  oAuth2Client = null
}

function clearCredentials() {
  if (fs.existsSync(CREDS_PATH)) fs.unlinkSync(CREDS_PATH)
  oAuth2Client = null
}

function createOAuthClient(credentials) {
  const src = credentials.installed || credentials.web
  return new google.auth.OAuth2(src.client_id, src.client_secret, `http://localhost:${REDIRECT_PORT}/callback`)
}

async function getAuthClient() {
  if (oAuth2Client) return oAuth2Client
  const creds = getCredentials()
  if (!creds) return null
  const tokens = loadTokens()
  if (!tokens) return null
  const client = createOAuthClient(creds)
  client.setCredentials(tokens)
  client.on('tokens', (fresh) => {
    if (fresh.refresh_token) saveTokens({ ...tokens, ...fresh })
  })
  oAuth2Client = client
  return client
}

async function authenticate() {
  const creds = getCredentials()
  if (!creds) throw new Error('No credentials found. Add credentials.json in Settings first.')

  const client = createOAuthClient(creds)
  const authUrl = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' })

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
      if (u.pathname !== '/callback') return

      const code = u.searchParams.get('code')
      const error = u.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<html><body style="background:#1a1a1f;color:#e8e8f0;font-family:sans-serif;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <h2 style="margin-top:16px">Connected! You can close this tab.</h2>
        </body></html>`)
      server.close()

      if (error) return reject(new Error(error))
      try {
        const { tokens } = await client.getToken(code)
        client.setCredentials(tokens)
        saveTokens(tokens)
        oAuth2Client = client
        resolve({ success: true })
      } catch (err) { reject(err) }
    })

    server.listen(REDIRECT_PORT, () => shell.openExternal(authUrl))
    server.on('error', reject)
    setTimeout(() => { server.close(); reject(new Error('Auth timeout after 2 minutes')) }, 120000)
  })
}

function getAuthStatus() {
  return {
    hasCredentials: !!getCredentials(),
    isAuthenticated: !!(getCredentials() && loadTokens()),
    credentialsPath: CREDS_PATH
  }
}

// Full reset — wipes both tokens and credentials so the app returns to its
// first-launch "no Drive set up" state.
function logout() {
  clearTokens()
  clearCredentials()
  return { success: true }
}

module.exports = { getAuthClient, authenticate, getAuthStatus, logout, saveCredentials, exportAccessPack, CREDS_PATH }
