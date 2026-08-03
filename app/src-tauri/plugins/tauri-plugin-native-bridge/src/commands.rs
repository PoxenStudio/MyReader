use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{command, AppHandle, Runtime, State};

use crate::models::*;
use crate::DirectoryCallbackState;
use crate::NativeBridgeExt;
use crate::Result;

#[command]
pub(crate) async fn auth_with_safari<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthRequest,
) -> Result<AuthResponse> {
    app.native_bridge().auth_with_safari(payload)
}

#[command]
pub(crate) async fn auth_with_custom_tab<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthRequest,
) -> Result<AuthResponse> {
    app.native_bridge().auth_with_custom_tab(payload)
}

#[command]
pub(crate) async fn copy_uri_to_path<R: Runtime>(
    app: AppHandle<R>,
    payload: CopyURIRequest,
) -> Result<CopyURIResponse> {
    app.native_bridge().copy_uri_to_path(payload)
}

#[command]
pub(crate) async fn save_image_to_gallery<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveImageToGalleryRequest,
) -> Result<SaveImageToGalleryResponse> {
    app.native_bridge().save_image_to_gallery(payload)
}

#[command]
pub(crate) async fn use_background_audio<R: Runtime>(
    app: AppHandle<R>,
    payload: UseBackgroundAudioRequest,
) -> Result<()> {
    app.native_bridge().use_background_audio(payload)
}

#[command]
pub(crate) async fn set_text_selection_suppressed<R: Runtime>(
    app: AppHandle<R>,
    payload: SetTextSelectionSuppressedRequest,
) -> Result<()> {
    app.native_bridge().set_text_selection_suppressed(payload)
}

#[command]
pub(crate) async fn install_package<R: Runtime>(
    app: AppHandle<R>,
    payload: InstallPackageRequest,
) -> Result<InstallPackageResponse> {
    app.native_bridge().install_package(payload)
}

#[command]
pub(crate) async fn set_system_ui_visibility<R: Runtime>(
    app: AppHandle<R>,
    payload: SetSystemUIVisibilityRequest,
) -> Result<SetSystemUIVisibilityResponse> {
    app.native_bridge().set_system_ui_visibility(payload)
}

#[command]
pub(crate) async fn get_status_bar_height<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetStatusBarHeightResponse> {
    app.native_bridge().get_status_bar_height()
}

#[command]
pub(crate) async fn get_sys_fonts_list<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSysFontsListResponse> {
    app.native_bridge().get_sys_fonts_list()
}

#[command]
pub(crate) async fn intercept_keys<R: Runtime>(
    app: AppHandle<R>,
    payload: InterceptKeysRequest,
) -> Result<()> {
    app.native_bridge().intercept_keys(payload)
}

#[command]
pub(crate) async fn lock_screen_orientation<R: Runtime>(
    app: AppHandle<R>,
    payload: LockScreenOrientationRequest,
) -> Result<()> {
    app.native_bridge().lock_screen_orientation(payload)
}

#[command]
pub(crate) async fn iap_is_available<R: Runtime>(
    app: AppHandle<R>,
) -> Result<IAPIsAvailableResponse> {
    app.native_bridge().iap_is_available()
}

#[command]
pub(crate) async fn iap_initialize<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPInitializeRequest,
) -> Result<IAPInitializeResponse> {
    app.native_bridge().iap_initialize(payload)
}

#[command]
pub(crate) async fn iap_fetch_products<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPFetchProductsRequest,
) -> Result<IAPFetchProductsResponse> {
    app.native_bridge().iap_fetch_products(payload)
}

#[command]
pub(crate) async fn iap_purchase_product<R: Runtime>(
    app: AppHandle<R>,
    payload: IAPPurchaseProductRequest,
) -> Result<IAPPurchaseProductResponse> {
    app.native_bridge().iap_purchase_product(payload)
}

#[command]
pub(crate) async fn iap_restore_purchases<R: Runtime>(
    app: AppHandle<R>,
) -> Result<IAPRestorePurchasesResponse> {
    app.native_bridge().iap_restore_purchases()
}

#[command]
pub(crate) async fn get_system_color_scheme<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSystemColorSchemeResponse> {
    app.native_bridge().get_system_color_scheme()
}

