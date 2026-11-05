# Zantexa Link Website Brief

This document is the handoff brief for rebuilding the public Zantexa Link website in Claude. It records the current product facts, site structure, download behavior, visual direction, repository architecture, and links. Treat the repository and release assets as the source of truth; do not invent product capabilities or publish a stale download URL.

## 1. Project identity

- **Product:** Zantexa Link
- **One-line description:** All your computers and your phone, working as one desk.
- **Purpose:** Connect a user's own Mac, Windows, Linux, and Android devices so they can share input, screens, apps, files, and selected phone features.
- **License:** GPL-3.0
- **Account/cloud requirement:** No account and no cloud relay. Devices communicate directly over an encrypted link.
- **Feature activation:** Features are opt-in; do not imply that phone permissions or device access are automatically enabled.

## 2. Canonical project links

| Resource | URL |
|---|---|
| GitHub repository | <https://github.com/zantexaofficial/Zantexa-Link-Desktop> |
| Public releases and downloads | <https://github.com/zantexaofficial/Zantexa-Link-Desktop/releases> |
| v2.5.0 release page | <https://github.com/zantexaofficial/Zantexa-Link-Desktop/releases/tag/v2.5.0> |
| Release build workflow | <https://github.com/zantexaofficial/Zantexa-Link-Desktop/actions/workflows/publish-release.yml> |
| Current public domain | <https://twin-desk.vercel.app/> |
| Maintainer profile | <https://babar-ali-zantexa.vercel.app/> |
| GPL-3.0 license | <https://github.com/zantexaofficial/Zantexa-Link-Desktop/blob/main/LICENSE> |
| Product README and full feature details | <https://github.com/zantexaofficial/Zantexa-Link-Desktop/blob/main/README.md> |

The public domain currently serves an older TwinDesk page, not the Zantexa Link website in this repository. Confirm the Vercel project, production deployment, and domain assignment before treating a redesign as live.

## 3. Product facts and supported platforms

### Computers

- macOS 13 Ventura or later.
- Windows 10 and 11; x64 and ARM64 installers.
- Linux x86_64 on X11 and Wayland. Download formats include AppImage and Debian/Ubuntu `.deb`; an Arch package is also built.
- Depending on platform and enabled features: shared mouse and keyboard, another computer's screen and apps, files, clipboard, camera, sound, and terminal.

### Android phones and tablets

- Android 10 or later.
- Standard APK for direct installation.
- Full APK adds notification access and Accessibility features. Some full-app setup is performed from a connected computer using Android wireless debugging.
- Phone/tablet capabilities include calls and texts on a computer, notifications, photos and files, phone camera, remote/gamepad input, phone screen and apps in windows, and tablet as a second screen. Availability depends on Android permissions, setup, and the particular feature.

### Connections and privacy

- Devices can connect over the same Wi-Fi, USB, Bluetooth, Wi-Fi Direct, or a hotspot, depending on platform and setup.
- Pairing is approved using a code.
- Describe the connection as device-to-device and encrypted. Do not promise that every connection mode works on every platform or that no network is involved.
- No account, telemetry, or cloud relay is required.
- iOS and Windows Phone are not supported.

