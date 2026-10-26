// Store Ops Scanner app. Always loads the live page; only shows a simple
// message when the phone is offline. Nothing is cached, so scans and order
// data never come from a stale copy.
const offlinePage = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store Ops Scanner</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#f4f5f7;font-family:system-ui,sans-serif;text-align:center;padding:24px}
button{margin-top:16px;border:0;border-radius:999px;padding:12px 20px;font-weight:700;font-size:15px}</style></head>
<body><div><strong style="font-size:18px">No internet connection</strong>
<p style="color:#9aa0ab">Connect the phone to Wi-Fi or mobile data, then try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(offlinePage, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })));
});
