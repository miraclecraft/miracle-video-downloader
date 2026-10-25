# Development guide

Miracle - Video Downloader is a Manifest V3 extension with no build step: the folder is loaded as-is with **Load unpacked**. Only the YouTube companion app is compiled, and its installer does that on the user's machine.

## How it works

- **Network detection** – the service worker watches responses for video files (`video/*`, `.mp4`, `.webm`, `.mov`, `.mkv`, …) and streaming manifests (HLS `.m3u8`, DASH `.mpd`).
- **Page detection** – a content script picks up `<video>` / `<source>` elements with direct URLs.
- **Direct files** are handed to the browser's download manager.
- **HLS** – quality picker, parallel segment downloads with retries, AES-128 decryption, separate audio renditions merged in, MPEG-TS remuxed to `.mp4`.
- **DASH** – video quality and audio track pickers; SegmentTemplate, SegmentTimeline, SegmentList and single-file representations.
- **Facebook & Instagram** – the CDN serves byte-range slices; the range parameters are stripped to get whole files, each file's MP4 header is probed to tell video-only from audio-only, and the audio is paired with its video via the asset id in the `efg` URL parameter (falling back to "detected at about the same time").
- **Merging** runs [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) in an offscreen document (stream copy, no re-encoding).
- **Referer** – the page's `Referer` is added to the extension's own requests with session `declarativeNetRequest` rules, which many CDNs require.
- **YouTube** – handled by the companion app (below), because YouTube's streams can't be fetched from an extension.

## Project layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: detection, probing, per-tab state, badge, download jobs, Referer rules, companion app connection |
| `content.js` | Scans pages for `<video>` elements |
| `offscreen/` | Offscreen document: downloads segments/tracks, merges with ffmpeg, parses DASH |
| `popup/` | Toolbar popup UI |
| `lib/hls.js` | M3U8 playlist parser |
| `lib/dash.js` | MPD manifest parser |
| `lib/mp4.js` | MP4 header probe (tracks, resolution, duration) and container sniffing |
| `lib/social.js` | Facebook / Instagram CDN URL handling |
| `lib/youtube.js` | YouTube video page detection |
| `lib/common.js` | Shared helpers (entry grouping, formatting, filenames) |
| `companion/` | YouTube companion app (C# native messaging host) and its installer/uninstaller |
| `vendor/` | ffmpeg.wasm runtime (`@ffmpeg/ffmpeg`, `@ffmpeg/core`), committed so no npm install is needed |
| `scripts/vendor.mjs` | Copies ffmpeg.wasm from `node_modules` into `vendor/` |
| `test/merge-test.html` | Browser smoke test for DASH parsing + ffmpeg merge |

## Running and debugging

1. Load the folder with **Load unpacked** (see the README).
2. After editing code, click **Reload** on the extension card.
3. Debug:
   - **Service worker** – the *service worker* link on the extension card
   - **Popup** – right-click the popup → **Inspect**
   - **Offscreen downloader** – *Inspect views → offscreen.html* on the extension card

`test/merge-test.html` needs to be served over http from the repo root, for example `npx http-server .` and then open `/test/merge-test.html`.

## Extension ID and `key.pem`

`manifest.json` contains a `key`, which fixes the extension ID to `abldpofjnohhincmipncnocmahoknblo` on every machine. The companion app only accepts connections from that ID.

The matching private key, `key.pem`, is **not** in the repository (see `.gitignore`). Keep a backup of it somewhere safe: it's needed to pack the extension as a `.crx` with the same ID.

## YouTube companion app

`companion/host.cs` is a small [native messaging](https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/native-messaging) host. The extension talks to it over stdin/stdout (4-byte length + JSON), and it runs `yt-dlp` with `ffmpeg` to save MP4 files to the user's Downloads folder.

`companion/install.ps1`:

- compiles `host.cs` with the .NET Framework C# compiler included in Windows,
- downloads `yt-dlp.exe` and `ffmpeg.exe` / `ffprobe.exe` into `%LOCALAPPDATA%\MiracleVideoDownloader`,
- registers the host for Edge, Chrome and Brave under `HKCU` (no admin rights).

Options: `-SkipFfmpeg` (keep the existing ffmpeg), `-ExtensionId <id>,<id>` (allow other extension IDs, e.g. a store build).

Requests the host understands: `ping`, `info`, `download`, `cancel`, `reveal`, `update`. Downloads report `progress` events and finish with `done`, `error` or `cancelled`.

## Updating ffmpeg.wasm

```sh
npm install
npm run vendor
```

Change the versions in `package.json` first if you want a newer release.

## Releasing

1. Bump `version` in `manifest.json` (and `package.json`), and add an entry to `CHANGELOG.md`.
2. Commit, tag (`git tag v0.3.0`) and push the tag.
3. On GitHub, create a release from the tag. GitHub attaches the source ZIP automatically, which is what users download.

## Limitations

- DRM-protected content (Widevine, PlayReady, FairPlay, SAMPLE-AES) is intentionally not supported.
- The companion app is Windows-only, and YouTube live streams aren't supported.
- Live DASH isn't supported; live HLS saves only the segments currently listed.
- Merged downloads are assembled in memory, so very long videos use a lot of RAM (ffmpeg.wasm is limited to about 2 GB).
- On busy Facebook/Instagram feeds the time-based audio pairing fallback can pick the wrong audio.
- The Chrome Web Store doesn't accept extensions that download from YouTube; a store build would need YouTube support removed.
