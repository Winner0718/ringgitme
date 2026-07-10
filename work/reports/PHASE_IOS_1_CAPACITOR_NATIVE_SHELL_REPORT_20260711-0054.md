# Phase iOS-1 — Capacitor Native iOS Shell Report

Date: 2026-07-11 00:54 (Asia/Kuala_Lumpur)

Branch: `wip/mac-migration-24c-c`

Project: `/Users/winnertang/Projects/ringgitme`

## Outcome

RinggitMe now has a minimal Capacitor iOS shell that builds and launches as an independent app in Xcode/iPhone Simulator. The root `index.html` remains the web source of truth. No React, Flutter, SwiftUI, Ionic UI layer, native feature plugin, development-server URL, or finance/business-logic rewrite was introduced.

The native smoke test succeeded on the booted iPhone 17 Simulator running iOS 26.5. The app launched with bundle ID `com.winnertang.ringgitme` and displayed the existing RinggitMe login/guest screen with safe-area layout.

## Capacitor setup

- Capacitor core: `8.4.1`
- Capacitor CLI: `8.4.1`
- Capacitor iOS: `8.4.1`
- App name: `RinggitMe`
- App ID: `com.winnertang.ringgitme`
- Web directory: `www`
- Minimum generated iOS deployment target: iOS 15.0
- Native dependency integration: Swift Package Manager
- Production server URL: none

## Files added or changed

Changed:

- `index.html`
  - Added one Capacitor environment check so the Safari/PWA “Add to Home Screen” hint is hidden only inside the native app.
  - No finance, Supabase, Worker, Telegram, Object Ledger, AA, Group Split, or account-balance behavior changed.

Added project files:

- `.gitignore`
- `package.json`
- `package-lock.json`
- `capacitor.config.json`
- `scripts/prepare-capacitor-web.mjs`
- `work/reports/PHASE_IOS_1_CAPACITOR_NATIVE_SHELL_REPORT_20260711-0054.md`

Added generated iOS project files:

- `ios/.gitignore`
- `ios/debug.xcconfig`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist`
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/Info.plist`
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- `ios/App/App/Base.lproj/Main.storyboard`
- `ios/App/App/Assets.xcassets/Contents.json`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
- `ios/App/App/Assets.xcassets/Splash.imageset/Contents.json`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png`
- `ios/App/CapApp-SPM/.gitignore`
- `ios/App/CapApp-SPM/Package.swift`
- `ios/App/CapApp-SPM/README.md`
- `ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift`

Generated and intentionally ignored:

- `node_modules/`
- `www/`
- `ios/App/App/public/`
- `ios/App/App/capacitor.config.json`
- `ios/App/App/config.xml`
- generated Cordova compatibility directories
- Xcode build products, DerivedData, Pods, and user-specific Xcode state

## Web asset preparation strategy

`scripts/prepare-capacitor-web.mjs` performs a deterministic preparation step:

1. Resolves the repository root and refuses an unexpected `webDir`.
2. Deletes and recreates only `www/`.
3. Copies root `index.html` to `www/index.html`.
4. Audits static media/link tags, file-like CSS URLs, JavaScript `assets/...` string references, and manifest icon references.
5. Copies only referenced local files that currently exist, preserving relative paths.
6. Reports referenced local artwork that does not exist; the current web UI already supplies fallbacks for these paths.
7. Rejects traversal, absolute paths, environment files, secrets, and references under `.git`, `node_modules`, `work`, `worker-audit`, `ios`, or `.vite`.

The current prepared bundle contains 11 source files:

- `index.html`
- `manifest.json`
- `icon.svg`
- five existing Maybank card images
- three existing sound files

The audit reports 56 missing brand/card/eWallet/merchant artwork paths. These files were already absent before Phase iOS-1 and are handled by the existing fallback renderer; no placeholder copies were invented.

`www/` is ignored because it is reproducible build output. Both `www/index.html` and the synced `ios/App/App/public/index.html` were byte-compared with root `index.html` and matched exactly.

## Native compatibility audit

- Service worker: no registration exists. Existing cache-management code only unregisters old registrations when the user explicitly requests cleanup.
- GitHub Pages paths: manifest, icon, asset paths, `start_url`, and scope remain relative. No `/ringgitme/` hardcoding was found or added.
- Capacitor loading: `webDir` is `www`; no repository-root webDir and no permanent `server.url` are configured.
- PWA install UI: a minimal `window.Capacitor.isNativePlatform()` guard suppresses only the Safari “Add to Home Screen” hint in native mode. Web/PWA behavior is unchanged.
- Local storage: retained unchanged; WKWebView local storage worked through native launch.
- Supabase: existing HTTPS client/request code and configuration were not edited. No schema/RPC changes or new credentials were added.
- OAuth caveat: native Google OAuth callback/deep-link configuration is intentionally not part of this baseline shell; guest/local launch was verified.
- Media/photo inputs: retained as standard file/camera inputs; no native media plugin was added.
- Viewport/safe area: existing `viewport-fit=cover` and `env(safe-area-inset-*)` CSS were retained and rendered correctly in Simulator.
- Telegram/external links: existing HTTPS link behavior was not changed and no Telegram code was edited.
- Face ID/push notifications: no native plugins or entitlements were added.
- Orientation: iPhone and iPad supported orientations were reduced to portrait only in `Info.plist`.
- Appearance: generated Capacitor icon/splash assets were retained as the baseline; no icon redesign or UI redesign was performed.

## Commands run and results

- `npm install @capacitor/core@latest @capacitor/ios@latest --save-exact`
  - Installed 8.4.1; zero npm audit vulnerabilities.
- `npm install @capacitor/cli@latest --save-dev --save-exact`
  - Installed 8.4.1; zero npm audit vulnerabilities.
- `npm run web:prepare`
  - Passed; recreated `www/`, copied 11 real files, and reported 56 missing fallback artwork references.
- `npx cap add ios`
  - Passed; generated the native Xcode project.
- `npm run ios:sync`
  - Passed; copied prepared web assets and synchronized SwiftPM dependencies.
- `git diff --check`
  - Passed.
- Inline JavaScript parse sanity for root `index.html`
  - Passed for all three executable inline scripts.
- JSON parsing for package/config/manifest files
  - Passed.
- `plutil -lint ios/App/App/Info.plist`
  - Passed.
- Root/source byte comparisons
  - `index.html == www/index.html`: passed.
  - `index.html == ios/App/App/public/index.html`: passed.
- Xcode build:
  - `xcodebuild ... -sdk iphonesimulator ... CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build`
  - Passed with exit code 0.
  - Output: `/tmp/RinggitMeDerivedDataVerify/Build/Products/Debug-iphonesimulator/App.app`
- Simulator:
  - Installed with `xcrun simctl install`.
  - Launched with `xcrun simctl launch --terminate-running-process booted com.winnertang.ringgitme`.
  - Launch succeeded on iPhone 17 / iOS 26.5; process ID was returned and the RinggitMe login/guest UI was visually verified.
- `npx cap open ios`
  - Passed; Xcode opened the generated project.

Two preliminary Xcode attempts were affected by sandbox/CoreSimulator cache permissions and a concurrent temporary build-database lock. The final clean build used a fresh `/tmp` DerivedData directory and completed successfully; these were environment issues, not project errors.

## Remaining manual steps

- In Xcode, keep automatic signing/account settings untouched for Simulator use. An Apple Developer team is needed only for a physical-device or archive workflow.
- Configure a native OAuth callback/deep link in a later phase if Google sign-in must complete inside the native app.
- Add custom production app icon/splash artwork only in a later visual-branding phase.
- Re-run `npm run ios:sync` after every root `index.html` or local asset update.

## Exact safe git add list

Do not use `git add .`. If the changes are reviewed and ready to stage, use this explicit list:

```bash
git add \
  .gitignore \
  index.html \
  package.json \
  package-lock.json \
  capacitor.config.json \
  scripts/prepare-capacitor-web.mjs \
  ios/.gitignore \
  ios/debug.xcconfig \
  ios/App/App.xcodeproj/project.pbxproj \
  ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist \
  ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved \
  ios/App/App/AppDelegate.swift \
  ios/App/App/Info.plist \
  ios/App/App/Base.lproj/LaunchScreen.storyboard \
  ios/App/App/Base.lproj/Main.storyboard \
  ios/App/App/Assets.xcassets/Contents.json \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json \
  ios/App/App/Assets.xcassets/Splash.imageset/Contents.json \
  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png \
  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png \
  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png \
  ios/App/CapApp-SPM/.gitignore \
  ios/App/CapApp-SPM/Package.swift \
  ios/App/CapApp-SPM/README.md \
  ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift \
  work/reports/PHASE_IOS_1_CAPACITOR_NATIVE_SHELL_REPORT_20260711-0054.md
```

No files were staged, committed, or pushed during Phase iOS-1.

## Xcode handoff

1. Open `ios/App/App.xcodeproj`.
2. Select scheme `App` and Simulator `iPhone 17 (iOS 26.5)`.
3. Press Xcode’s top-left triangular **Run (▶)** button.
