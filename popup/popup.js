import { buildEntries, formatBytes, formatDuration } from '../lib/common.js';
import { youtubeVideoUrl, COMPANION_MISSING } from '../lib/youtube.js';

const $items = document.getElementById('items');
const $empty = document.getElementById('empty');
const $pageTitle = document.getElementById('page-title');
const $jobs = document.getElementById('jobs');
const $jobsSection = document.getElementById('jobs-section');
const $youtube = document.getElementById('youtube');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const tabKey = `tab:${tab?.id}`;
const ACTIVE = new Set(['starting', 'downloading', 'merging', 'saving']);
const STATUS_TEXT = {
  starting: 'Starting…',
  downloading: 'Downloading',
  merging: 'Merging video and audio…',
  saving: 'Saving file…',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
};
const UNSUPPORTED_SITES = [
  [/(^|\.)netflix\.com$|(^|\.)primevideo\.com$|(^|\.)disneyplus\.com$|(^|\.)max\.com$/i, 'This site uses DRM protection, so its videos cannot be downloaded.'],
];

function el(tag, { dataset, ...props } = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  Object.assign(node.dataset, dataset);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function displayName(item) {
  try {
    const last = new URL(item.url).pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(last || item.url);
  } catch {
    return item.url;
  }
}

function kbps(bandwidth) {
  return bandwidth ? `${Math.round(bandwidth / 1000)} kbps` : '';
}

function qualityLabel({ height, resolution, bandwidth, size }) {
  const h = height || resolution?.split('x')[1];
  return [h ? `${h}p` : resolution, kbps(bandwidth), formatBytes(size)].filter(Boolean).join(' · ') || 'Unknown quality';
}

function tagFor(item) {
  if (item.kind === 'hls') return 'HLS';
  if (item.kind === 'dash') return 'DASH';
  if (item.track === 'audio') return 'AUDIO';
  if (item.social) return 'MP4';
  const ext = displayName(item).match(/\.(\w{2,4})$/)?.[1];
  return (ext || item.mime?.split('/')[1] || 'VIDEO').toUpperCase().slice(0, 5);
}

function selectBox(title, options) {
  if (options.length < 2) return null;
  return el('select', { title }, ...options.map(([value, label]) => el('option', { value, textContent: label })));
}

// Builds the quality pickers, notes and download choice for one entry.
function entryControls(entry) {
  const item = entry.videos[0];
  const hls = item.hls;
  const dash = item.dash;
  const selects = [];
  let note = null;
  let blocked = false;
  let choice;

  if (item.kind === 'file') {
    const select = selectBox('Quality', entry.videos.map((v) => [v.id, qualityLabel(v)]));
    if (select) selects.push(select);
    const selected = () => entry.videos.find((v) => v.id === select?.value) || item;
    choice = () => {
      const v = selected();
      return { itemId: v.id, choice: { audioId: v.track === 'video' ? entry.audio?.id : undefined, height: v.height } };
    };
    if (item.track === 'video') {
      note = entry.audio
        ? ['ok', 'Video and audio are separate files — they will be merged into one MP4.']
        : ['warn', 'This file has no audio track. Play the video with sound on to detect its audio.'];
    }
  } else if (item.kind === 'hls') {
    const variants = hls?.type === 'master' ? hls.variants : [];
    const select = selectBox('Quality', variants.map((v) => [v.url, qualityLabel(v)]));
    if (select) selects.push(select);
    choice = () => {
      const v = variants.find((x) => x.url === select?.value) || variants[0];
      return { itemId: item.id, choice: { variantUrl: v?.url, height: Number(v?.resolution?.split('x')[1]) || undefined } };
    };
    if (hls?.drm) {
      note = ['warn', 'DRM protected — cannot be downloaded.'];
      blocked = true;
    } else if (hls?.live) {
      note = ['warn', 'Live stream — only the segments currently listed will be saved.'];
    }
  } else if (item.kind === 'dash') {
    const videoSel = selectBox('Video quality', (dash?.video || []).map((r) => [r.id, qualityLabel(r)]));
    const audioSel = selectBox(
      'Audio track',
      (dash?.audio || []).map((r) => [r.id, [r.lang, kbps(r.bandwidth)].filter(Boolean).join(' · ') || 'Audio'])
    );
    selects.push(...[videoSel, audioSel].filter(Boolean));
    choice = () => {
      const rep = dash?.video.find((r) => r.id === videoSel?.value) || dash?.video[0];
      return {
        itemId: item.id,
        choice: { videoRep: rep?.id, audioRep: audioSel?.value || dash?.audio[0]?.id, height: rep?.height },
      };
    };
    if (dash?.drm) {
      note = ['warn', 'DRM protected — cannot be downloaded.'];
      blocked = true;
    } else if (dash?.live) {
      note = ['warn', 'Live DASH streams are not supported.'];
      blocked = true;
    }
  }
  return { selects, note, blocked, choice };
}

function entryCard(entry) {
  const item = entry.videos[0];
  const { selects, note, blocked, choice } = entryControls(entry);
  const meta = [
    item.width && item.height ? `${item.width}×${item.height}` : '',
    formatBytes(item.size + (item.track === 'video' ? entry.audio?.size || 0 : 0)),
    formatDuration(item.duration || item.hls?.duration || item.dash?.duration),
    item.hls?.type === 'master' ? `${item.hls.variants.length} qualities` : '',
    item.hls?.type === 'media' && item.hls.segments ? `${item.hls.segments} segments` : '',
    entry.videos.length > 1 ? `${entry.videos.length} qualities` : '',
  ].filter(Boolean);

  const status = el('div', { className: 'note ok', hidden: true });
  const download = el('button', { className: 'primary', textContent: 'Download', disabled: blocked });
  download.addEventListener('click', async () => {
    download.disabled = true;
    const res = await chrome.runtime.sendMessage({ type: 'download', tabId: tab.id, ...choice() });
    status.hidden = false;
    status.className = res?.ok ? 'note ok' : 'note';
    status.textContent = res?.ok
      ? res.direct
        ? 'Download started.'
        : 'Download started — progress is shown below.'
      : res?.error || 'Download failed.';
    download.disabled = false;
  });

  const copy = el('button', { textContent: 'Copy link' });
  copy.addEventListener('click', async () => {
    const id = choice().itemId;
    await navigator.clipboard.writeText(entry.videos.find((v) => v.id === id)?.url || item.url);
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = 'Copy link'), 1200);
  });

  return el(
    'li',
    { className: 'card', dataset: { key: entry.key } },
    el(
      'div',
      { className: 'card-top' },
      el('span', { className: `tag${blocked ? ' warn' : ''}`, textContent: tagFor(item) }),
      el('span', { className: 'name', textContent: displayName(item), title: item.url })
    ),
    meta.length ? el('div', { className: 'meta', textContent: meta.join(' · ') }) : null,
    note ? el('div', { className: note[0] === 'ok' ? 'note ok' : 'note', textContent: note[1] }) : null,
    el('div', { className: 'actions' }, ...selects, download, copy),
    status
  );
}

