<div align="center">

<img src="docs/assets/logo.svg" alt="Miracle - Video Downloader logo" width="120" height="120" />

# Miracle - Video Downloader

**Save the video you're watching, in one click.**<br />
A free browser extension for Edge, Chrome and every Chromium browser.

[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmiraclecraft%2Fmiracle-video-downloader%2Fmain%2Fmanifest.json&query=%24.version&label=version&color=7c3aed)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-db2777)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-f59e0b)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![GitHub stars](https://img.shields.io/github/stars/miraclecraft/miracle-video-downloader?style=flat&color=7c3aed&logo=github)](https://github.com/miraclecraft/miracle-video-downloader/stargazers)

![Microsoft Edge](https://img.shields.io/badge/Microsoft%20Edge-0078D7?logo=microsoftedge&logoColor=white)
![Google Chrome](https://img.shields.io/badge/Google%20Chrome-4285F4?logo=googlechrome&logoColor=white)
![Brave](https://img.shields.io/badge/Brave-FB542B?logo=brave&logoColor=white)
![Opera](https://img.shields.io/badge/Opera-FF1B2D?logo=opera&logoColor=white)
![Vivaldi](https://img.shields.io/badge/Vivaldi-EF3939?logo=vivaldi&logoColor=white)

[**Install**](#-install) · [**How to use**](#-how-to-use) · [**Troubleshooting**](#-troubleshooting) · [**For developers**](docs/DEVELOPMENT.md)

</div>

---

## ✨ Features

| | |
| --- | --- |
| 🎬 **Works almost everywhere** | Finds videos on most websites that play them — no setup per site |
| ▶️ **YouTube** | Pick the quality (up to 4K) or save just the audio as M4A |
| 📘 **Facebook & Instagram** | Saves the full video **with sound**, in the quality you choose |
| 📡 **Streaming video** | HLS and DASH streams are downloaded piece by piece and joined into one `.mp4` |
| 🔒 **Private** | No account, no ads, no tracking — nothing is sent anywhere |
| 🆓 **Free & open source** | MIT licensed, every line of code is right here |

### Supported sites

![YouTube](https://img.shields.io/badge/YouTube-FF0000?logo=youtube&logoColor=white)
![Facebook](https://img.shields.io/badge/Facebook-0866FF?logo=facebook&logoColor=white)
![Instagram](https://img.shields.io/badge/Instagram-E4405F?logo=instagram&logoColor=white)
![Any site](https://img.shields.io/badge/+%20most%20other%20video%20sites-555555)

> [!NOTE]
> Netflix, Prime Video, Disney+ and other services that use DRM copy protection are **not supported**, on purpose.

---

## 🚀 Install

> [!TIP]
> You only do this once, and it takes about two minutes.

### 1️⃣ Download

Click the green **Code** button at the top of this page → **Download ZIP**, then extract it somewhere you'll keep it, for example `Documents\MiracleVideoDownloader`.

> [!IMPORTANT]
> Don't delete or move the folder afterwards. The browser loads the extension from it.

### 2️⃣ Add it to your browser

<table>
<tr>
<th><img src="https://img.shields.io/badge/Microsoft%20Edge-0078D7?logo=microsoftedge&logoColor=white" alt="Microsoft Edge" /></th>
<th><img src="https://img.shields.io/badge/Google%20Chrome-4285F4?logo=googlechrome&logoColor=white" alt="Google Chrome" /></th>
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

📌 Click the puzzle-piece icon in the toolbar and **pin** Miracle so it's always one click away.

### 3️⃣ YouTube add-on <sub>(optional, Windows)</sub>

YouTube can't be downloaded from inside the browser, so it uses a small helper app.

1. Open the extracted folder → `companion`
2. Double-click **`install.cmd`**
3. When it says **Installed**, restart your browser

It downloads two well-known free tools, [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/) (about 210 MB), just for your Windows user. No admin rights needed.

---

## 🎯 How to use

```
  ▶  Play the video   →   🖱  Click the Miracle icon   →   ⬇  Pick a quality & Download
```

1. Open a page with a video and **start playing it**
2. Click the **Miracle** icon. The number on it shows how many videos were found
3. Pick a quality and click **Download**

Files are saved to your **Downloads** folder. Streams and videos whose audio and video need joining show a progress bar while they're prepared.

On **YouTube** the menu shows the video's thumbnail and title. Pick a quality or **Audio only**, click **Download**, then **Show in folder** when it's done.

---

## 🛠 Troubleshooting

<details>
<summary><b>"No videos detected on this page yet"</b></summary>
<br />
Start playing the video, then open the menu again. Some sites only load the video once it plays. Still nothing? Reload the page and play it again.
</details>

<details>
<summary><b>YouTube says the companion app is missing</b></summary>
<br />
Run <code>companion\install.cmd</code> (step 3 above), then close and reopen your browser completely.
</details>

<details>
<summary><b>A YouTube download fails</b></summary>
<br />
YouTube changes often. Click <b>Update yt-dlp and retry</b> in the menu.
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

## 🔄 Update

Download the ZIP again, replace the files in your folder, then click **Reload** on the extension in `edge://extensions` or `chrome://extensions`. If you use YouTube, run `companion\install.cmd` again too.

## 🗑 Uninstall

- Click **Remove** on the extension in `edge://extensions` or `chrome://extensions`
- If you installed the YouTube add-on, double-click `companion\uninstall.cmd`

---

> [!WARNING]
> **Please download responsibly.** Only save videos you have the right to keep. Many sites, YouTube included, don't allow downloading in their terms of service, and you're responsible for how you use this tool.

## 👩‍💻 For developers

How it works, the project layout and debugging tips are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Changes are listed in the [changelog](CHANGELOG.md).

## 📄 License

[MIT](LICENSE). The bundled ffmpeg.wasm core in `vendor/ffmpeg-core/` keeps its own GPL-2.0-or-later license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<div align="center">
<br />
<img src="docs/assets/logo.svg" alt="" width="32" height="32" /><br />
<sub>Made with ✨ by <a href="https://github.com/miraclecraft">miraclecraft</a></sub>
</div>
