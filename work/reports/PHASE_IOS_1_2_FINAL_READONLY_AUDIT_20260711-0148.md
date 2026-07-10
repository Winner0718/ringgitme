# Phase iOS-1 + iOS-2 — Final Read-Only Audit

**Project:** RinggitMe (`~/Projects/ringgitme`) · **Branch:** `wip/mac-migration-24c-c` · **HEAD:** `c0050cd`
**Date:** 2026-07-11 01:48 (Asia/Kuala_Lumpur)
**Scope:** READ-ONLY. No source file modified, no package installed, no git write, no Supabase change. Only this report was written.

---

## Overall Result: **PASS WITH NOTES**

All seven audit areas pass. The notes are advisory (pre-existing behaviors and one cosmetic quirk in already-committed code) — none blocks commit.

---

## 1. Changed-File Inventory (exact, from `git status --untracked-files=all`)

**Modified (tracked):**

| File | Change |
|---|---|
| `index.html` | +61 / −4 lines. Three localized changes only: (a) `initSupa()` tail-call to `processPendingNativeOAuthIOS2()`; (b) new native OAuth block replacing single-line `authGoogle()` (constants, guards, callback handler, init, QA helper); (c) `renderLock()` Safari-hint gate adds `nativeCapacitor` check; (d) one line `void initNativeOAuthIOS2();` after `initSupa()`. |

**New untracked (28 files):**

```
.gitignore
capacitor.config.json
package.json
package-lock.json
scripts/prepare-capacitor-web.mjs
ios/.gitignore
ios/debug.xcconfig
ios/App/App.xcodeproj/project.pbxproj
ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
ios/App/App/AppDelegate.swift
ios/App/App/Info.plist
ios/App/App/Base.lproj/LaunchScreen.storyboard
ios/App/App/Base.lproj/Main.storyboard
ios/App/App/Assets.xcassets/Contents.json
ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json
ios/App/App/Assets.xcassets/Splash.imageset/Contents.json
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png
ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png
ios/App/CapApp-SPM/.gitignore
ios/App/CapApp-SPM/Package.swift
ios/App/CapApp-SPM/README.md
ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift
work/reports/PHASE_IOS_1_CAPACITOR_NATIVE_SHELL_REPORT_20260711-0054.md
work/reports/IOS_2_GOOGLE_OAUTH_DEEP_LINK_AUDIT_20260711-0112.md
work/reports/PHASE_IOS_2_GOOGLE_OAUTH_DEEP_LINK_REPORT_20260711-0136.md
```

(Plus this final audit report, written after the inventory.)

**Scope confirmation:**
- ✅ The `index.html` diff touches **only** OAuth/native-shell code. No finance, account-balance, AA, Object Ledger, Group Split, Worker, Telegram, or Supabase schema/RPC code is changed (verified line-by-line in `git diff`).
- ✅ `git diff --check` clean (no whitespace/conflict-marker issues).
- ✅ `www/`, `node_modules/`, `ios/App/App/public/`, Xcode user state are gitignored — `www/` stays reproducible generated output.
- ✅ Root `index.html` remains source of truth: byte-compare passed — `index.html == www/index.html` and `index.html == ios/App/App/public/index.html`.

---

## 2. Capacitor Structure — PASS

- ✅ `package.json`, `package-lock.json`, `capacitor.config.json` all parse as valid JSON.
- ✅ Versions pinned and lock-consistent: core/ios/cli `8.4.1`; `@capacitor/app 8.1.0`, `@capacitor/browser 8.0.3` (both peer-require `@capacitor/core >=8.0.0` — compatible; plugins do not publish an 8.4.1 patch, so these are the correct current 8.x releases).
- ✅ `capacitor.config.json`: `appId com.winnertang.ringgitme`, `appName RinggitMe`, `webDir www` — no `server.url`, no localhost/LAN IP anywhere (`capacitor.config.json`, `ios/App/App/capacitor.config.json`, `ios/debug.xcconfig` all clean). **No permanent dev-server URL.**
- ✅ `scripts/prepare-capacitor-web.mjs` is safe: refuses unexpected `webDir`, deletes only `www/`, rejects traversal/absolute paths/`.env`/secret-named/excluded dirs (`.git`, `node_modules`, `work`, `ios`, …).
- ✅ `ios/App/App.xcodeproj/project.pbxproj` present and structurally complete; `CapApp-SPM/Package.swift` pins `capacitor-swift-pm 8.4.1` and declares both plugin packages; generated `ios/App/App/capacitor.config.json` registers `AppPlugin` + `CAPBrowserPlugin`.

