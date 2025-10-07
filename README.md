# Tab Renamer Bear

Rename any tab title in Chrome — and keep sites from changing it back.

![](./docs/poster.jpeg)

## Features

- Rename the current tab by clicking the toolbar icon
- Block the page from overwriting your custom title
- Persist titles across reloads and navigations
- Remap titles on browser startup (when Chrome restores your session)

## How it works (high level)

- A background service worker listens for the toolbar click, prompts you for a new title, and stores it in `chrome.storage.local` keyed by tab id and url.
- A content script overrides `document.title` so that, when a custom title is active, page scripts cannot overwrite it.
- On reload, navigation, or when the site tries to change its title, the extension reapplies your custom title.
- On browser startup, saved titles are remapped to restored tabs by URL, so your titles come back with your session.

## Install (unpacked)

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable “Developer mode” (top-right).
4. Click “Load unpacked” and select the project folder.

## Usage

1. Open any tab you want to rename.
2. Click the Tab Renamer Bear toolbar icon.
3. Enter a new title in the prompt and press OK.
   - Entering an empty value removes the custom title and restores the page’s original title.

Notes:

- While a custom title is active, attempts by the page to change its title are blocked.
- If you navigate within the same tab, your custom title persists and is reapplied.
- On full browser restart, titles are remapped by URL for restored tabs. If multiple open tabs share the same URL, the most recent saved one wins for that URL.

## Permissions explained

- `storage`: Save your custom titles locally on your device.
- `tabs`: Read tab info (id, url) to apply and track titles.
- `host_permissions: <all_urls>`: Allow the content script to run on all sites so titles can be set.

## Privacy

- No data leaves your browser. Titles are stored via `chrome.storage.local` only.
- No external network requests are made by the extension.

## Limitations

- Chrome/Chromium restricts extensions from running on certain pages (e.g., `chrome://*`, Chrome Web Store). The extension cannot rename titles on those pages.
- Favicons and other tab UI cannot be changed—only the text title.
- If you close a tab, its saved record may be cleaned up. Titles are restored on startup when Chrome restores the session and URLs still match.

## Troubleshooting

- “It doesn’t work on some pages”: Those pages may be restricted by Chrome (e.g., `chrome://`, Chrome Web Store) or the content script may not be allowed to run.
- “The page keeps changing the title”: Ensure you’ve set a custom title; while active, page changes are blocked. If it still changes, try clicking the icon again to reapply.
- “After restart the title didn’t come back”: Make sure Chrome restored your previous session and the tab’s URL matches the one saved. The remap uses URL matching.

## Developer guide

Project layout:

- `manifest.json`: MV3 manifest declaring permissions, background, action, and content script.
- `background.js`: Service worker. Stores titles in `chrome.storage.local`, applies them on events (`onClicked`, `onUpdated`, `onReplaced`, `onStartup`), remaps by URL on startup, and cleans up on tab close.
- `content.js`: Injected at `document_start`. Overrides `document.title` to block page changes when a custom title is active, handles prompts and applies/removes titles on message.
- `icons/`: Extension icons.

Recommended dev steps:

1. Load the extension unpacked as described above.
2. Open `chrome://extensions`, find Tab Renamer Bear, and click “Service worker” to view background logs.
3. Use the DevTools Console on a page to see content script logs when titles are applied/blocked.

## License

MIT — see `LICENSE`.
