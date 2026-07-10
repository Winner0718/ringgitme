# iOS Google OAuth Deep-Link Return — Read-Only Audit

**Project:** RinggitMe (`~/Projects/ringgitme`)
**App ID:** `com.winnertang.ringgitme` · Capacitor `8.4.1` · webDir `www`
**Date:** 2026-07-11 01:12
**Scope:** READ-ONLY audit. No files modified, no packages installed, no git/Supabase changes. This report is the only artifact written.

---

## 1. Confirmed Root Cause

The OAuth `redirectTo` is hard-coded to the **currently loaded web page URL**:

```js
// index.html:1305 — authGoogle()
await supa.auth.signInWithOAuth({
  provider:'google',
  options:{ redirectTo: location.href.split('#')[0], queryParams:{prompt:'select_account'} }
});
```

On the native iOS build, `location.href` is the app's bundled/hosted origin. After Google + Supabase finish, Supabase issues a `302` back to that **web URL** (`https://winner0718.github.io/...`). iOS has **no registered custom URL scheme** for the app, so the redirect resolves as a normal https page and **stays in Safari** — it never re-enters the installed app.

Three independent facts make the return impossible today:

1. **`redirectTo` points at the web page, not the app.** There is no native branch that targets a custom scheme.
2. **No custom URL scheme is registered.** `ios/App/App/Info.plist` has **no `CFBundleURLTypes`** key, and `project.pbxproj` defines no scheme. `ringgitme://` is not claimed by the app, so iOS cannot hand the callback back.
3. **No deep-link listener exists.** `@capacitor/app` is **not installed**, and there is no `appUrlOpen` handler anywhere in `index.html`. Even if a scheme fired, nothing would catch it and hydrate the session. `AppDelegate.swift` keeps the default `ApplicationDelegateProxy` `open url` hook (good — required plumbing is present), but the JS side has no listener.

Net effect: login succeeds in Safari, the session materializes **in the Safari page**, and the native webview never learns about it.

---

## 2. Existing Auth Flow (as built)

**Supabase client init** — `index.html:1294`:

```js
supa = window.supabase.createClient(c.url, c.key, {
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});
```

- Loaded from CDN: `@supabase/supabase-js@2` (`index.html:20`).
- Project URL + **publishable** key are inline at `index.html:1284` (`SUPA_URL`, `SUPA_KEY`). This is the anon/publishable key — public by design, not a secret leak — but note it is compiled into the shipped bundle.
- **`flowType` is NOT set.** supabase-js v2 defaults to the **implicit** flow. → **This app uses the implicit OAuth flow.**
- **`detectSessionInUrl: true`** — on web, the client auto-parses the session out of the URL on page load.

**What the callback looks like (implicit flow):** Supabase redirects to `redirectTo` with tokens in the **URL hash fragment**, not a query code:

```
<redirectTo>#access_token=…&refresh_token=…&expires_in=3600&token_type=bearer
```

There is **no `?code=` parameter**. That single fact dictates the correct native handling (see §5).

**Session propagation:** `supa.auth.onAuthStateChange` (`index.html:1294`) is the single funnel — it sets `SESSION`, calls `rememberAccount(s)` (multi-account token store in `localStorage.rm_accounts`), and runs `adoptCloudOrPush()` on user-id change to reconcile local vs cloud ledgers. Any native session restore **must go through the same `setSession` path** so this handler fires exactly once.

**Web/PWA today:** full-page redirect → back to the GitHub Pages URL → `detectSessionInUrl` parses the fragment → `onAuthStateChange` fires. Works and must keep working.

---

## 3. Environment / Package Inventory

| Item | State |
|---|---|
| `@capacitor/core` | 8.4.1 ✅ |
| `@capacitor/ios` | 8.4.1 ✅ |
| `@capacitor/cli` | 8.4.1 (dev) ✅ |
| **`@capacitor/app`** | ❌ **NOT installed** (required for deep-link listener + cold start) |
| **`@capacitor/browser`** | ❌ **NOT installed** (recommended for the OAuth in-app browser) |
| `capacitor.config.json` | minimal: `appId`, `appName`, `webDir` only — no `plugins`, no `iosScheme` |
| `Info.plist` `CFBundleURLTypes` | ❌ absent |
| `AppDelegate.swift` `open url` proxy | ✅ present (default Capacitor plumbing intact) |
| `window.Capacitor` runtime detection | ✅ already used at `index.html:1709` (`isNativePlatform()`) |

