# Snapture Privacy Policy

_Last updated: August 17, 2026_

Snapture is a browser extension that captures screenshots of the current tab — full-page,
visible area, or a user-selected region. It is built to be private by design.

## Data collection

**Snapture does not collect, transmit, sell, or share any data. Period.**

- No analytics, no telemetry, no tracking of any kind.
- No external network requests — the extension contains no remote code and talks to no server.
- Screenshots, settings, and screenshot history are stored **only on your device**, using the
  browser's local storage (`chrome.storage.local`) and IndexedDB.
- Nothing ever leaves your browser unless **you** explicitly download a screenshot to disk or
  copy it to your clipboard.

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab` | Temporary access to the tab you explicitly capture via the popup or a keyboard shortcut. |
| `scripting` | Injects the capture script (page measurement, scrolling, selection overlay) only when you start a capture. |
| `storage` | Saves your settings and local screenshot-history metadata on your device. |
| `downloads` | Saves finished screenshots to your computer when you click Download. |
| `clipboardWrite` | Copies a screenshot to your clipboard when you click Copy. |
| Host access (`<all_urls>`) | Required by Chrome's `captureVisibleTab` API for keyboard-shortcut captures and Recapture. Snapture only ever captures the tab you explicitly asked it to capture. |

## Data removal

Deleting a screenshot in the extension, clearing the history, or uninstalling the extension
permanently removes all locally stored data. There is nothing to delete anywhere else, because
nothing is stored anywhere else.

## Changes

Any change to this policy will be published in this repository and reflected in the extension's
Chrome Web Store listing.

## Contact

Questions or concerns: open an issue at
[github.com/oii-nasif/Snapture/issues](https://github.com/oii-nasif/Snapture/issues).
