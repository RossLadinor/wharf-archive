# Releasing Wharf Archive

Releases are built automatically by GitHub Actions
([`.github/workflows/build.yml`](../.github/workflows/build.yml)) on real macOS and
Windows machines. You never need to build installers by hand.

## What the workflow does

| Trigger | Result |
|---|---|
| Push to `main`, or a pull request | Builds macOS and Windows installers and attaches them to the workflow run as **artifacts** (kept for 14 days). Use these to test before releasing. |
| Push a tag like `v1.6.2` | Same builds, then creates a **draft** GitHub Release with all installers and a `SHA256SUMS.txt` attached. |
| *Run workflow* button (Actions tab) | Same as a push to `main`, on demand. |

The release is created as a **draft** so nothing goes public until you've checked it.

## Release checklist

1. **Bump the version** in `package.json` (and `package-lock.json`):

   ```bash
   npm version 1.6.2 --no-git-tag-version
   ```

   Use a patch bump for fixes and a minor bump for new features.

2. **Update [`CHANGELOG.md`](../CHANGELOG.md)**: move items from *Unreleased* into a new
   section for this version.

3. **Commit and push** to `main`:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Release v1.6.2"
   git push
   ```

   Wait for the **Build & Release** run to go green on the
   [Actions tab](https://github.com/RossLadinor/wharf-archive/actions). If you like, download
   the artifacts and test them.

4. **Tag the release.** The tag **must** match `package.json`, or the build fails on purpose:

   ```bash
   git tag v1.6.2
   git push origin v1.6.2
   ```

5. **Publish.** When the run finishes, open
   [Releases](https://github.com/RossLadinor/wharf-archive/releases). You'll see a draft for
   `v1.6.2` with these files:

   - `Wharf-Archive-1.6.2-mac-arm64.dmg` / `.zip`
   - `Wharf-Archive-1.6.2-mac-x64.dmg` / `.zip`
   - `Wharf-Archive-1.6.2-win-x64-Setup.exe`
   - `Wharf-Archive-1.6.2-win-x64-Portable.exe`
   - `SHA256SUMS.txt`

   Review the auto-generated notes, paste in the CHANGELOG section if you like, then click
   **Publish release**.

### If something goes wrong

- **Build failed on the tag:** fix the problem on `main`, then move the tag:
  ```bash
  git tag -f v1.6.2
  git push -f origin v1.6.2
  ```
  Delete the old draft release first if one was created.
- **Tag/version mismatch error:** you tagged without bumping `package.json`. Delete the tag
  (`git push origin :refs/tags/v1.6.2 && git tag -d v1.6.2`), bump, commit, re-tag.

## Optional: code signing

Unsigned builds work fine, but users see a one-time Gatekeeper (macOS) or SmartScreen
(Windows) warning. To remove the warning, add certificates as repository secrets under
**Settings → Secrets and variables → Actions → New repository secret**. The workflow picks
them up automatically. Each platform is independent, so you can sign one and not the other.

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | Base64 of your *Developer ID Application* `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `MAC_CSC_KEY_PASSWORD` | Password for that `.p12` |
| `WIN_CSC_LINK` | Base64 of your code-signing `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password for that `.pfx` |

What you need:

- **macOS:** an [Apple Developer Program](https://developer.apple.com/programs/) membership
  ($99/year) for a Developer ID certificate. To fully remove the warning on recent macOS,
  the app must also be **notarized**. That needs extra setup: `mac.notarize` in
  `package.json`, plus `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` secrets
  passed to the Package step.
- **Windows:** a code-signing certificate from a CA (e.g. Sectigo, DigiCert, SSL.com) or
  Azure Trusted Signing. SmartScreen warnings fade as a signed app builds reputation.