**Prepare/sync workflow** (`package.json` + `scripts/prepare-capacitor-web.mjs`):
- `web:prepare` → rebuilds `www/` from **root `index.html`** + referenced assets (root `index.html` is the single source of truth; `www/` and `ios/App/App/public/` are generated copies).
- `ios:sync` → `web:prepare` then `npx cap sync ios` (copies `www/` into `ios/App/App/public/`, installs pods/SPM plugins).
- `ios:open` → sync then open Xcode.
- **Implication:** edit **root `index.html`** only. Never hand-edit `www/index.html` or `ios/App/App/public/index.html` — they are overwritten every sync. Installing plugins requires re-running `ios:sync` so `cap sync` registers them natively.

---

## 4. Recommended Native Callback URL

```
ringgitme://auth/callback
```

- Scheme `ringgitme` (matches app identity, lowercase, no underscores — App-Store/URL safe).
- Host/path `auth/callback` gives room for future deep links under the same scheme.

---

## 5. Correct Callback Handling — Determination

> **Use `setSession({ access_token, refresh_token })` parsed from the URL hash fragment.**
> **Do NOT use `exchangeCodeForSession(code)`.**

Reason: the app runs the **implicit** flow (no `flowType:'pkce'` set — §2). Implicit returns tokens in the `#…` fragment; there is no `?code=`. `exchangeCodeForSession` only applies to the PKCE flow and would fail here. Parse the fragment from the `appUrlOpen` URL and call `setSession`, which drives the existing `onAuthStateChange` → `adoptCloudOrPush` pipeline unchanged.

```js
// Illustrative only — not applied.
const u = new URL(url);                          // ringgitme://auth/callback#access_token=…
const p = new URLSearchParams(u.hash.slice(1));  // hash carries the tokens
const at = p.get('access_token'), rt = p.get('refresh_token');
if (at && rt) await supa.auth.setSession({ access_token: at, refresh_token: rt });
```

**Alternative (larger change, NOT recommended now):** switch the whole app to `flowType:'pkce'` and use `exchangeCodeForSession`. This is more robust for native but changes web behavior, requires the code-verifier to survive the browser hop, and is out of scope for a minimal fix. Stay on implicit + `setSession`.

---

## 6. Exact Files To Change (for the implementer / Codex)

1. **`index.html`** (root — the source of truth):
   - `authGoogle()` (line 1305): branch `redirectTo` and add `skipBrowserRedirect` for native.
     - Native (`window.Capacitor?.isNativePlatform?.()`): `redirectTo:'ringgitme://auth/callback'`, `skipBrowserRedirect:true`, then open `data.url` via `Browser.open(...)`.
     - Web: keep `redirectTo: location.href.split('#')[0]` exactly as-is.
   - Add a **one-time native init** (guarded, runs once): register `App.addListener('appUrlOpen', …)` and check `App.getLaunchUrl()` for cold start; on a `ringgitme://auth/callback#…` URL, parse the fragment → `supa.auth.setSession(...)` → `Browser.close()`.
   - Import the plugins via the Capacitor global (CDN/UMD) or the existing module strategy consistent with how `window.supabase` is loaded — no bundler is in use, so prefer `window.Capacitor.Plugins.App` / `window.Capacitor.Plugins.Browser`.
2. **`ios/App/App/Info.plist`**: add `CFBundleURLTypes` → `CFBundleURLSchemes` = `ringgitme`. *(Best done via Xcode “URL Types”, which writes this key — see §8. Note this file is not regenerated by `cap sync`, so the edit persists.)*
3. **`package.json`**: add `@capacitor/app` and `@capacitor/browser` (`8.x`) to dependencies (install step, §7).
4. **No change** to `AppDelegate.swift` — the `open url` proxy is already correct.
5. **No manual edit** to `www/` or `ios/App/App/public/` — regenerated by `npm run ios:sync`.

---

## 7. Packages Required

```
@capacitor/app@^8      # appUrlOpen listener + getLaunchUrl (cold start)
@capacitor/browser@^8  # open Supabase OAuth URL in SFSafariViewController; Browser.close() on return
```

Match the installed Capacitor major (8.4.1). After install, **must** run `npm run ios:sync` so `cap sync` registers the native plugins (Pods/SPM) — otherwise the JS calls resolve to no-ops on device.

Why `@capacitor/browser`: in a native webview you must pass `skipBrowserRedirect:true` and open `data.url` in an **external/in-app SFSafariViewController**. Do **not** let `signInWithOAuth` navigate the Capacitor webview itself — Google blocks embedded webviews and the custom-scheme return won't fire from inside the app's own webview. SFSafariViewController honors the `ringgitme://` redirect and foregrounds the app.

---

## 8. Supabase Dashboard — Manual Change (one entry)