function jobCard(job) {
  const active = ACTIVE.has(job.status);
  const pct = Math.round((job.progress || 0) * 100);
  const detail = [
    STATUS_TEXT[job.status] || job.status,
    job.status === 'downloading' ? `${pct}%` : '',
    job.status === 'done' && job.source === 'youtube' ? 'Saved to Downloads' : '',
    formatBytes(job.bytes),
  ].filter(Boolean);

  if (active && job.speed) detail.push(job.speed);
  if (active && job.eta) detail.push(`${job.eta} left`);

  let action = null;
  if (active) {
    action = el('button', { textContent: 'Cancel' });
    action.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel-job', jobId: job.id }));
  } else if (job.status === 'done' && job.file) {
    action = el('button', { textContent: 'Show in folder' });
    action.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reveal', path: job.file }));
  }

  return el(
    'li',
    { className: 'card' },
    el('div', { className: 'card-top' }, el('span', { className: 'name', textContent: job.title, title: job.title }), action),
    el('div', { className: 'meta', textContent: detail.join(' · ') }),
    job.error ? el('div', { className: 'note', textContent: job.error }) : null,
    active ? el('div', { className: 'progress' }, el('div', { style: `width:${pct}%` })) : null
  );
}

function emptyMessage() {
  let host = '';
  try {
    host = new URL(tab?.url || '').hostname;
  } catch {}
  const unsupported = UNSUPPORTED_SITES.find(([re]) => re.test(host));
  if (unsupported) return [unsupported[1]];
  return ['No videos detected on this page yet.', 'Start playing the video, then open this menu again.'];
}

const youtubeUrl = youtubeVideoUrl(tab?.url || '');

function companionHelp() {
  return el(
    'div',
    { className: 'note' },
    'YouTube downloads need the companion app. Run ',
    el('code', { textContent: 'companion\\install.cmd' }),
    ' from the extension folder, then restart your browser.'
  );
}

