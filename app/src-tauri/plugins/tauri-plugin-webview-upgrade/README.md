# tauri-plugin-webview-upgrade

Redirect a Tauri Android app's **in-process** WebView loader to a sideloaded
`com.google.android.webview` when the device's system WebView is stuck on an
old Chromium version. iOS and desktop are intentional no-ops.

This unblocks Tauri apps on devices where the system WebView can't be updated
through normal channels — Huawei phones (`com.huawei.webview`), e-ink readers
on Rockchip / Moaan / Onyx / Boox builds with `com.android.webview` 83-99,
AOSP forks without Play Store, and so on. Modern Tauri / Wry-rendered UIs
typically render as a blank screen on those WebViews; with this plugin
installed, the user can sideload a recent
[`com.google.android.webview`](https://www.apkmirror.com/apk/google-inc/android-system-webview/)
APK and the app picks it up on next launch.

## How it works

```
Process attach
   ├─ ContentProvider.onCreate()                     ← plugin runs here, via App Startup
   │    ├─ WebView.getCurrentWebViewPackage() → "com.android.webview" 83
   │    ├─ PackageManager.getPackageInfo("com.google.android.webview") → 148
   │    └─ WebViewUpgrade.upgrade(UpgradePackageSource(…))
   │         ├─ Hooks WebViewUpdateService + PackageManagerService binders
   │         └─ checkWebView() — sanity-instantiates a throwaway WebView,
   │                              which loads from the new package
   ├─ Application.onCreate()
   ├─ Activity.onCreate()
   │    └─ Tauri/Wry creates the real WebView — picks the swapped provider
   └─ Plugin.load(WebView)                            ← Tauri's normal plugin lifecycle
```

The actual binder swap is performed by upstream
[`io.github.jonanorman.android.webviewup:core`](https://github.com/JonaNorman/WebViewUpgrade)
— this plugin's job is to invoke it at the right moment with sane defaults
and to ship the ProGuard rules that keep it alive through R8.

The hook runs from an [`androidx.startup`](https://developer.android.com/topic/libraries/app-startup)
`Initializer` declared in the plugin's merged manifest. App Startup's
`InitializationProvider` is a `ContentProvider`, so its `onCreate()` fires
during `bindApplication` — strictly before `Application.onCreate()`, and
long before any Activity can instantiate a WebView. That's the only window
in which `WebViewUpgrade.upgrade(...)` is allowed to swap the in-process
provider; once any WebView exists in the process, the binding is locked.

## Installation

### 1. Add the Cargo dependency

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-webview-upgrade = { git = "https://github.com/readest/tauri-plugin-webview-upgrade" }
```

(Or `path = "…"` if you vendor it as a submodule.)

### 2. Register the plugin

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    // …
    .plugin(tauri_plugin_webview_upgrade::init())
    .run(…)
```

There are no commands, no JS bindings, no `setup` hooks. The Rust side
exists only so Tauri's build script wires the Android module into your
app's Gradle build.

### 3. Build

Run a normal Tauri Android build (`tauri android dev` / `tauri android build`).
The plugin's Gradle module is auto-registered via `tauri-build`'s
`DEP_*_ANDROID_LIBRARY_PATH` env-var mechanism (driven by the `links`
field in `Cargo.toml`).

No manifest edits, no `Application` subclass, no proguard tweaks on the
host app. Everything ships from the plugin and merges automatically.

## Behaviour

On Android, at process attach:

1. Probe the system WebView via `WebView.getCurrentWebViewPackage()`.
2. Probe these candidate packages and log what's installed:
   `com.google.android.webview`, `com.google.android.webview.beta`,
   `com.google.android.webview.dev`, `com.google.android.webview.canary`,
   `com.android.webview`, `com.android.chrome`, `com.huawei.webview`. (All
   seven are listed in the plugin's `<queries>` so they're visible on
   Android 11+.)
3. If the system WebView's Chromium major is **≥ `minUpgradeMajor`** (default
   `121`), do nothing.
4. Otherwise, try the upgrade candidates in preference order — stable
   `com.google.android.webview` first, then `…beta`, `…dev`, and finally
   `…canary` as progressively less-stable fallbacks for devices where the
   stable channel is also pinned to an old version. The first candidate
   installed at major **≥ `minUpgradeMajor`** wins, and the in-process
   WebView provider is swapped to it via
   `WebViewUpgrade.upgrade(UpgradePackageSource(...))`.
5. Otherwise, log a `Log.w` hint telling the user to sideload a recent
   `com.google.android.webview` APK, and leave the system WebView in place.
6. If **none** of `com.android.webview`, `com.google.android.webview`,
   `com.google.android.webview.beta`, `com.google.android.webview.dev`, or
   `com.google.android.webview.canary` has a major **≥ `minSupportedMajor`**
   (default `92`) and no upgrade was performed, register a one-shot
   `ActivityLifecycleCallbacks` that shows a modal `AlertDialog` on the
   first Activity resume nudging the user to install Android System WebView.
   The dialog doesn't auto-dismiss — the user has to tap OK to acknowledge.
   Dialog text is loaded from the plugin's bundled string resources, so the
   user's system locale picks the right translation. "Not installed" counts
   as below threshold.

All paths are wrapped in `try/catch`; an upgrade failure never blocks app
boot. Look for the `WebViewUpgrade` tag in `logcat`:

```
I WebViewUpgrade: Device: manufacturer=… model=… sdk=30 abis=arm64-v8a,…
I WebViewUpgrade: System WebView: package=com.android.webview versionName=83.0.4103.120
I WebViewUpgrade: Candidate com.google.android.webview: installed versionName=148.0.7778.120 major=148 sourceDir=/data/app/…
I WebViewUpgrade: Candidate com.android.webview: installed versionName=83.0.4103.120 major=83 sourceDir=/product/app/webview/webview.apk
I WebViewUpgrade: Candidate com.android.chrome: NOT installed (or hidden by package visibility)
I WebViewUpgrade: Candidate com.huawei.webview: NOT installed (or hidden by package visibility)
I WebViewUpgrade: Upgrading WebView: system major=83 -> com.google.android.webview major=148
I WebViewUpgrade: WebView upgraded to com.google.android.webview 148.0.7778.120
```

## Configuration

Both Chromium-major thresholds are configurable via the host app's
`tauri.conf.json`:

```json
{
  "plugins": {
    "webview-upgrade": {
      "minUpgradeMajor": 121,
      "minSupportedMajor": 92
    }
  }
}
```

| Key                 | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minUpgradeMajor`   | `121`   | If the system WebView's Chromium major is below this, the plugin will try to swap to `com.google.android.webview` (or its `.beta` / `.dev` / `.canary` channels as fallbacks) when one of those packages is installed at major ≥ this same threshold. Bump it when your app starts depending on newer web features.                                                                                                                           |
| `minSupportedMajor` | `92`    | If `com.android.webview`, `com.google.android.webview`, and the `.beta` / `.dev` / `.canary` Google WebView channels are **all** below this major (or not installed), and no upgrade was performed, the plugin shows a modal `AlertDialog` on first Activity resume telling the user their WebView is too old. Pick a value that maps to "modern enough to render most of the open web" — i.e. below this the app is effectively unsupported. |

### How it reaches Kotlin

The Tauri CLI exports each plugin's config block as an env var
(`TAURI_WEBVIEW_UPGRADE_PLUGIN_CONFIG` for this plugin) when it invokes
Gradle. The plugin's `android/build.gradle.kts` reads that env var,
generates `WebViewUpgradeConfig.kt` into `build/generated/source/`, and
adds it to the Kotlin source set. The Initializer reads the generated
constants at runtime — no `<meta-data>` boilerplate in the host's
`AndroidManifest.xml`, no SharedPreferences round-trip.

If Gradle is invoked directly (not via `tauri android …`), the env var
won't be set. The build walks up from the plugin's `projectDir` looking
for the host's `tauri.conf.json` and reads it from disk; failing that,
falls back to the defaults above. The generation log line prints which
source was used:

```
WebViewUpgradeConfig: minUpgradeMajor=121, minSupportedMajor=92 (from tauri.conf.json at /…/src-tauri/tauri.conf.json)
```

## Caveats

- **Users must sideload a monolithic WebView APK.** Google Play distributes
  WebView as a split bundle (base + per-ABI configs). Split APKs are _not_
  supported by `WebViewUpgrade` — grab the stand-alone variant from APKMirror.
- **ABI must match.** A 32-bit Android process can only load a 32-bit
  WebView APK and vice versa. APKMirror lists per-ABI builds; pick one
  that matches `Build.SUPPORTED_ABIS[0]` (logged at startup).
- **Cold start required after sideload.** WebView binds to a provider on
  first instantiation in the process; once bound it can't be hot-swapped.
  If the app is already running when the user sideloads, force-stop and
  relaunch.
- **No support for split WebView providers / multi-process WebView quirks
  beyond what upstream provides.** See
  [`WebViewUpgrade`'s compatibility matrix](https://github.com/JonaNorman/WebViewUpgrade#compatibility)
  for tested device models.
- **The plugin's `<queries>` add seven package names to the host manifest.**
  Listing specific packages is fine under Google Play's package-visibility
  policy (it's `QUERY_ALL_PACKAGES` that draws scrutiny). Mention it in
  your privacy / data-safety disclosures if your store listing requires.
- **`com.google.android.webview` redistribution.** If you bundle the APK
  inside your app via `UpgradeAssetSource` (this plugin does _not_ — it
  only redirects to a user-installed copy), you're redistributing Google's
  WebView build, which has license implications. Sticking with the
  user-installed path avoids that entirely.

## Internals

| Concern                                                       | Where                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Bootstrap timing (before any WebView)                         | `androidx.startup` `Initializer`, declared via `<meta-data>` in `AndroidManifest.xml`          |
| Actual provider swap                                          | [`WebViewUpgrade.upgrade(UpgradePackageSource)`](https://github.com/JonaNorman/WebViewUpgrade) |
| Android 11+ package visibility                                | `<queries>` block in `AndroidManifest.xml`                                                     |
| R8 / ProGuard survival                                        | `consumer-rules.pro` — auto-applied to host app                                                |
| Process filtering (skip sandboxed WebView renderer processes) | `isMainProcess()` in `WebViewUpgradeInitializer.kt`                                            |
| Tauri Gradle wiring                                           | `links = "tauri-plugin-webview-upgrade"` in `Cargo.toml` + `tauri-plugin` build script         |

The R8 keep rule is intentionally broad
(`-keep class com.norman.webviewup.lib.** { *; }`) because the upstream
library is reflection-driven: every interface in `service.interfaces.*`,
every abstract proxy in `service.proxy.*`, and every runtime annotation
in `reflect.annotation.*` is introspected at runtime. R8 keeps reachable
superclasses by default but strips their annotations unless they're
explicitly kept, which breaks
`getClass().getAnnotation(ClassName.class)` and surfaces as
`Class.forName(null) → NullPointerException` at upgrade time. The library
is small (~60 classes), so keeping it wholesale is much safer than
chasing per-package keeps.

## Credits

This plugin is a thin wrapper around
[JonaNorman/WebViewUpgrade](https://github.com/JonaNorman/WebViewUpgrade) —
all of the actual binder-swap magic is there. Originally built for
[Readest](https://github.com/readest/readest) to fix blank-screen
rendering on Moaan / Onyx / Huawei devices.

## License

MIT. Upstream
[`WebViewUpgrade`](https://github.com/JonaNorman/WebViewUpgrade) is
Apache-2.0; consuming it as a Maven dependency under MIT is fine, but
you must preserve its `NOTICE` if you redistribute its bytecode.
