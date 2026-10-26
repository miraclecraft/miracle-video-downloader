<h1 align="center">
  <img src="docs/assets/logo.svg" alt="Miracle logo" width="56" height="56" align="center" />
  Miracle - Video Downloader
</h1>

<p align="center">
  <b>Save the video you're watching, in one click.</b><br />
  A free, open-source browser extension for Edge, Chrome and every Chromium browser.
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.1.0-7c3aed?style=flat-square" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-db2777?style=flat-square" alt="License: MIT" /></a>
  <a href="https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3"><img src="https://img.shields.io/badge/manifest-v3-f59e0b?style=flat-square" alt="Manifest V3" /></a>
</p>

<p align="center">
  <picture><img src="https://img.shields.io/badge/Edge-0078D7?style=flat-square" alt="Microsoft Edge" /></picture>
  <picture><img src="https://img.shields.io/badge/Chrome-4285F4?style=flat-square" alt="Google Chrome" /></picture>
  <picture><img src="https://img.shields.io/badge/Brave-FB542B?style=flat-square" alt="Brave" /></picture>
  <picture><img src="https://img.shields.io/badge/Opera-FF1B2D?style=flat-square" alt="Opera" /></picture>
  <picture><img src="https://img.shields.io/badge/Vivaldi-EF3939?style=flat-square" alt="Vivaldi" /></picture>
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> &nbsp;·&nbsp;
  <a href="#how-to-use"><b>How to use</b></a> &nbsp;·&nbsp;
  <a href="#troubleshooting"><b>Troubleshooting</b></a> &nbsp;·&nbsp;
  <a href="docs/DEVELOPMENT.md"><b>For developers</b></a>
</p>

---

## Features

| | |
| --- | --- |
| **Works almost everywhere** | Finds videos on most websites that play them, with no per-site setup |
| **YouTube, X, TikTok & more** | 1,800+ sites through the companion app. Pick the quality, up to 4K, or save just the audio as M4A |
| **Facebook & Instagram** | Saves the full video with sound, in the quality you choose |
| **Streaming video** | HLS and DASH streams are downloaded piece by piece and joined into one `.mp4` |
| **Private** | No account, no ads, no tracking. Nothing is sent anywhere |
| **Free & open source** | MIT licensed, and every line of code is right here |

### Supported sites

<p>
  <picture><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube" /></picture>
  <picture><img src="https://img.shields.io/badge/Facebook-0866FF?style=flat-square&logo=facebook&logoColor=white" alt="Facebook" /></picture>
  <picture><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram" /></picture>
  <picture><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X" /></picture>
  <picture><img src="https://img.shields.io/badge/TikTok-000000?style=flat-square&logo=tiktok&logoColor=white" alt="TikTok" /></picture>
  <picture><img src="https://img.shields.io/badge/Vimeo-1AB7EA?style=flat-square&logo=vimeo&logoColor=white" alt="Vimeo" /></picture>
  <picture><img src="https://img.shields.io/badge/Reddit-FF4500?style=flat-square&logo=reddit&logoColor=white" alt="Reddit" /></picture>
  <picture><img src="https://img.shields.io/badge/Dailymotion-0A0A0A?style=flat-square&logo=dailymotion&logoColor=white" alt="Dailymotion" /></picture>
  <picture><img src="https://img.shields.io/badge/Twitch-9146FF?style=flat-square&logo=twitch&logoColor=white" alt="Twitch" /></picture>
  <picture><img src="https://img.shields.io/badge/SoundCloud-FF5500?style=flat-square&logo=soundcloud&logoColor=white" alt="SoundCloud" /></picture>
  <picture><img src="https://img.shields.io/badge/1%2C800%2B%20more%20sites-555555?style=flat-square" alt="1,800+ more sites" /></picture>
</p>

> [!NOTE]
> Netflix, Prime Video, Disney+ and other services that use DRM copy protection are **not supported**, on purpose.

---

## Install

> [!TIP]
> You only do this once, and it takes about two minutes.

### 1. Download

Click the green **Code** button at the top of this page → **Download ZIP**, then extract it somewhere you'll keep it, for example `Documents\MiracleVideoDownloader`.

