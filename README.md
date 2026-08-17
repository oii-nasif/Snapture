# Snapture

A privacy-first, Manifest V3 browser extension that captures a webpage as a full-page,
visible-area, or user-selected screenshot — scrolling and stitching entirely on-device, with
no backend and no network calls. Built with TypeScript, esbuild, and the Chrome extension APIs.
Works in Chrome and any Chromium-based browser that supports Manifest V3 (including Arc).

## Features

- **Full page capture** — scrolls the page top to bottom, capturing and stitching every section
  into one seamless image, including content below the fold.
- **Visible area capture** — a single, near-instant screenshot of what's currently on screen.
- **Selected area capture** — drag out a rectangle (with live dimensions, Esc to cancel,
  Enter or a Capture button to confirm) and capture just that region.
- **Works on apps that scroll an inner container** (Confluence, Notion, dashboards) — the
  extension detects what actually scrolls instead of assuming the window does.
- Small sticky/fixed elements (headers, cookie banners, chat widgets) are hidden during
  intermediate scroll steps so they don't repeat down the stitched image; large fixed/sticky
  layout wrappers are deliberately left alone (see *Sticky element handling* below).
- Waits for in-view images to finish loading and for layout to settle before each frame, and
  handles pages that grow while scrolling (with configurable height/time caps so infinite-scroll
  pages can't run away).
- Live progress in the popup (`Ready` → `Preparing…` → `Capturing…` → `Stitching…`); the popup
  closes itself when the capture completes and the preview tab opens. On failure it stays open
  and shows the error.
- **Cancel** a running capture at any time from the popup — the page is restored to its exact
  pre-capture state.
- Preview page with dimensions/file size, download (PNG/JPEG with quality slider),
  copy-to-clipboard, recapture, and delete.
- Screenshot history with thumbnails, stored locally with a configurable size limit
  (10/25/50/100); oldest entries and their image data are pruned automatically.
- Settings for capture behavior, output format, history, and light/dark/system theme —
  all auto-saved.
- Configurable keyboard shortcuts (`Alt+Shift+F` / `Alt+Shift+V` / `Alt+Shift+S`).

## Project structure

```text
src/
├── manifest.json                  MV3 manifest
├── background/service-worker.ts   Message router + capture orchestration, downloads
├── content/                       Injected on demand into the captured page:
│   ├── capture-controller.ts        message entry point
│   ├── page-analyzer.ts             DOM measurement, scroll-root detection, settle waits
│   ├── scroll-manager.ts            scrolling (window or inner element) + position restore
│   ├── scroll-math.ts               pure scroll-step planning
│   ├── sticky-element-manager.ts    hide/restore small sticky elements per frame
│   └── selection-manager.ts         drag-to-select overlay
├── capture/                       Runs in the service worker:
│   ├── capture-session.ts           full-page/visible/selection pipelines
│   ├── viewport-capture.ts          captureVisibleTab with rate-limit throttling/retry
│   ├── screenshot-stitcher.ts       OffscreenCanvas compositing
│   ├── stitch-math.ts               pure stitch/crop planning
│   └── image-processor.ts           decode/encode/crop/thumbnail/clipboard helpers
├── popup/ preview/ settings/ history/   UI surfaces (html + ts + css each)
├── shared/                        Types, messaging contracts, storage, constants, theme, utils
└── icons/                         Generated PNGs (see scripts/generate-icons.mjs)

scripts/                           esbuild bundler + procedural icon generator
tests/                             Vitest unit tests (see Testing)
```

Settings, history metadata, and image bytes are read and written **directly** from any extension
page via `shared/storage.ts` (`chrome.storage.local` for settings/metadata, IndexedDB for the
actual image bytes, since a handful of full-page PNGs can easily exceed the ~10MB
`chrome.storage.local` quota). The background service worker is only in the loop for actions that
require a privileged API it alone can use: orchestrating tab/content-script capture and
`chrome.downloads`. This keeps message-passing to a minimum.

Image stitching and cropping run directly in the service worker via `OffscreenCanvas` (supported
in Chrome's extension service workers). Clipboard writes (`navigator.clipboard.write`) happen
directly from whichever visible page the user clicked "Copy" in — popup or preview — via
`capture/image-processor.ts`'s `copyBlobToClipboard`, rather than through an offscreen document:
the Async Clipboard API requires the calling document to be *focused*, and a hidden offscreen
document can never hold focus, so routing the write through one reliably fails with
"Document is not focused". A real, visible extension page that the user just clicked in is.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Grants temporary access to whatever tab is active when you open the popup or press a shortcut — the reliable path for `captureVisibleTab` and content-script injection. Doesn't depend on any "site access" setting, and never grants access to tabs you haven't interacted with. |
| `scripting` | Inject the content script on demand (page analysis, scrolling, selection overlay) — only when a capture is requested. |
| `storage` | Save settings and history metadata locally. |
| `downloads` | Save the finished screenshot to disk. |
| `clipboardWrite` | Copy a screenshot to the clipboard reliably even though the write happens a few `await`s after the click that triggered it. |
| `host_permissions` (`<all_urls>`) | Required for `chrome.tabs.captureVisibleTab`, which only accepts the literal `<all_urls>` pattern or an `activeTab` grant — granular patterns like `http://*/*` are rejected. This is what lets the **keyboard shortcuts** work without opening the popup first (`activeTab` alone only auto-grants on the special `_execute_action` command, not custom ones) and lets **Recapture** re-shoot the original tab from the preview page, where no user gesture on the source tab exists. Some browsers/managed profiles restrict broad host permissions (via the per-extension "site access" setting or enterprise policy) independently of what the manifest declares; when that happens the popup-driven flow still works fine via `activeTab`, but shortcuts and Recapture may require opening the popup on that tab first. |

No analytics, no remote code, no external network requests — everything happens locally in the
browser.

## Building

Requires Node.js 20+.

```powershell
npm install
npm run build      # production build → dist/
npm run dev        # incremental rebuild on file changes
npm test           # unit tests (vitest)
npm run lint       # eslint over src/, scripts/, tests/
npm run typecheck  # tsc --noEmit (strict mode)
```

`npm run build` bundles each entry point with esbuild and copies static assets into `dist/`.
The toolbar icons are generated procedurally (`node scripts/generate-icons.mjs`) so the
repository doesn't depend on binary image assets or an image-processing library.

## Loading the extension

1. `npm install && npm run build`
2. Open `chrome://extensions` (works in Arc too — Arc is Chromium-based and serves the same page).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `dist/` folder.

> **Note:** some managed/enterprise Chrome installations disable unpacked ("developer mode")
> extensions entirely via policy. If **Load unpacked** is missing or the extension doesn't appear
> after loading, that's a browser policy restriction, not an extension bug — try a personal Chrome
> profile or Arc instead.

To pick up code changes, run `npm run build` (or leave `npm run dev` running) and click the
refresh icon on the extension's card in `chrome://extensions`. If `manifest.json` permissions
changed, remove and re-load the unpacked extension instead.

## Keyboard shortcuts

Default bindings (changeable at `chrome://extensions/shortcuts`):

| Shortcut | Action |
|---|---|
| `Alt+Shift+F` | Capture full page |
| `Alt+Shift+V` | Capture visible area |
| `Alt+Shift+S` | Capture selected area |

## The full-page capture pipeline

1. The content script is injected on demand (a PING check avoids double-injection), then waits
   for the page's layout to settle before measuring anything, so a mid-hydration SPA isn't
   mismeasured.
2. `findScrollRoot` (`src/content/page-analyzer.ts`) figures out what actually scrolls. Most
   pages scroll `document.documentElement`, but plenty of apps — Confluence, Notion, many
   dashboards — fix the outer page and scroll a single inner `overflow: auto` container instead.
   If the document itself doesn't have meaningfully more scrollable height than the viewport,
   the content script picks the qualifying scrollable descendant with the **largest on-screen
   footprint** (deliberately not "most overflow content" — a small comment widget with a long
   hidden history must never outrank the real content pane). Every captured frame is then
   cropped to that container's on-screen rect before stitching.
3. **Sticky element handling** (`sticky-element-manager.ts`): small fixed/sticky elements are
   classified as header-like or footer-like relative to the captured region and hidden except in
   the one frame where they belong, so they don't repeat down the image. The scan reruns before
   **every** frame (after each scroll's settle wait), not just once up front — apps like
   Confluence mount floating UI *during* scrolling (cloned sticky table headers, lazy toolbars,
   chat bubbles), and anything born mid-capture would otherwise repeat at every frame boundary.
   The walk also descends into open shadow roots, where floating widgets often live. Crucially,
   anything taller than 30% of the capture area — or whose DOM subtree holds tall content — is
   left alone: apps like Confluence put the *entire content column* inside a sticky-positioned
   layout wrapper, and hiding that blanks the whole capture. A tall sticky sidebar repeating
   across frames is an acceptable cost; a blank page is not. Only `visibility` is ever touched
   (never `display`, so layout can't reflow), and everything is restored afterward.
4. `computeScrollSteps` (pure, unit-tested — `src/content/scroll-math.ts`) plans overlapping
   scroll positions from top to bottom.
5. For each step: scroll → wait. The configured **scroll delay is a hard floor**, not a hint —
   after it elapses, the wait extends further while the page's height is still changing (lazy
   append) and until in-view `<img>` elements finish loading. If the document grows mid-capture,
   the plan is extended live up to the configured max page height/duration; if the browser stops
   making scroll progress, capture ends there instead of looping forever. Frames are captured
   with `chrome.tabs.captureVisibleTab`, throttled below Chrome's per-second rate limit with
   backoff-and-retry if the limit is hit anyway.
6. The page is restored to its exact original state (sticky elements, scroll position) in a
   `finally` block, so a cancelled or failed capture never leaves the page modified.
7. `computeStitchPlan` (pure, unit-tested — `src/capture/stitch-math.ts`) decides exactly which
   pixel rows come from which captured frame — device-pixel-ratio aware, cropping overlaps so
   nothing is drawn twice — then `OffscreenCanvas` composites the final image, releasing each
   frame's bitmap as soon as it's drawn. Canvas dimension/area limits are checked up front so an
   impossible page fails with a clear message instead of a corrupt image.

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Scroll delay | 500 ms (100–3000) | Minimum wait after each scroll before capturing. Raise it (1000 ms+) for pages whose embedded content loads over the network as you scroll — e.g. Confluence/Jira Smart Link cards. |
| Scroll overlap | 24 px (0–200) | Overlap between consecutive frames so stitching never misses a seam. |
| Hide sticky elements | on | Hides *small* sticky headers/footers/widgets during middle frames. Turn off if a specific page renders oddly during capture. |
| Wait for lazy-loaded content | on | After the scroll delay, keeps waiting while page height is still changing. |
| Maximum page height | 30,000 px (5,000–60,000) | Caps runaway captures on infinite-scroll pages. |
| Maximum capture duration | 60 s (10–180) | On timeout the frames captured so far are stitched rather than discarded. |
| Format / JPEG quality | PNG / 90% | Also overridable per-download on the preview page. |
| Filename prefix | `screenshot` | Files save as `prefix-YYYY-MM-DD-HH-mm-ss.png` (or `.jpg`). |
| History | on, 25 items (10/25/50/100) | With history off, only the most recent capture is kept for preview. |
| Theme | System | System / Light / Dark, applied across all extension pages. |

## Testing

`npm test` runs **92 unit tests across 7 files** (Vitest; DOM-dependent suites run under jsdom):

| File | Covers |
|---|---|
| `scroll-math.spec.ts` | Scroll-step planning: overlap, clamping, single-viewport pages, growth extension. |
| `stitch-math.spec.ts` | Stitch planning: overlap cropping, partial last frame, DPR scaling, dropped no-op frames. |
| `page-analyzer.spec.ts` | Scroll-root detection (incl. the small-widget-must-not-hijack regression), image-settle waits, the scroll-delay floor. |
| `sticky-element-manager.spec.ts` | Classification, restore-on-cleanup, and the never-hide-tall-wrappers regression (the Confluence blank-capture bug). |
| `scroll-manager.spec.ts` | Window vs. inner-element scrolling, position restore, delay-floor regression. |
| `selection-manager.spec.ts` | Drag rect normalization, Esc/Enter, toolbar cancel + re-drag, teardown. |
| `capture-session.spec.ts` | The orchestration loop: cancellation, timeout, live plan growth, no-scroll-progress stop, crop routing, restore-on-error, error propagation. |

Manual test matrix for the built extension in Chrome/Arc:

- **Basic pages**: short page, long page, responsive layout, documentation page, blog page.
- **Complex pages**: sticky header, sticky sidebar, fixed footer, lazy-loaded images,
  inner-scroll-container apps (Confluence/Notion), very long pages, large tables, SPA dashboards.
- **Browser/display**: Chrome, Arc, different window sizes, high-DPI (Retina) displays.
- **Failure scenarios**: `chrome://` pages, PDF viewer tab, navigating away mid-capture, an
  extremely tall page (canvas limit), clipboard permission denied.

## Troubleshooting

- **Parts of the capture are blank or half-rendered** — the page renders content asynchronously
  as it scrolls (network-fetched embeds). Raise **Scroll delay** in Settings; 1000–2000 ms fixes
  most heavy pages at the cost of a slower capture.
- **A page renders oddly during capture** — try turning off **Hide sticky elements**; that
  bypasses the sticky-handling subsystem entirely.
- **"Unable to capture this page"** — browser-restricted pages (`chrome://…`, the Web Store,
  other extensions' pages, PDFs) can't be captured by any extension.
- **Full-page capture returns a single viewport** — the page probably uses a custom/virtualized
  scroller that doesn't rely on native `scrollTop`; the scroll-root heuristic can't drive those.
- **Copy to clipboard fails** — the tab performing the copy must be focused; click the preview
  tab first, then Copy.

## Known limitations

- Cross-origin iframes render as whatever the browser paints for them at capture time — content
  inside them isn't specially handled, matching how `captureVisibleTab` sees the page.
- Extremely tall pages are capped by the browser's own canvas size limits; the extension detects
  this ahead of time and fails with a clear message rather than corrupting the output.
- `captureVisibleTab` always captures a window's *foreground* tab, so **Recapture** briefly
  refocuses the original tab/window before re-running the pipeline.
- JS-driven virtualized scrollers (content positioned via transforms rather than native
  scrolling) aren't supported by the scroll-root heuristic.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