// YouTube is handled by the companion app (yt-dlp) instead of network detection.
async function renderYoutube() {
  if (!youtubeUrl) return;
  $youtube.hidden = false;
  const meta = el('div', { className: 'meta', textContent: 'Loading available qualities…' });
  const card = el(
    'li',
    { className: 'card' },
    el(
      'div',
      { className: 'card-top' },
      el('span', { className: 'tag', textContent: 'YOUTUBE' }),
      el('span', { className: 'name', textContent: tab.title.replace(/ - YouTube$/, ''), title: youtubeUrl })
    ),
    meta
  );
  $youtube.replaceChildren(card);

  const res = await chrome.runtime.sendMessage({ type: 'yt-info', pageUrl: youtubeUrl });
  if (!res?.ok) {
    meta.remove();
    if (res?.error === COMPANION_MISSING) {
      card.append(companionHelp());
      return;
    }
    const update = el('button', { className: 'link', textContent: 'Update yt-dlp and retry' });
    update.addEventListener('click', async () => {
      update.textContent = 'Updating…';
      update.disabled = true;
      await chrome.runtime.sendMessage({ type: 'yt-update' });
      renderYoutube();
    });
    card.append(el('div', { className: 'note', textContent: res?.error || 'Could not read this video.' }), el('div', { className: 'actions' }, update));
    return;
  }

  meta.textContent = [formatDuration(res.duration), res.uploader].filter(Boolean).join(' · ');
  if (res.thumbnail) card.insertBefore(el('img', { className: 'thumb', src: res.thumbnail, alt: '' }), meta);
  if (res.isLive) {
    card.append(el('div', { className: 'note', textContent: 'Live streams cannot be downloaded.' }));
    return;
  }

  const select = el(
    'select',
    { title: 'Quality' },
    ...res.heights.map((h) => el('option', { value: String(h), textContent: `${h}p` })),
    el('option', { value: 'audio', textContent: 'Audio only (M4A)' })
  );
  // Default to 1080p or the best below it; higher qualities are much larger.
  select.value = String(res.heights.find((h) => h <= 1080) ?? res.heights[0] ?? 'audio');
  const status = el('div', { className: 'note ok', hidden: true });
  const download = el('button', { className: 'primary', textContent: 'Download' });
  download.addEventListener('click', async () => {
    download.disabled = true;
    const audioOnly = select.value === 'audio';
    const r = await chrome.runtime.sendMessage({
      type: 'yt-download',
      pageUrl: youtubeUrl,
      audioOnly,
      height: audioOnly ? 0 : Number(select.value),
    });
    status.hidden = false;
    status.className = r?.ok ? 'note ok' : 'note';
    status.textContent = r?.ok ? 'Download started — progress is shown below.' : r?.error || 'Download failed.';
    download.disabled = false;
  });
  card.append(el('div', { className: 'actions' }, select, download), status);
}

function renderItems(entry) {
  $pageTitle.textContent = youtubeUrl ? '' : tab?.title || '';
  const entries = buildEntries(entry?.items || []);
  // Detection keeps updating the list; keep the qualities the user already picked.
  const picked = new Map();
  for (const card of $items.children) picked.set(card.dataset.key, [...card.querySelectorAll('select')].map((s) => s.value));
  $items.replaceChildren(...entries.map(entryCard));
  for (const card of $items.children) {
    const values = picked.get(card.dataset.key) || [];
    card.querySelectorAll('select').forEach((select, i) => {
      if ([...select.options].some((o) => o.value === values[i])) select.value = values[i];
    });
  }
  $empty.hidden = entries.length > 0 || !!youtubeUrl;
  if (!entries.length) {
    const lines = emptyMessage();
    $empty.replaceChildren(...lines.flatMap((line, i) => (i ? [el('br'), line] : [line])));
  }
}

function renderJobs(jobs) {
  const list = Object.values(jobs || {}).sort((a, b) => b.createdAt - a.createdAt);
  $jobsSection.hidden = list.length === 0;
  $jobs.replaceChildren(...list.map(jobCard));
}

document.getElementById('clear-jobs').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear-jobs' });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes[tabKey]) renderItems(changes[tabKey].newValue);
  if (changes.jobs) renderJobs(changes.jobs.newValue);
});

const initial = await chrome.storage.session.get([tabKey, 'jobs']);
renderItems(initial[tabKey]);
renderJobs(initial.jobs);
renderYoutube();