> [!IMPORTANT]
> Don't delete or move the folder afterwards. The browser loads the extension from it.

### 2. Add it to your browser

<table>
<tr>
<th><picture><img src="https://img.shields.io/badge/Microsoft%20Edge-0078D7?style=flat-square" alt="Microsoft Edge" /></picture></th>
<th><picture><img src="https://img.shields.io/badge/Google%20Chrome-4285F4?style=flat-square" alt="Google Chrome" /></picture></th>
</tr>
<tr>
<td>

1. Go to `edge://extensions`
2. Turn on **Developer mode** (bottom left)
3. Click **Load unpacked** and pick the folder

</td>
<td>

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the folder

</td>
</tr>
</table>

Brave, Opera and Vivaldi work the same way through their own extensions page.

Then click the puzzle-piece icon in the toolbar and **pin** Miracle so it's always one click away.

### 3. Companion app <sub>(optional, Windows)</sub>

YouTube, X, TikTok, Vimeo and many other sites can't be downloaded from inside the browser, so they use a small helper app.

1. Open the extracted folder → `companion`
2. Double-click **`install.cmd`**
3. When it says **Installed**, restart your browser

It downloads two well-known free tools, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) (about 210 MB), just for your Windows user. No admin rights needed.

---

## How to use

1. Open a page with a video and **start playing it**
2. Click the **Miracle** icon. The number on it shows how many videos were found
3. Pick a quality and click **Download**

Files are saved to your **Downloads** folder. While a download runs, the menu shows its speed, time left and how much is done. Use the pause, resume and cancel buttons next to it at any time.

On **YouTube, X, TikTok, Vimeo, Reddit, Dailymotion, Twitch, SoundCloud** and similar sites, the menu shows the video's thumbnail and title. Pick a quality or **Audio only**, click **Download**, then **Show in folder** when it's done.

Some videos are only visible when you're logged in, such as private or members-only posts. For those the menu offers **Use my browser login**. It hands that one site's login cookies to the companion app on your computer, just for that lookup and download. Nothing is sent anywhere else, and the copy is deleted straight after.

---

## Troubleshooting

<details>
<summary><b>"No videos detected on this page yet"</b></summary>
<br />
Start playing the video, then open the menu again. Some sites only load the video once it plays. Still nothing? Reload the page and play it again.
</details>

<details>
<summary><b>The menu says the companion app is missing</b></summary>
<br />
Run <code>companion\install.cmd</code> (step 3 above), then close and reopen your browser completely.
</details>

<details>
<summary><b>A YouTube (or other site) download fails</b></summary>
<br />
Sites change often. Click <b>Update yt-dlp and retry</b> in the menu. If it says the video needs an account, use <b>Use my browser login</b> while you're logged in to the site.
</details>

<details>
<summary><b>Windows shows a security warning for <code>install.cmd</code></b></summary>
<br />
That's normal for scripts downloaded from the internet. Choose <b>Run</b>, or <b>More info → Run anyway</b>.
</details>

<details>
<summary><b>The browser warns about developer mode extensions</b></summary>
<br />
Every extension installed with <b>Load unpacked</b> shows that notice. It's safe to dismiss.
</details>

---

## Update

Download the ZIP again, replace the files in your folder, then click **Reload** on the extension in `edge://extensions` or `chrome://extensions`. If you use the companion app, run `companion\install.cmd` again too.

## Uninstall

- Click **Remove** on the extension in `edge://extensions` or `chrome://extensions`
- If you installed the companion app, double-click `companion\uninstall.cmd`

---

> [!WARNING]
> **Please download responsibly.** Only save videos you have the right to keep. Many sites, YouTube included, don't allow downloading in their terms of service, and you're responsible for how you use this tool.

## For developers

How it works, the project layout and debugging tips are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Changes are listed in the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled ffmpeg.wasm core in `vendor/ffmpeg-core/` keeps its own GPL-2.0-or-later license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<br />

<p align="center">
  <img src="docs/assets/logo.svg" alt="" width="28" height="28" /><br />
  <sub>Made by <a href="https://github.com/miraclecraft">miraclecraft</a></sub>
</p>
