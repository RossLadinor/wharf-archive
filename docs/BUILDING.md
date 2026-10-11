# Building Wharf Archive

This guide covers running Wharf Archive from source and building installers on
**macOS** and **Windows**. If you just want to use the app, download it from the
[Releases page](../README.md#download) instead.

- [Prerequisites](#prerequisites)
- [Run in development](#run-in-development)
- [Build installers](#build-installers)
- [How the build works](#how-the-build-works)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Both platforms need **Node.js 20 or newer** (22 LTS recommended, which CI uses) and
**git**. Wharf Archive uses `better-sqlite3`, a native module. Normally a prebuilt binary
is downloaded, but if none matches your setup it is compiled locally. That needs
Python 3 and a C++ toolchain, so install them up front.

### macOS

| Tool | How to install |
|---|---|
| Xcode Command Line Tools (C++ compiler, git, Python 3) | `xcode-select --install` |
| Node.js 22 LTS | Installer from <https://nodejs.org>, or `brew install node@22` |

Check it worked:

```bash
node -v
python3 --version
git --version
```

### Windows

| Tool | How to install |
|---|---|
| Node.js 22 LTS | Installer from <https://nodejs.org>. On the "Tools for Native Modules" page, tick **"Automatically install the necessary tools"**. That installs Python and the Visual Studio Build Tools for you. |
| Git for Windows | <https://git-scm.com/download/win> |

If you skipped the Node "native tools" checkbox, install manually:

- **Python 3** from <https://www.python.org/downloads/>. Tick "Add python.exe to PATH".
- **Visual Studio Build Tools** from <https://visualstudio.microsoft.com/visual-cpp-build-tools/>,
with the **"Desktop development with C++"** workload.

Use **PowerShell**, **Windows Terminal** or **Git Bash** for the commands below.

---

## Run in development

```bash
git clone https://github.com/RossLadinor/wharf-archive.git
cd wharf-archive
npm install
npm run rebuild   # compile better-sqlite3 for Electron (re-run after Electron upgrades)
npm run dev       # start the app with hot reload
```

On later runs, `npm run dev` is all you need. Re-run `npm install && npm run rebuild`
after pulling changes to `package.json` or `package-lock.json`.

> Renderer (React) changes hot-reload instantly. Changes to `src/main/` restart the
> Electron process automatically. If something seems stale, stop with Ctrl+C and run
> `npm run dev` again.

---

## Build installers

Installers can only be built **on the platform they target**. You need a Mac for the
macOS build and a Windows PC for the Windows build. The GitHub Actions workflow does both
for you on every push (see [RELEASING.md](RELEASING.md)), so building locally is only
needed for testing.

### macOS

```bash
npm run package -- --mac
```

Output in `dist/`:

| File | What |
|---|---|
| `Wharf-Archive-<version>-mac-arm64.dmg` | Apple Silicon installer |
| `Wharf-Archive-<version>-mac-x64.dmg` | Intel installer |
| `Wharf-Archive-<version>-mac-arm64.zip` / `-x64.zip` | Zipped `.app`, same contents |
| `mac-arm64/Wharf Archive.app`, `mac/Wharf Archive.app` | Unpacked apps, handy for quick testing |

### Windows

```bash
npm run package -- --win
```

Output in `dist/`:

| File | What |
|---|---|
| `Wharf-Archive-<version>-win-x64-Setup.exe` | NSIS installer (user picks install folder, creates shortcuts) |
| `Wharf-Archive-<version>-win-x64-Portable.exe` | Single portable executable, no install |
| `win-unpacked/` | Unpacked app, handy for quick testing |

### Just compile, don't package

```bash
npm run build     # bundles main/preload/renderer into out/ without making an installer
npm run preview   # run the compiled bundle
```

---

## How the build works

| Step | Tool | Notes |
|---|---|---|
| `scripts/generate-icon.js` | plain Node | Regenerates `build/icon.ico` and `build/icon.icns` from code. No extra deps. |
| `electron-vite build` | electron-vite 2 | Bundles `src/main`, `src/preload`, `src/renderer` into `out/` |
| `electron-builder` | electron-builder 24 | Rebuilds `better-sqlite3` for each target arch, then packages. Config is the `build` section of `package.json`. |

`better-sqlite3` is unpacked from the asar archive (`asarUnpack`), because native
`.node` files can't be loaded from inside an asar.

### Code signing

By default, builds are **unsigned**. The app works, but users see a one-time security
prompt (see [Installing](../README.md#installing)). To sign locally, set these
before `npm run package`:

| Platform | Environment variables |
|---|---|
| macOS | `CSC_LINK` (path or base64 of a *Developer ID Application* `.p12`), `CSC_KEY_PASSWORD` |
| Windows | `CSC_LINK` (path or base64 of a code-signing `.pfx`), `CSC_KEY_PASSWORD` |

To skip signing on a Mac that has certificates in its keychain, set
`CSC_IDENTITY_AUTO_DISCOVERY=false`. For signing in CI, see [RELEASING.md](RELEASING.md#optional-code-signing).

---

## Troubleshooting

**`Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version`**

Run `npm run rebuild`. This happens after `npm install` or an Electron upgrade, because
`npm install` builds the module for system Node, not Electron.

**`gyp ERR! find Python` / `Could not find any Python installation`**

Install Python 3 (see prerequisites). On Windows, make sure it's on PATH, or point
node-gyp at it in PowerShell before installing: `$env:PYTHON = "C:\Path\To\python.exe"`.

**`gyp ERR! find VS` (Windows)**

Install Visual Studio Build Tools with the "Desktop development with C++" workload.

**`xcrun: error: invalid active developer path` (macOS)**

Run `xcode-select --install`.

**macOS: "Wharf Archive is damaged and can't be opened"**

This happens to unsigned apps that were downloaded with a quarantine flag, mostly from zips.
Clear the flag: `xattr -cr "/Applications/Wharf Archive.app"`.

**Windows: `EPERM` / file-in-use errors during `npm run package`**

Close any running Wharf Archive instance and any Explorer window open on `dist/`, then retry.

**Building macOS on Windows (or the reverse)**

Not supported. Use the GitHub Actions workflow, which builds both.