**Authentication → URL Configuration → Redirect URLs** — add:

```
ringgitme://auth/callback
```

- **Keep** the existing web entry (e.g. `https://winner0718.github.io/**` / the exact hosted RinggitMe path) so web/PWA login is unaffected.
- Do **not** change **Site URL** (leave it as the web origin).
- No other dashboard change is required. Google Cloud OAuth client stays as-is — the redirect Google sees is Supabase's `/auth/v1/callback`, unchanged; only Supabase's post-auth redirect target (the allow-list) needs the new scheme.

---

## 9. Xcode / URL Scheme Requirement

In `ios/App/App/Info.plist`, register:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.winnertang.ringgitme</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>ringgitme</string>
    </array>
  </dict>
</array>
```

Preferred: Xcode → target **App** → **Info** tab → **URL Types** → **+** → Identifier `com.winnertang.ringgitme`, URL Schemes `ringgitme`. This writes the key above. The default `AppDelegate` `open url` proxy already routes the incoming URL to Capacitor, which emits `appUrlOpen` to JS — no Swift edits needed.

---

## 10. Web / PWA Compatibility Rules

- **Gate every native change behind** `window.Capacitor?.isNativePlatform?.() === true`. The web path (`redirectTo: location.href.split('#')[0]`, full-page redirect, `detectSessionInUrl`) must remain byte-for-byte on non-native.
- Do not register the `appUrlOpen` listener or call `Browser`/`App` on web (plugins are native no-ops but guard anyway to avoid errors if the global is absent).
- Keep `detectSessionInUrl:true` — web relies on it. It is harmless on native (the webview URL never carries the fragment, since the token-bearing URL is intercepted by the app, not loaded into the webview).
- **GitHub Pages unaffected:** no server, no config, no new asset — the only web-visible change is a conditional that the web branch never enters.
- Root `index.html` is the source of truth; PWA/GitHub Pages ship the same file. The native branch is inert for those users.

---

## 11. Cold-Start Handling

The app can receive the callback in two states — handle **both**:

1. **App already running / backgrounded (warm):** `App.addListener('appUrlOpen', ({url}) => …)` fires with the callback URL. Foreground, parse, `setSession`, `Browser.close()`.
2. **App launched fresh by the deep link (cold):** the `appUrlOpen` listener may register **after** the launch URL was delivered. On native init, also call `App.getLaunchUrl()` and, if it is a `ringgitme://auth/callback#…` URL, process it the same way.

Ensure `supa` is initialized (`initSupa()` has run) before calling `setSession` — if the deep link lands before init, queue the URL and process once `supa` exists.

---

## 12. Security & Duplicate-Callback Risks

- **No tokens in logs.** The fragment carries `access_token` / `refresh_token`. Do **not** `console.log` the URL, the fragment, or the tokens. Existing `console.log` calls in the auth path log error objects only — keep it that way; add none that echo the callback URL.
- **Duplicate session processing.** Guard against double-handling:
  - `getLaunchUrl()` **and** `appUrlOpen` can both surface the same cold-start URL. Track the last-processed `access_token` (or a boolean/nonce) and ignore repeats.
  - `setSession` triggers `onAuthStateChange` → `adoptCloudOrPush()` (a cloud pull/push + ledger reconcile). Processing the same callback twice could double-run reconciliation. One-shot guard prevents it.
  - Clear/ignore the callback URL after first successful `setSession`.
- **Browser lifecycle.** Always `Browser.close()` after a successful return so the SFSafariViewController doesn't linger over the app.
- **No new secrets.** The custom scheme and the anon/publishable key are non-secret. Do not add any private key. (Observation, not an action: `SUPA_KEY` at `index.html:1284` is a publishable key baked into the bundle — acceptable, but confirm it is publishable-tier and that Row-Level Security is enforced server-side, since it ships to every client.)
- **Scheme hijacking caveat.** Custom URL schemes are not exclusive on iOS — any app can claim `ringgitme://`. The token is short-lived and the flow is user-initiated, so risk is low, but a future PKCE migration (§5 alternative) or App-Site-Association Universal Link would harden this. Out of scope for the minimal fix.

---

## 13. Implementation Order

1. Install `@capacitor/app` + `@capacitor/browser` (`8.x`); run `npm run ios:sync` to register natively.
2. Add the `ringgitme` URL scheme in Xcode (writes `CFBundleURLTypes` to `Info.plist`).
3. Add `ringgitme://auth/callback` to Supabase Redirect URLs allow-list (keep the web entry).
4. Edit **root `index.html`**:
   a. Native branch in `authGoogle()` — `redirectTo:'ringgitme://auth/callback'`, `skipBrowserRedirect:true`, open `data.url` via `Browser.open`.
   b. Native init — `appUrlOpen` listener + `getLaunchUrl()` cold-start check → parse fragment → `setSession` → `Browser.close()`, with a one-shot duplicate guard.