#[command]
pub(crate) async fn get_safe_area_insets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSafeAreaInsetsResponse> {
    app.native_bridge().get_safe_area_insets()
}

#[command]
pub(crate) async fn get_screen_brightness<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetScreenBrightnessResponse> {
    app.native_bridge().get_screen_brightness()
}

#[command]
pub(crate) async fn set_screen_brightness<R: Runtime>(
    app: AppHandle<R>,
    payload: SetScreenBrightnessRequest,
) -> Result<SetScreenBrightnessResponse> {
    app.native_bridge().set_screen_brightness(payload)
}

#[command]
pub(crate) async fn get_external_sdcard_path<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetExternalSDCardPathResponse> {
    app.native_bridge().get_external_sdcard_path()
}

#[command]
pub(crate) async fn open_external_url<R: Runtime>(
    app: AppHandle<R>,
    payload: OpenExternalUrlRequest,
) -> Result<OpenExternalUrlResponse> {
    app.native_bridge().open_external_url(payload)
}

/// See [`ShowLookupPopoverRequest`] in `models.rs` for platform-by-
/// platform behavior. The mobile bridge dispatches into the iOS /
/// Android plugin; desktop returns `UnsupportedPlatformError` and the
/// TS layer keeps the macOS-specific path going through the
/// top-level `show_lookup_popover` Tauri command (AppKit HUD).
#[command]
pub(crate) async fn show_lookup_popover<R: Runtime>(
    app: AppHandle<R>,
    payload: ShowLookupPopoverRequest,
) -> Result<ShowLookupPopoverResponse> {
    app.native_bridge().show_lookup_popover(payload)
}

#[command]
pub(crate) async fn select_directory<R: Runtime>(
    app: AppHandle<R>,
    callback_state: State<'_, DirectoryCallbackState<R>>,
) -> Result<SelectDirectoryResponse> {
    let result = app.native_bridge().select_directory()?;

    if let Some(dir_path) = &result.path {
        let path = PathBuf::from(dir_path);

        if let Ok(callback_guard) = callback_state.callback.lock() {
            if let Some(callback) = callback_guard.as_ref() {
                callback(&app, &path);
            }
        }
    }

    Ok(result)
}

#[command]
pub(crate) async fn get_storefront_region_code<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetStorefrontRegionCodeResponse> {
    app.native_bridge().get_storefront_region_code()
}

#[command]
pub(crate) async fn request_manage_storage_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RequestManageStoragePermissionResponse> {
    app.native_bridge().request_manage_storage_permission()
}

#[command]
pub(crate) async fn set_sync_passphrase<R: Runtime>(
    app: AppHandle<R>,
    payload: SetSyncPassphraseRequest,
) -> Result<SyncPassphraseResponse> {
    app.native_bridge().set_sync_passphrase(payload)
}

#[command]
pub(crate) async fn get_sync_passphrase<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GetSyncPassphraseResponse> {
    app.native_bridge().get_sync_passphrase()
}

#[command]
pub(crate) async fn clear_sync_passphrase<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SyncPassphraseResponse> {
    app.native_bridge().clear_sync_passphrase()
}

#[command]
pub(crate) async fn is_sync_keychain_available<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SyncKeychainAvailableResponse> {
    app.native_bridge().is_sync_keychain_available()
}

#[command]
pub(crate) async fn set_secure_item<R: Runtime>(
    app: AppHandle<R>,
    payload: SetSecureItemRequest,
) -> Result<SecureItemResponse> {
    app.native_bridge().set_secure_item(payload)
}

#[command]
pub(crate) async fn get_secure_item<R: Runtime>(
    app: AppHandle<R>,
    payload: GetSecureItemRequest,
) -> Result<GetSecureItemResponse> {
    app.native_bridge().get_secure_item(payload)
}

#[command]
pub(crate) async fn clear_secure_item<R: Runtime>(
    app: AppHandle<R>,
    payload: GetSecureItemRequest,
) -> Result<SecureItemResponse> {
    app.native_bridge().clear_secure_item(payload)
}

#[command]
pub(crate) async fn refresh_eink_screen<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RefreshEinkScreenResponse> {
    app.native_bridge().refresh_eink_screen()
}

#[command]
pub(crate) async fn update_reading_widget<R: Runtime>(
    app: AppHandle<R>,
    payload: UpdateReadingWidgetRequest,
) -> Result<()> {
    app.native_bridge().update_reading_widget(payload)
}

