# Wharf Archive

**A local-first 3D/2D asset manager with optional Google Drive sync, for macOS and Windows.**

Wharf Archive lets a small team keep a shared library of Blender, Maya, ZBrush (and other)
assets. Every machine browses its own fast local index; a Google Drive folder acts as a
shared backend that you push to and pull from on demand.

[![Build & Release](https://github.com/RossLadinor/wharf-archive/actions/workflows/build.yml/badge.svg)](https://github.com/RossLadinor/wharf-archive/actions/workflows/build.yml)
[![Latest release](https://img.shields.io/github/v/release/RossLadinor/wharf-archive)](https://github.com/RossLadinor/wharf-archive/releases/latest)

---

## Download

Get the latest version from the **[Releases page](https://github.com/RossLadinor/wharf-archive/releases/latest)**.

| Your computer | Download this file |
|---|---|
| Mac with Apple Silicon (M1, M2, M3, M4) | `Wharf-Archive-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Wharf-Archive-<version>-mac-x64.dmg` |
| Windows 10/11 (recommended) | `Wharf-Archive-<version>-win-x64-Setup.exe` |
| Windows, no installation (USB stick, locked-down PC) | `Wharf-Archive-<version>-win-x64-Portable.exe` |

> **Not sure which Mac you have?** Apple menu → **About This Mac**. If the "Chip" line
> says *Apple M…*, choose **arm64**; if it shows a "Processor" line with *Intel*, choose **x64**.

`SHA256SUMS.txt` on each release lets you verify your download (optional).

## Installing

The app is **not code-signed yet**, so macOS and Windows show a warning the first
time you open it. This is expected. Here is how to get past it:

### macOS

1. Open the `.dmg` and drag **Wharf Archive** into **Applications**.
2. In Applications, **right-click** (or Control-click) Wharf Archive → **Open** → **Open**.
3. If macOS only offers "Move to Trash", go to **System Settings → Privacy & Security**,
   scroll down to the message about Wharf Archive, and click **Open Anyway**.

You only need to do this once. After that, the app opens normally.

### Windows

1. Run `Wharf-Archive-<version>-win-x64-Setup.exe`.
2. If you see **"Windows protected your PC"** (SmartScreen), click **More info → Run anyway**.
3. Choose an install folder. The installer creates Desktop and Start Menu shortcuts.

The **Portable** `.exe` needs no installation. Just double-click it (the same
SmartScreen step applies).

### Updating

Download the new version and install it over the old one. On macOS, replace the app in
Applications. Your library, settings and Google sign-in are stored separately and are kept.

## Connecting Google Drive (optional)

Wharf Archive works fully offline. To share a library between machines:

1. Go to <https://console.cloud.google.com> and create a project.
2. **APIs & Services → Library → enable "Google Drive API"**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Desktop app**,
   then download the JSON file.
4. In Wharf Archive, click the **Google icon** (top-right), paste the JSON contents and sign in.

The app only requests the `drive.file` scope, so it can see **only the files it creates**.
To give teammates access, export an **Access Pack** from the app and send it to them privately.
It contains sign-in tokens, so treat it like a password.

Assets are stored on Drive under:

```
WharfArchive/
├── Props/
│   └── Medieval Shield/
│       ├── shield.blend
│       ├── preview.png
│       └── metadata.json
├── Materials/Metal/
└── Characters/Human/
```

## Building from source

```bash
git clone https://github.com/RossLadinor/wharf-archive.git
cd wharf-archive
npm install --ignore-scripts
npm run setup
npm run dev
```

See **[docs/BUILDING.md](docs/BUILDING.md)** for prerequisites on macOS and Windows,
packaging installers, and troubleshooting.

## Documentation

| Doc | For |
|---|---|
| [docs/BUILDING.md](docs/BUILDING.md) | Setting up a dev environment and building installers on macOS / Windows |
| [docs/RELEASING.md](docs/RELEASING.md) | Publishing a new version to GitHub Releases |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Architecture, data model, sync protocol, IPC contract, invariants |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |

## Reporting problems

Open an [issue](https://github.com/RossLadinor/wharf-archive/issues/new/choose) and include your
OS (macOS / Windows and version) and the Wharf Archive version (it's in the name of the file you downloaded).

## License

[MIT](LICENSE)
