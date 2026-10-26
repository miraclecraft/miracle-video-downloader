# Changelog

## 1.0.0

- Download cards show speed, time left and "downloaded of total size"
- Pause and resume downloads; resuming continues from where it stopped
- Round icon buttons for pause, resume, cancel and "Show in folder"
- Direct file downloads now appear in the menu too
- YouTube: cancelling removes the partial files
- YouTube: fixed downloads failing with "Error when communicating with the native messaging host" after pausing or cancelling
- Companion installer can update the app while the browser is using it
- New Miracle logo and icons

## 0.3.0

- YouTube downloads through the companion app: quality picker, audio only (M4A), progress, cancel, "Show in folder"
- Companion installer and uninstaller for Edge, Chrome and Brave
- Fixed extension ID so the companion app can trust the extension

## 0.2.0

- Facebook and Instagram: full files instead of slices, video and audio paired and merged into one MP4
- Quality picker for social videos

## 0.1.0

- First version: detects video files, HLS and DASH streams on any page
- Downloads streams with parallel segments and merges audio and video with ffmpeg.wasm
