# Changelog

## Unreleased

### Added

- **Copy text (OCR)** on the preview page — recognizes the text in a capture and copies it
  to the clipboard. Recognition runs fully on-device with a bundled tesseract.js engine
  (worker, wasm core, and English language data ship inside the extension; no network
  requests). Results are cached per capture in IndexedDB.
- **Full-text history search** — a search box on the history page filters captures by page
  title, URL, and the text recognized inside the screenshot. Captures are indexed lazily in
  the background with visible progress, and the index is reused by the preview page's
  Copy text button.

### Changed

- Extension pages now run under a CSP that includes `wasm-unsafe-eval`, required for the
  on-device OCR wasm core.
- The image IndexedDB gained an `ocr-text` store (schema v2); deleting a capture removes its
  recognized text along with the blob.

## 1.1.0 — 2026-08-17

### Fixed

- **Download from the preview page always failed** — `URL.createObjectURL` does not exist in
  MV3 service workers; downloads now hand `chrome.downloads` a data URL instead.
- **Recapture silently did nothing after the service worker idled** — the capture → source-tab
  mapping now persists in `chrome.storage.session` instead of worker memory.
- **`captureVisibleTab` permission**: host permissions changed from `http://*/*` + `https://*/*`
  to `<all_urls>` — Chrome only accepts the literal `<all_urls>` pattern (or an `activeTab`
  grant) for screen capture, and Recapture has no user gesture on the source tab to grant
  `activeTab`.
- **Preview image rendered vertically stretched** — the viewer's flexbox stretched the image to
  the container height while `max-width` clamped its width, distorting the aspect ratio.
- **`hidden` attribute was silently overridden** by author `display` rules: a deleted screenshot
  stayed visible next to the "no longer available" message, and the JPEG quality slider showed
  while PNG was selected. A global `[hidden] { display: none !important; }` rule fixes every
  surface.
- **Delete left stale state behind** — it now always removes both the history entry and the
  image blob (regardless of the current history setting), clears session pointers ("copy last",
  recapture target), resets the sidebar metadata, revokes the object URL, and reports failures
  instead of failing silently.
- **Selection overlay could leak into the captured image** — the content script now waits for a
  committed paint after tearing down the overlay before the frame is captured.
- **Content-script errors were masked** as a generic "the page did not respond correctly";
  they now propagate with the real error message.
- **A transient IndexedDB failure permanently broke storage** for the worker's lifetime — a
  failed database open is no longer cached.
- PDF URLs with query strings are now correctly recognized as non-capturable.

### Added

- **Cancel button** in the popup while a capture is running; the page is restored to its exact
  pre-capture state.
- Starting a capture while one is already running now reports "A capture is already in
  progress" instead of silently doing nothing.
- The popup's "Copy last screenshot" verifies the screenshot still exists before enabling
  itself.

## 1.0.0 — 2026-08-16

- Initial release: full-page, visible-area, and selected-area capture with on-device scrolling,
  stitching, preview, history, and settings.
