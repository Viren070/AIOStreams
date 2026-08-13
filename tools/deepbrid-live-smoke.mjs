const apiKey = process.env.DEEPBRID_API_KEY;
if (!apiKey) throw new Error('DEEPBRID_API_KEY is required');

const base = 'https://www.deepbrid.com/api/v1';
const headers = {
  Accept: 'application/json',
  Authorization: `Bearer ${apiKey}`,
  'User-Agent': 'Deepbrid/1.0 (ios) DBX/k9Q4mZ2xV7bN1pR8sT3wY6cH0jL5dF',
};

async function json(path) {
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(45_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = JSON.parse(text);
  if (Number(parsed.error || 0) !== 0) throw new Error(`API ${parsed.error}`);
  return parsed;
}

const categories = await json('/usenet/finder/categories');
const search = await json('/usenet/finder/search?q=Supernatural%20S01E01&offset=0&limit=20&category=c30');
let selected;
let content;
for (const item of search.items || []) {
  try {
    let current = await json(`/usenet/finder/content?token=${encodeURIComponent(item.token)}&archives=0`);
    if ((current.files || []).some((file) => /\.(?:rar|r\d{2}|7z|zip)$/i.test(file.name || file.filename || ''))) {
      current = await json(`/usenet/finder/content?token=${encodeURIComponent(item.token)}&archives=1`);
    }
    const video = (current.files || []).find((file) => /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts)$/i.test(file.name || file.filename || ''));
    if (video) { selected = video; content = current; break; }
  } catch {}
}
if (!selected) throw new Error('No resolvable video found');
const link = new URL(selected.link || selected.url);
if (link.protocol !== 'https:' || link.username || link.password) throw new Error('Unsafe video URL');
const downloadHeaders = { Accept: '*/*', Range: 'bytes=0-1023' };
if (link.hostname === 'deepbrid.com' || link.hostname.endsWith('.deepbrid.com')) {
  downloadHeaders.Authorization = `Bearer ${apiKey}`;
  downloadHeaders['User-Agent'] = headers['User-Agent'];
}
const range = await fetch(link, {
  headers: downloadHeaders,
  signal: AbortSignal.timeout(45_000),
});
const bytes = await range.arrayBuffer();
if (![200, 206].includes(range.status) || bytes.byteLength === 0) throw new Error(`Range failed: ${range.status}`);
process.stdout.write(JSON.stringify({
  categories: Array.isArray(categories.categories) ? categories.categories.length : 0,
  searchResults: Array.isArray(search.items) ? search.items.length : 0,
  resolvedFiles: Array.isArray(content.files) ? content.files.length : 0,
  selectedVideo: selected.name || selected.filename,
  selectedHost: link.hostname,
  rangeStatus: range.status,
  rangeBytes: bytes.byteLength,
  contentRangePresent: Boolean(range.headers.get('content-range')),
}, null, 2));
