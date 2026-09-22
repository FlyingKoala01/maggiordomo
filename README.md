# Maggiordomo

A developer's butler in the browser toolbar. Dev links, markdown notes, a JSON beautifier and the rest of the small tools you keep reaching for, all running locally inside the extension. No build step, no accounts, nothing leaves your machine.

## Tools

| Tool | What it does |
| --- | --- |
| Dev links | Save pages and links with tags and notes. Search by words or `#tag`, pin favourites, import/export JSON or a browser bookmarks HTML file. Right-click any page or link → *Save to Maggiordomo*. |
| Markdown | Multiple notes with live preview (GitHub-flavored), autosave, copy as HTML, download `.md`, print to PDF. Rendered with marked and sanitized with DOMPurify. |
| Markdown viewer | Open any `.md` file in the browser (`file://`, raw GitHub or Gist URLs) and it renders in place: table of contents, front matter, raw/rendered toggle, light/dark, copy HTML, *Save to notes*. |
| Word / Excel | Drop a `.docx` or spreadsheet (`.xlsx`, `.xlsm`, `.xls`, `.csv`, `.tsv`, `.ods`) to read it in the browser. Word: content, headings, lists, tables and images via mammoth, with copy as HTML/text, print, and *Save as markdown note*. Sheets: tabs per sheet, sticky headers, row filter, copy as TSV/markdown/JSON, CSV export. Right-click a link to such a file → *Open with Maggiordomo*. |
| JSON | Beautify, minify, validate with line/column and *jump to error*, sort keys, collapsible tree view (click a value to copy it, alt+click for its path), escape/unescape string-wrapped JSON, and a best-effort *Repair* for JS-style input. |
| Encode / Decode | Base64 (plain and URL-safe), URL component/URI, HTML entities, hex, binary, unicode escapes, ROT13, plus decimal/hex/octal/binary conversion. |
| JWT | Decode header and payload, read `exp`/`iat`/`nbf` as dates, verify HS256/384/512, RS*, PS* and ES* signatures with a secret or PEM public key, and sign HS tokens. |
| Regex | Live highlighting, match table with capture groups, replace preview, cheat sheet. |
| Timestamp | Live clock, convert Unix seconds/ms/µs, ISO 8601 and most date strings, show the moment in other IANA time zones. |
| UUID / Random | UUID v4 and v7, UUID inspector, random strings from a chosen alphabet, random hex bytes. Uses Web Crypto. |
| Hash / HMAC | MD5, SHA-1, SHA-256/384/512 of text or a file, optional HMAC key, compare against an expected digest. |
| Color | Parse any CSS color, convert to hex/rgb/hsl, shades and tints, WCAG contrast checks. |
| Text | Case conversion (camel, snake, kebab, …), line sorting/dedupe, slugify, counts, lorem ipsum. |

Keyboard: `Alt+Shift+M` opens the workbench, `Alt+Shift+S` saves the current tab. Inside the workbench `Alt+1`…`Alt+9` switch tools. In the popup, arrow keys and Enter open a link.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick this folder.

4. To render local `.md` files, open the extension's **Details** page and enable **Allow access to file URLs**. Then open any markdown file (drag it into a tab or use a `file:///` path).

The toolbar popup shows your links and shortcuts to the tools. The full workbench opens in a tab (also available as the extension's options page). All data lives in `chrome.storage.local`; use **Export** / **Import** in the workbench sidebar for backups.

## Layout

```
manifest.json          Manifest V3
icons/                 generated PNG icons
vendor/                marked (MIT), DOMPurify (Apache-2.0/MPL-2.0), mammoth (BSD-2), SheetJS CE (Apache-2.0); vendored, no CDN
src/background.js      service worker: context menus, keyboard commands, badge feedback
src/content/           content script that renders raw .md files in place
src/popup/             toolbar popup: quick links, save current tab, tool shortcuts
src/workbench/         full-page shell: sidebar, hash routing, theme, export/import
src/shared/            storage wrapper, DOM helpers, links model, shared CSS
src/tools/*.js         one module per tool, registered in src/tools/index.js
test/run.js            unit tests for the pure logic (node --test)
```

Each tool exports `{ id, name, icon, hint, mount(container, { params }) }` and can return `{ cleanup }`. Adding a tool is a new file plus one line in `src/tools/index.js`.

## Development

```
npm test        # unit tests (Node 20+)
npm run zip     # build dist/maggiordomo-<version>.zip for the store or sharing

npm i -D puppeteer-core
BROWSER="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" npm run smoke
                # loads the extension headless, mounts every tool, checks JSON/markdown/links/popup
```

Everything is plain ES modules loaded straight by the browser, so editing a file and clicking *Reload* on the extensions page is the whole loop.

## Notes

- Google Chrome's branded builds no longer accept `--load-extension` for automated testing; Edge and Chrome for Testing still do.
- Firefox needs `background.scripts` instead of `background.service_worker` and does not expose `/_favicon/`; it is not supported yet.
- MD5 is provided for checksums only, not for anything security related.
- Word rendering keeps content, not layout: no page breaks, headers, footers or exact fonts. Spreadsheets show saved formula results, no recalculation and no charts. PowerPoint is deliberately not supported; browser-side renderers for it are too unfaithful to be useful.
- Opening a document from an `http(s)` link asks for permission to that site the first time (optional host permission, granted per origin). Local links need "Allow access to file URLs".
- **Open Word/Excel downloads in viewer** (switch at the bottom of the workbench sidebar, off by default): when a `.docx`, `.xlsx`, `.xls`, `.csv` or `.ods` download starts, whether from a website or from typing a `file:///` path into the address bar, it is cancelled and the file opens in the viewer instead. Turning it on asks once for the `downloads` permission; turning it off gives it back. The viewer offers *Download the file instead* for the cases where you really wanted the file.
