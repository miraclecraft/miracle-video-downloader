// Reports <video> elements with real (non-blob) sources to the service worker.
// Streams played through MediaSource use blob: URLs and are caught by network
// detection instead.
(() => {
  let lastReport = '';
  let timer = null;

  function collect() {
    const found = new Map();
    for (const video of document.querySelectorAll('video')) {
      const sources = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), (s) => s.src)];
      for (const url of sources) {
        if (!url || !/^https?:/i.test(url) || found.has(url)) continue;
        found.set(url, {
          url,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          duration: isFinite(video.duration) ? video.duration : 0,
        });
      }
    }
    return [...found.values()];
  }

  function scan() {
    const videos = collect();
    const report = JSON.stringify(videos);
    if (!videos.length || report === lastReport) return;
    lastReport = report;
    chrome.runtime.sendMessage({ type: 'dom-videos', videos }).catch(() => {});
  }

  function scheduleScan() {
    clearTimeout(timer);
    timer = setTimeout(scan, 800);
  }

  scan();
  document.addEventListener('loadedmetadata', scan, true);
  document.addEventListener('play', scan, true);
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
})();
