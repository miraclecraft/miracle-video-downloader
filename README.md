# Miracle - Video Downloader

A free browser extension for **Microsoft Edge** and **Google Chrome** that finds the videos on the page you're watching and saves them to your computer with one click.

- Works on most websites that play video
- Saves **Facebook** and **Instagram** videos with sound
- Saves **YouTube** videos in the quality you pick, or just the audio (needs a small free add-on, see below)
- Handles streaming video (HLS / DASH) — the pieces are joined into one normal `.mp4` file
- No account, no ads, nothing is sent anywhere

---

## Install

> You only do this once. It takes about two minutes.

### 1. Download

Click the green **Code** button at the top of this page → **Download ZIP**, then extract the ZIP somewhere you'll keep it (for example `Documents\MiracleVideoDownloader`).

Don't delete or move the folder afterwards — the browser loads the extension from it.

### 2. Add it to your browser

**Microsoft Edge**

1. Go to `edge://extensions`
2. Turn on **Developer mode** (bottom left)
3. Click **Load unpacked** and choose the extracted folder

**Google Chrome**

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose the extracted folder

Tip: click the puzzle-piece icon in the toolbar and pin **Miracle - Video Downloader** so it's always visible.

### 3. YouTube add-on (optional)

YouTube can't be downloaded from inside the browser, so YouTube support uses a small helper app.

1. Open the extracted folder, then the `companion` folder
2. Double-click **`install.cmd`**
3. When it says **Installed**, close the window and restart your browser

It downloads two well-known free tools, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) (about 210 MB), and sets them up for your Windows user only. No admin rights are needed.

---

## How to use

1. Open a page with a video and **start playing it**
2. Click the **Miracle - Video Downloader** icon — the number on it shows how many videos were found
3. Pick a quality and click **Download**

The file is saved to your **Downloads** folder. Streams and videos that need audio and video joined show a progress bar in the menu while they're being prepared.

On YouTube, the menu shows the video's title and a quality list instead. Pick a quality (or **Audio only**) and click **Download**. When it's done, click **Show in folder**.

---

## Troubleshooting

**"No videos detected on this page yet"**
Start playing the video, then open the menu again. Some sites only load the video once it plays. If it still doesn't show, reload the page and play it again.

**YouTube says the companion app is missing**
Run `companion\install.cmd` (step 3 above), then restart the browser completely.

**A YouTube download fails**
YouTube changes often. Click **Update yt-dlp and retry** in the menu.

**Windows shows a security warning when running `install.cmd`**
That's normal for scripts downloaded from the internet. Choose **Run** (or **More info → Run anyway**).

**The browser warns about developer mode extensions**
Extensions loaded this way show that notice. It's safe to dismiss it.

**Netflix, Prime Video, Disney+ and similar don't work**
These use DRM copy protection, which this extension does not bypass.

---

## Update

Download the ZIP again, replace the files in your folder, then click **Reload** on the extension in `edge://extensions` (or `chrome://extensions`). Run `companion\install.cmd` again if you use YouTube.

## Uninstall

- Click **Remove** on the extension in `edge://extensions` (or `chrome://extensions`)
- If you installed the YouTube add-on, double-click `companion\uninstall.cmd`

---

## Please download responsibly

Only download videos you have the right to save. Many sites, YouTube included, don't allow downloading in their terms of service. You're responsible for how you use this tool.

## For developers

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for how it works, the project layout and how to debug it. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE). The bundled ffmpeg.wasm core in `vendor/ffmpeg-core/` keeps its own GPL-2.0-or-later license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