5. `npm run ios:sync` to propagate `index.html` into the iOS bundle.
6. Build/run on simulator + device; walk the test matrix (§14).

---

## 14. Manual Test Matrix

| # | Environment | State | Action | Expected |
|---|---|---|---|---|
| 1 | Web (desktop browser) | logged out | Google login | Redirects to hosted page, returns logged in (unchanged) |
| 2 | PWA (Add to Home Screen) | logged out | Google login | Same as today, session restored |
| 3 | GitHub Pages hosted | logged out | Google login | Works exactly as before |
| 4 | iOS Simulator (native) | app open | Google login | Browser opens → Google → returns to **app**, logged in, browser closed |
| 5 | iOS device (native) | app open (warm) | Google login | `appUrlOpen` fires, session set, back in app |
| 6 | iOS device (native) | app force-quit (cold) | Google login | `getLaunchUrl` path sets session, app opens logged in |
| 7 | iOS native | already logged in | reopen app | Session persists (`persistSession`), no re-login |
| 8 | iOS native | multi-account | login 2nd Google account | `adoptCloudOrPush` runs once, correct ledger loaded |
| 9 | iOS native | login | cancel in Safari | No crash, no partial session, browser closes cleanly |
| 10 | iOS native | double-deliver (launch+listener) | one login | Session processed **once** (guard holds), no double reconcile |
| 11 | Any | logs | full login | No token/URL fragment printed to console |

---

## 15. Codex Implementation Brief

> **Goal:** Make Google OAuth return into the native iOS app while leaving web/PWA/GitHub Pages login untouched.
>
> **Flow is implicit** (supabase-js v2 default, no `flowType` set) → tokens arrive in the URL **hash fragment**. Use **`supa.auth.setSession({access_token, refresh_token})`** parsed from the fragment. **Never** `exchangeCodeForSession`.
>
> **Do:**
> 1. `npm i @capacitor/app@^8 @capacitor/browser@^8` then `npm run ios:sync`.
> 2. Xcode → target App → URL Types → add scheme `ringgitme` (id `com.winnertang.ringgitme`). Confirm `CFBundleURLTypes` in `ios/App/App/Info.plist`.
> 3. Supabase dashboard → Auth → URL Configuration → Redirect URLs → add `ringgitme://auth/callback` (keep the existing web URL; leave Site URL unchanged).
> 4. In **root `index.html`** only:
>    - `authGoogle()` (line 1305): if `window.Capacitor?.isNativePlatform?.()` → `signInWithOAuth({provider:'google', options:{ redirectTo:'ringgitme://auth/callback', skipBrowserRedirect:true, queryParams:{prompt:'select_account'} }})`, then `Browser.open({url:data.url})`. Else keep the current web call verbatim.
>    - Add a once-only native init: `App.addListener('appUrlOpen', ({url}) => handle(url))` and on startup check `App.getLaunchUrl()`. `handle(url)`: parse `new URL(url).hash`, extract `access_token`/`refresh_token`, `await supa.auth.setSession(...)`, `await Browser.close()`. Ensure `supa` is initialized first; queue the URL if not.
>    - Guard duplicates: track last-processed `access_token`; ignore repeats so `onAuthStateChange`/`adoptCloudOrPush` runs once.
> 5. `npm run ios:sync`, build, run test matrix §14.
>
> **Don't:** log tokens or the callback URL; edit `www/` or `ios/App/App/public/` by hand; change the web `redirectTo`; touch `AppDelegate.swift`; set `flowType:'pkce'`; add any secret.

---

## 16. Rollback Plan

- **Code:** the native logic is fully gated behind `isNativePlatform()`. Reverting is `git checkout -- index.html` (single-file change) — web is unaffected at every step.
- **Native/Xcode:** removing the URL Type from `Info.plist` (or `git checkout ios/App/App/Info.plist`) unregisters the scheme; harmless to leave.
- **Packages:** `npm uninstall @capacitor/app @capacitor/browser` + `npm run ios:sync` if backing out; unused plugins are inert otherwise.
- **Supabase:** removing `ringgitme://auth/callback` from the allow-list reverts the dashboard; the web entry is never touched, so web login cannot regress.
- **Blast radius:** worst case (native change reverted) returns to today's exact behavior — web works, native login stays in Safari. No data migration, no schema change, no destructive step anywhere.

---

*End of audit. No source files were modified; only this report was written.*
