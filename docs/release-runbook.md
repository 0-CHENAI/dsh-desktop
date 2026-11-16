# Desktop release runbook

## macOS release without Apple Developer Program

This fork does not have Apple Developer Program credentials. Its macOS configuration therefore sets `identity: "-"` for explicit ad-hoc signing and disables hardened runtime, which otherwise rejects Electron frameworks carrying a different Team ID. Ad-hoc signing gives every executable a coherent local code signature and prevents publishing an accidentally unsigned or structurally invalid app, but it does not establish a trusted publisher and cannot be submitted for Apple notarization.

The native macOS job runs `scripts/verify-macos-package.mjs` before upload. The verifier runs strict deep `codesign` validation on the unpacked app, extracts the ZIP and validates its app, mounts the DMG read-only and validates its app, and invokes `spctl` to record Gatekeeper's result. An ad-hoc package is expected to be rejected by Gatekeeper; any malformed or missing signature fails the job and blocks publication.

After the first blocked launch, a user who trusts the GitHub Release must choose **System Settings → Privacy & Security → Open Anyway**. Do not tell users to remove quarantine attributes with `xattr` or disable Gatekeeper. If Developer ID credentials become available later, replace ad-hoc signing with Developer ID signing and Apple notarization before describing the download as normally Gatekeeper-approved.

## Local Windows UKey signing runner

Windows packaging and signing run as separate jobs. The GitHub-hosted Windows runner builds an unsigned NSIS installer, checks the unpacked native runtime and real Harness client, and uploads a workflow artifact. The local macOS ARM64 runner downloads that installer and signs the installer container using Jsign and the SafeNet UKey, then regenerates its blockmap and `latest.yml`. This workflow does not call the retained `sign-windows-unpacked.mjs` tool and does not claim that every embedded PE was newly signed. Tag and prerelease publication require the native macOS build and the UKey signing job; main development publication uses the two native build jobs and publishes unsigned Windows Dev packages. There is no separate post-signing installed-app job in the current fork workflow. Qualify the final installer, same-directory upgrades, rollback and Profile preservation before treating a release as ready.

The pinned Windows NSIS template stages the application in a sibling directory before closing the old app, then renames the old directory to a backup and promotes the staged directory. A failed extraction or rename restores the previous installation. The signed installer smoke also locks the old executable to verify that a failed upgrade leaves it runnable. A user-selected different directory is an independent installation: the installer does not automatically uninstall the previous directory, which remains available until the user removes it. Keep the user-selected installation directory when changing this template; the build adapter rejects unexpected upstream template changes.

JavaScript dependencies load from `app.asar`: Harness, pnpm and package commands all run on the Electron runtime, which reads the archive. `asarUnpack` keeps only what the OS loads or executes beside it (native addons and libraries, node-pty's `spawn-helper`, ripgrep, the LibreOffice engine and sherpa-onnx platform packages). node-pty and ripgrep map their binaries to `app.asar.unpacked` themselves; `build/office-engine-resolution.mjs` resolves the LibreOffice engine package there. The exact package size must be measured for the target artifact.  Neither platform ships an independent Node: Windows uses the packaged Electron executable in Node mode, and macOS runs package commands through the app's Helper in Node mode. This fork pins Electron 44.7.0 and qualifies its native-loader fingerprint through the target probe and real Harness startup; an earlier Electron 43.4.0 attempt failed during Harness boot even though the Koffi probe passed ([Windows CI evidence](https://github.com/dataelement/dsh-desktop/actions/runs/35972303467)). Qualify any Electron or native-loader change with packaged Windows Harness and final signed-installer gates.

Prepare the local runner once:

1. Register it with the `self-hosted`, `macOS`, and `ARM64` labels.
2. Install SafeNet Authentication Client and confirm `/usr/local/lib/libeTPkcs11.dylib` is readable.
3. Connect the UKey before pushing a release tag.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and create a repository secret named `DESKTOP_WINDOWS_SIGNING_PIN` containing the UKey PIN. For stronger release controls, use an environment secret and add the matching `environment` to the `sign-windows` job.
5. Restrict release tag creation and workflow changes to trusted maintainers. A self-hosted runner can access any secret injected into its job.

The current UKey job uses `actions/setup-node` with `cache: npm`, then installs release tooling with `npm ci --ignore-scripts`. GitHub-hosted jobs also use the Actions npm cache. Clearing a runner's cache changes download work, not the requirement to use the locked release tooling and verify the artifact before signing.

The workflow pins Jsign 7.5 by SHA-256 and uses the SafeNet `ETOKEN` store, SHA-256 signing, and a DigiCert RFC 3161 timestamp. GitHub injects the PIN only into the signing step. The step copies it to a mode-`600` temporary file, removes it from the shell environment, and deletes the file when the step exits. The workflow never prints the PIN or passes it as a command-line argument.

The current Windows builder explicitly sets `verifyUpdateCodeSignature: false` and does not pin `signtoolOptions.publisherName`. Check the actual final installer's certificate and timestamp after UKey signing; an archive hash, a successful package build or a valid outer installer signature does not establish signatures for every embedded executable. Enabling publisher verification later requires a separately tested update migration, including the existing unsigned development channel. Never reuse a published tag; fix the issue and release a new version.