---

## 3. iOS Native Configuration — PASS

- ✅ App ID `com.winnertang.ringgitme`; display name `RinggitMe` (`Info.plist` `CFBundleDisplayName`).
- ✅ URL scheme registered correctly: `CFBundleURLTypes` → name `com.winnertang.ringgitme`, scheme `ringgitme` ([Info.plist:23-33](ios/App/App/Info.plist)). `plutil -lint` passes.
- ✅ Portrait-only for iPhone and iPad (`UISupportedInterfaceOrientations` + `~ipad`).
- ✅ `AppDelegate.swift` unchanged from Capacitor default — `ApplicationDelegateProxy` forwarding for `open url` and `continue userActivity` intact (required for `appUrlOpen`).
- ✅ No unnecessary native modifications: no entitlements, no extra plists, no Swift code beyond the generated shell.

---

## 4. OAuth Implementation — PASS

Verified in the working-tree diff ([index.html:1305-1361](index.html:1305)):

- ✅ Native branch: `redirectTo:'ringgitme://auth/callback'` + `skipBrowserRedirect:true` + `prompt:'select_account'`; validates `data.url`; opens via `Browser.open`. Never navigates the app WebView.
- ✅ Web/PWA branch preserved **verbatim**: `redirectTo:location.href.split('#')[0]` with full-page redirect; native plugins never touched off-native.
- ✅ Implicit flow correctly handled: tokens read **only** from the URL hash fragment (`URLSearchParams(callback.hash.slice(1))`) → `supa.auth.setSession({access_token, refresh_token})`. **No `exchangeCodeForSession` anywhere** (grep-confirmed). No `flowType` change; `detectSessionInUrl:true` retained for web.
- ✅ Warm callback: `App.addListener('appUrlOpen', …)` → shared handler.
- ✅ Cold start: `App.getLaunchUrl()` checked after listener registration, same handler.
- ✅ Early-callback queue: if the deep link arrives before `supa` exists, the URL is held in in-memory `nativeOAuthPendingUrlIOS2` and drained exactly once by `processPendingNativeOAuthIOS2()` at the end of `initSupa()`. Safe: memory-only, single consumer, cleared before processing.
- ✅ Browser closes **only after** `setSession` returns a valid session (`data.session` checked; close is inside the success path, wrapped in its own try/catch).
- ✅ Cancellation: closing the browser produces no callback → no `setSession`, no state mutation, no data damage; a fresh login tap runs `resetNativeOAuthAttemptIOS2()` and retries cleanly.
- ✅ Session propagation reuses the existing `onAuthStateChange` funnel (`rememberAccount` → `adoptCloudOrPush`); the handler never calls cloud adoption directly, so no double adoption path exists.
- ✅ Real manual E2E confirmed by the user: browser opened → Google login → app auto-reopened → session restored → browser closed → cloud data loaded → relaunch preserved login.

Minor design note (not a defect): after a *failed* callback (e.g. missing tokens), `nativeOAuthCallbackHandledIOS2` stays `true` until the next explicit login tap resets it. Deliberate — blocks stray duplicate deliveries; retry always works via the login button.

---

## 5. Security — PASS (with pre-existing notes)