/// Snapshot a region of the calling webview and return it as binary PNG
/// (`tauri::ipc::Response`, no JSON encoding) for the mesh page-curl
/// texture (#555). Platforms without a capture implementation reject,
/// which the JS side treats as "fall back to the CSS curl".
#[command]
pub(crate) async fn capture_webview_region<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    payload: CaptureWebviewRegionRequest,
) -> Result<tauri::ipc::Response> {
    let png = app
        .native_bridge()
        .capture_webview_region(&window, payload)?;
    Ok(tauri::ipc::Response::new(png))
}

/// Read cookies for `payload.url` out of the NAS remote-login popup webview
/// (`payload.label`), joined into a ready-to-send `Cookie` header value.
///
/// The popup is a separate `WebviewWindow`, not a child webview of the
/// calling window, so we look it up app-wide by label (`Manager::get_webview`,
/// which requires the `unstable` tauri feature — enabled on the app crate)
/// rather than restricting the search to the calling window's own webviews.
///
/// Desktop and iOS use `tauri::Webview::cookies_for_url`, which reads the
/// per-webview WKWebView/WebView2/WebKitGTK cookie store directly. Android's
/// `wry` cookie APIs are unimplemented (always empty), so there we go
/// through the mobile plugin instead, which reads Android's app-wide
/// `android.webkit.CookieManager` — the same store every system WebView
/// writes to, so `label` isn't needed there.
#[command]
pub(crate) async fn get_webview_cookies<R: Runtime>(
    app: AppHandle<R>,
    payload: GetWebviewCookiesRequest,
) -> Result<GetWebviewCookiesResponse> {
    #[cfg(target_os = "android")]
    {
        app.native_bridge().get_webview_cookies_android(payload)
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri::{Manager, Url};

        let webview = app.get_webview(&payload.label).ok_or_else(|| {
            crate::Error::NativeBridgeError(format!("no webview with label '{}'", payload.label))
        })?;
        let url = Url::parse(&payload.url)
            .map_err(|e| crate::Error::NativeBridgeError(format!("invalid url: {e}")))?;
        let cookies = webview
            .cookies_for_url(url)
            .map_err(|e| crate::Error::NativeBridgeError(e.to_string()))?;
        let cookie_header = cookies
            .iter()
            .map(|c| format!("{}={}", c.name(), c.value()))
            .collect::<Vec<_>>()
            .join("; ");
        Ok(GetWebviewCookiesResponse { cookie_header })
    }
}

/// How often the title-bar loading indicator's dots animate, in
/// milliseconds.
const NAS_LOADING_TITLE_INTERVAL_MS: u64 = 400;

/// Minimum time the local loading page (see `NAS_LOADING_PAGE_ASSET`)
/// stays up before navigating on to the real NAS URL. `PageLoadEvent::
/// Finished` means the DOM finished loading, not that it's been painted —
/// navigating away synchronously on that event can tear the page down
/// before it renders a single frame.
const NAS_LOADING_PAGE_MIN_DISPLAY_MS: u64 = 300;

/// An in-page HTML overlay was tried first, but it can't paint anything
/// until the webview surface itself has painted at least once — for a
/// popup pointed straight at a third-party (often slow, self-signed-cert)
/// NAS origin, that first paint can lag well behind window creation, so
/// the popup looked "stuck" on a blank/black surface no matter how early
/// the injected script ran. The window's native title bar has no such
/// dependency — it's OS chrome, rendered the instant the window exists —
/// so that's what carries the loading indicator instead: an animated
/// "· / ·· / ···" suffix appended to the title while the page loads,
/// swapped back to the plain title once it finishes (or the window is
/// closed, via the `loading` flag simply stopping the animation task).
fn spawn_nas_loading_title_animation<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    base_title: String,
    loading: Arc<AtomicBool>,
) {
    // A plain OS thread rather than `tauri::async_runtime::spawn` — this
    // only ever sleeps and calls `set_title` (which dispatches through the
    // runtime's own thread-safe event-loop proxy), so it doesn't need an
    // async executor and avoids pulling in `tokio` as a direct dependency
    // just for `time::sleep`.
    std::thread::spawn(move || {
        const FRAMES: [&str; 3] = [".", "..", "..."];
        let mut frame = 0usize;
        while loading.load(Ordering::SeqCst) {
            let _ = window.set_title(&format!(
                "{base_title} (Loading{})",
                FRAMES[frame % FRAMES.len()]
            ));
            frame += 1;
            std::thread::sleep(std::time::Duration::from_millis(
                NAS_LOADING_TITLE_INTERVAL_MS,
            ));
        }
        let _ = window.set_title(&base_title);
    });
}