For detailed, version-specific capabilities and setup caveats, link to the [full README](https://github.com/zantexaofficial/Zantexa-Link-Desktop/blob/main/README.md), rather than duplicating every technical instruction on the landing page.

## 4. Recommended landing-page information architecture

1. **Header**
   - Product mark and name.
   - Downloads and installation/help navigation.
   - Source-code link to the GitHub repository.
   - Primary “Get the app” action to the downloads section.
2. **Hero**
   - Clear cross-device value proposition.
   - Short description of sharing screens, apps, files, calls, and input.
   - Main download action and installation-guide action.
   - Product screenshot with meaningful alt text.
   - Concise privacy statement.
3. **Downloads**
   - Platform selector for Windows, macOS, Linux, and Android.
   - Separate options for each supported architecture/package.
   - Visible release/version status and clear unavailable/error state.
   - A link to all GitHub releases.
4. **Install / get started**
   - Install on the two devices.
   - Open both apps.
   - Compare and approve pairing codes.
   - Link to the full setup guide for permissions or platform-specific instructions.
5. **Compatibility and caveats**
   - Show minimum supported OS versions and unsupported platforms.
   - Explain standard vs full Android APK without suggesting restricted permissions are enabled by default.
6. **Footer**
   - Repository, releases, maintainer, and GPL-3.0 license links.

The current page is intentionally a focused download landing page, not a replacement for the detailed product manual.

## 5. Existing website implementation

The current static website is under [`website/`](./):

| File | Responsibility |
|---|---|
| [`index.html`](./index.html) | Single-page structure, product copy, platform tabs, download options, installation steps, and footer |
| [`styles.css`](./styles.css) | Responsive visual system, layout, platform icons, download states, and mobile breakpoints |
| [`app.js`](./app.js) | Platform selection, device-based default tab, GitHub Releases lookup, and direct asset links |
| [`assets/icon.png`](./assets/icon.png) | Website icon and brand mark |
| [`assets/hero.jpg`](./assets/hero.jpg) | Hero product image |

Deployment configuration is [`../vercel.json`](../vercel.json): the Vercel output directory is `website`, clean URLs are enabled, and trailing slashes are disabled. The site has no server-side application or build step.

### Page anchors and controls

- `#top`: page hero/top.
- `#downloads`: platform download selector.
- `#install`: short installation guide.
- `data-platform`: platform-tab selection (`windows`, `macos`, `linux`, `android`).
- `data-panel`: matching tab panel.
- `data-asset`: unique release-asset key used by `app.js`.

Preserve semantic headings, tab roles/ARIA relationships, keyboard arrow navigation, `aria-live` release status, disabled states, and useful image alt text if the site is rebuilt.

## 6. Direct-download behavior and asset contract

The frontend requests the public GitHub Releases API:

```text
https://api.github.com/repos/zantexaofficial/Zantexa-Link-Desktop/releases?per_page=10
```

It selects the newest release that is neither a draft nor a prerelease, finds assets by filename, and points each available option at that asset's `browser_download_url`. If a matching asset is missing or the API cannot be reached, the corresponding option stays unavailable and the all-releases link remains available. Do not embed a token or secret in browser code.

| `data-asset` key | Platform/download | Expected asset filename |
|---|---|---|
| `windows-x64` | Windows x64 installer | `Zantexa-Link-Setup-<version>.exe` |
| `windows-arm64` | Windows ARM64 installer | `Zantexa-Link-Setup-<version>-arm64.exe` |
| `macos-arm64` | Apple silicon disk image | `Zantexa Link-<version>-arm64.dmg` or `Zantexa.Link-<version>-arm64.dmg` |
| `macos-x64` | Intel Mac disk image | `Zantexa Link-<version>-x64.dmg` or `Zantexa.Link-<version>-x64.dmg` |
| `linux-appimage` | Linux AppImage | `Zantexa-Link-<version>-<arch>.AppImage` |
| `linux-deb` | Debian/Ubuntu package | `Zantexa-Link-<version>-<arch>.deb` |
| `linux-arch` | Arch Linux package | `twindesk-bin-<version>-1-x86_64.pkg.tar.zst` |
| `android-standard` | Standard Android APK | `Zantexa Link-<version>.apk` or `Zantexa.Link-<version>.apk` |
| `android-full` | Full Android APK | `Zantexa Link-<version>-full.apk` or `Zantexa.Link-<version>-full.apk` |

Filename matching is implemented in [`app.js`](./app.js); keep it aligned with each platform build workflow and the generated asset names. The standard APK pattern must not accidentally match the `-full.apk` asset.

The published v2.5.0 release uses dot-separated `Zantexa.Link` names for its macOS and Android assets, and `amd64` / `x86_64` architecture names for its Linux assets. It currently contains no Intel Mac DMG or Arch package, so those two website options should remain unavailable until a release includes those files. The other seven options have matching v2.5.0 assets.

## 7. Visual direction in the current concept

- Warm, light background with dark text, muted green/olive accents, and an acid-lime CTA.
- Editorial, direct, product-focused layout rather than a generic SaaS template.
- Large typographic hero; clean device imagery; restrained borders and a subtle mint image shadow.
- Platform tabs and distinct bordered download cards.
- Responsive layout: desktop split hero and horizontal tabs; single-column hero/cards and a two-column tab grid on small screens.
- Existing palette tokens in [`styles.css`](./styles.css): `--paper`, `--ink`, `--muted`, `--line`, `--panel`, `--acid`, `--coral`, and `--mint`.

Claude may improve the visual design, but should retain the clear platform-first download flow, readable contrast, mobile usability, and accurate product identity. Do not reuse the older live site's TwinDesk-only title or branding without deliberately aligning it to Zantexa Link.

## 8. Desktop/mobile app architecture at a glance

- **Windows, macOS, Linux desktop applications:** Electron-based applications, with platform-specific helpers and packaged installers.
- **Android application:** Native Android app using Kotlin and Jetpack Compose, with standard and full product flavors.
- **Shared code:** Protocol, pairing, and common user-interface modules are in [`shared/`](../shared/).
- **Build and release:** GitHub Actions workflows in [`.github/workflows/`](../.github/workflows/) build per-platform release assets. `publish-release.yml` orchestrates tagged builds.
- **Website:** Independent static frontend; it reads public release metadata and sends downloads directly to GitHub Releases.

This is the website's integration map, not a claim that the website shares runtime code with the desktop or Android applications.

## 9. Release and launch status to verify

The release orchestration is [`publish-release.yml`](../.github/workflows/publish-release.yml). It expects a `vX.Y.Z` tag whose version matches the Windows, macOS, Linux, and Android app manifests. Android publishing also requires the repository `ANDROID_KEYSTORE` secret. The per-platform jobs upload assets to a draft before the final publish job.

Before calling a release or website launch complete, verify:

- The GitHub release for the intended version is **public**, not draft.
- Its release page lists the expected desktop installers and both Android APKs.
- Each asset's name matches the patterns in section 6.
- Opening an asset's direct link starts a download.
- The production Vercel domain serves this website build, not the previous TwinDesk page.
- Each platform tab works on desktop and mobile, including keyboard navigation and unavailable-asset states.
- No signing key, GitHub token, or other secret appears in site files, page source, or this brief.

An uploaded draft is not publicly visible and must not be described as a completed public release.