- ✅ **No token/callback logging.** The new OAuth block contains zero `console.*` calls (the one grep hit is the string literal `'console.'` inside the QA helper's own `noTokenLogging` assertion). Error toasts are generic; no URL/fragment/token is echoed.
- ✅ **No secret added.** Diff introduces only the public custom-scheme constant and plugin lookups.
- ✅ **No token persisted as a duplicate-guard key.** Guards are in-memory booleans (`processing`/`handled`) plus a memoized init promise — no token-derived value stored anywhere.
- ✅ **Callback validation is exact:** `protocol==='ringgitme:' && hostname==='auth' && pathname==='/callback'`. Non-matching deep links are ignored without side effects.
- ✅ **Duplicate protection sufficient:** memoized initializer (one listener ever), `processing` flag (concurrent delivery), `handled` flag (repeat delivery from `getLaunchUrl` + `appUrlOpen`), queue cleared before processing. The phase-2 harness verified `setSession` fires once under duplicate delivery.
- ✅ **Anon key exposure is the expected public client key** (`sb_publishable_…` at [index.html:1284](index.html:1284)) — publishable-tier, already shipped to every GitHub Pages visitor. Not a new exposure.
- ⚠️ **RLS dependency (note, pre-existing):** because the publishable key ships in the client, all data isolation for `ledgers`, `person_ledger_*`, `quick_entries`, etc. rests entirely on Supabase Row-Level Security. Nothing in this phase changed that posture; it must remain enforced server-side.
- ⚠️ **Pre-existing (not introduced here):** `rememberAccount()` stores access/refresh tokens in `localStorage.rm_accounts` for multi-account switching — long-standing app behavior, unchanged by this diff.
- ⚠️ **Custom-scheme caveat (documented in the iOS-2 audit):** `ringgitme://` is not exclusive on iOS; a future PKCE/Universal-Link migration would harden this. Acceptable for now — short-lived tokens, user-initiated flow.

---

## 6. Web Compatibility — PASS

- ✅ Web `authGoogle()` branch byte-identical in behavior to pre-change code (same `redirectTo`, same error toast).
- ✅ No service worker exists to break; no PWA manifest/paths changed; `start_url`/scope remain relative.
- ✅ Every native call is gated: `isNativeCapacitorIOS2()` in `authGoogle`; `initNativeOAuthIOS2()` resolves `false` immediately off-native; plugin lookups null-safe via `capacitorPluginIOS2()`.
- ✅ Safari "Add to Home Screen" hint hidden only when `standalone` **or** `isNativePlatform()` — web browser and PWA behavior unchanged.
- ✅ Generated copies synchronized: root ↔ `www/index.html` ↔ `ios/App/App/public/index.html` byte-match.

---

## 7. Regression Risks — PASS

- ✅ **`let delTxn` fix (committed `c0050cd`) is safe.** The identifier `delTxn` is never reassigned anywhere — only `window.delTxn` is layered (lines 2611, 3330, 3432, 4037), each wrapper falling back to `window.delTxn||delTxn`. `let` vs `const` is behaviorally identical here; the delete → balance-reversal → AA-receivable-removal chain is untouched.
- ✅ **Group repayment guards intact:** `reverseLinkedRepaymentEffect24CC`, `reopenLinkedRepaymentGuard24CC`, and `duplicatePrevented` all present (8 references); none touched by the working-tree diff.
- ✅ **No double cloud adoption:** the native handler only calls `setSession`; `adoptCloudOrPush` still fires solely from `onAuthStateChange` on uid change, and duplicate `setSession` is suppressed by the handled guard.
- ✅ **No likely iOS WebView blocker:** WKWebView (iOS 15+ target) parses `new URL('ringgitme://auth/callback#…')` per WHATWG (hostname `auth`, pathname `/callback`) — and the real-device manual login already succeeded, which is the strongest evidence.
- ℹ️ **Cosmetic quirk in already-committed code** (`c0050cd`, not in the uncommitted diff): `__ringgitmeTestGroups24CC` dropped `receivingAccountBalanceEffectOk`/`linkedRepaymentReopenGuardOk` from its returned `out` object but still enforces both as locals in `out.safe`. The checks still gate `safe`; they're just no longer individually visible in the QA output. Zero runtime impact; optional cleanup in a later phase.

---

## 8. Exact Safe Git Add Commands

Never `git add .` (it would also sweep future strays). The full reviewed set, in logical groups:

```bash
# Root project + web source of truth
git add .gitignore index.html package.json package-lock.json \
        capacitor.config.json scripts/prepare-capacitor-web.mjs

# iOS native project (iOS-1 shell + iOS-2 URL scheme)
git add ios/.gitignore ios/debug.xcconfig \
        ios/App/App.xcodeproj/project.pbxproj \
        ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist \
        ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved \
        ios/App/App/AppDelegate.swift \
        ios/App/App/Info.plist \
        ios/App/App/Base.lproj/LaunchScreen.storyboard \
        ios/App/App/Base.lproj/Main.storyboard \
        ios/App/App/Assets.xcassets/Contents.json \
        "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" \
        ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json \
        ios/App/App/Assets.xcassets/Splash.imageset/Contents.json \
        ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png \
        ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png \
        ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png \
        ios/App/CapApp-SPM/.gitignore \
        ios/App/CapApp-SPM/Package.swift \
        ios/App/CapApp-SPM/README.md \
        ios/App/CapApp-SPM/Sources/CapApp-SPM/CapApp-SPM.swift

# Phase reports
git add work/reports/PHASE_IOS_1_CAPACITOR_NATIVE_SHELL_REPORT_20260711-0054.md \
        work/reports/IOS_2_GOOGLE_OAUTH_DEEP_LINK_AUDIT_20260711-0112.md \
        work/reports/PHASE_IOS_2_GOOGLE_OAUTH_DEEP_LINK_REPORT_20260711-0136.md \
        work/reports/PHASE_IOS_1_2_FINAL_READONLY_AUDIT_20260711-0148.md
```

Then verify before committing: `git status --short` must show **only** staged (`A`/`M`) entries — `www/`, `node_modules/`, `ios/App/App/public/` must not appear.

---

## 9. Recommended Commit Message

```
Phase iOS-1/iOS-2: Capacitor iOS shell + native Google OAuth deep-link return

- Add Capacitor 8.4.1 iOS shell (appId com.winnertang.ringgitme, webDir www)
- Deterministic www/ preparation script; root index.html stays source of truth
- Register ringgitme:// URL scheme; keep default AppDelegate deep-link proxy
- Native Google OAuth: skipBrowserRedirect + Capacitor Browser,
  ringgitme://auth/callback, warm appUrlOpen + cold getLaunchUrl,
  implicit hash tokens via supa.auth.setSession, duplicate-callback guards,
  browser closes only after session restore
- Web/PWA/GitHub Pages login branch unchanged and fully gated
- No finance/AA/Object Ledger/Group Split/Worker/Telegram/schema changes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

(Adjust trailer/attribution to your repo convention if different.)

---

## 10. Push Safety

**Safe to push** `wip/mac-migration-24c-c` after committing:
- No secret in any staged file — the only key is the publishable Supabase client key already public on GitHub Pages.
- No token, callback URL, or credential appears in code or reports.
- Branch is a WIP feature branch; pushing does not deploy (GitHub Pages serves from its configured branch/path, and root `index.html` changes are gated so web behavior is unchanged even when merged).
- `package-lock.json` integrity hashes are standard and non-sensitive.

---

## 11. Remaining Caveats

1. **Manual/external:** the Supabase Redirect URL allow-list (`ringgitme://auth/callback` + `https://winner0718.github.io/ringgitme/**`) lives in the dashboard, not the repo — document it, since a fresh Supabase project would need it re-added.
2. RLS remains the sole server-side data-isolation boundary (pre-existing).
3. `localStorage.rm_accounts` token persistence is pre-existing multi-account behavior; consider Keychain-backed storage in a future native phase.
4. Custom scheme is not exclusive; PKCE/Universal Links are the future hardening path.
5. Physical-device archive/signing and production app icon/splash remain later phases (per iOS-1 report).
6. Optional cleanup: restore the two dropped fields in `__ringgitmeTestGroups24CC`'s output object (cosmetic, committed code).
7. Re-run `npm run ios:sync` after any future root `index.html` edit, or the native bundle will lag the source of truth.

---

## Verdict

# ✅ SAFE TO COMMIT

All audited areas pass; notes are advisory only. Stage with the explicit file list in §8 (never `git add .`), commit with the §9 message, and the branch is safe to push.

---

*Read-only audit. No source files, packages, git state, or Supabase configuration were modified. Checks run: `git status --short --untracked-files=all`, `git diff --check`, `git diff --stat`, full `git diff index.html`, `git show c0050cd`, `plutil -lint`, JSON parsing of all package/config files, byte-comparison of root vs generated copies, and targeted grep inspections. No files were regenerated.*