/// Bundled app asset (see `public/nas-loading.html`) shown as the popup's
/// *first* navigation target instead of the external NAS URL directly.
///
/// A `data:` URL was tried first for this (no network round trip needed, so
/// it paints essentially the instant the window exists), but any CSS at all
/// — inline `style`, or a class defined in a `<style>` block, on any
/// element — left the whole document blank once Tauri's `webview-data-url`
/// feature injects its required CSP `<meta>` tag into a `data:`-origin
/// document; verified across several isolated reproductions that the HTML
/// string itself was never mangled, so this looks like a WebKit-side quirk
/// with CSP `<meta>` tags on `data:` (opaque-origin) documents specifically.
/// A bundled asset sidesteps the whole thing: it loads through the same
/// `tauri://localhost` + CSP path every other page in this app already uses
/// successfully, so CSS/JS just works.
const NAS_LOADING_PAGE_ASSET: &str = "nas-loading.html";

/// Create the NAS remote-login popup window (see
/// `GetWebviewCookiesRequest`/`get_webview_cookies` for how the frontend
/// later reads its cookies). A dedicated command rather than the frontend's
/// plain `new WebviewWindow(...)` because both the loading-page-then-navigate
/// sequencing (see `NAS_LOADING_PAGE_ASSET`) and the title-bar loading
/// animation (see `spawn_nas_loading_title_animation`) need the Rust-only
/// `WebviewWindowBuilder::on_page_load`/`WebviewWindow::navigate` hooks,
/// which have no JS-side equivalent.
#[command]
pub(crate) async fn create_nas_login_window<R: Runtime>(
    app: AppHandle<R>,
    payload: CreateNasLoginWindowRequest,
) -> Result<()> {
    let target_url = tauri::Url::parse(&payload.url)
        .map_err(|e| crate::Error::NativeBridgeError(format!("invalid url: {e}")))?;
    let base_title = payload.title.clone();

    let loading = Arc::new(AtomicBool::new(true));
    // Gates the one-time hop from the local loading page to `target_url` —
    // `on_page_load` fires `Finished` for every navigation in this window
    // (the loading page's own load, then the real NAS page's), and only
    // the first of those should trigger the navigate.
    let navigated_to_target = Arc::new(AtomicBool::new(false));

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        &payload.label,
        tauri::WebviewUrl::App(std::path::PathBuf::from(NAS_LOADING_PAGE_ASSET)),
    )
    .inner_size(payload.width, payload.height)
    .center()
    .resizable(true)
    .title(format!("{base_title} (Loading...)"))
    .background_color(tauri::webview::Color(255, 255, 255, 255))
    .on_page_load(move |window, event_payload| match event_payload.event() {
        tauri::webview::PageLoadEvent::Started => {
            loading.store(true, Ordering::SeqCst);
            spawn_nas_loading_title_animation(window, base_title.clone(), loading.clone());
        }
        tauri::webview::PageLoadEvent::Finished => {
            if !navigated_to_target.swap(true, Ordering::SeqCst) {
                // `Finished` means the loading page's DOM is done loading,
                // not that it's been painted yet — navigating on to
                // `target_url` synchronously here can tear the page down
                // before it ever renders a frame, so the loading page
                // never actually becomes visible. A short delay gives it
                // time to actually show up on screen first.
                let win = window.clone();
                let url = target_url.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(
                        NAS_LOADING_PAGE_MIN_DISPLAY_MS,
                    ));
                    let _ = win.navigate(url);
                });
            } else {
                loading.store(false, Ordering::SeqCst);
            }
        }
    });
    if let Some(user_agent) = &payload.user_agent {
        builder = builder.user_agent(user_agent);
    }
    builder
        .build()
        .map_err(|e| crate::Error::NativeBridgeError(e.to_string()))?;
    Ok(())
}
