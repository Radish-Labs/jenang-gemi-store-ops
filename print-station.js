// Print station: a computer in phone mode prints the labels for orders that
// the phone (same profile) scanned. Runs in one Store Ops tab at a time.
document.addEventListener('DOMContentLoaded', () => {
  const settings = document.querySelector('[data-mobile-scanner-settings]');
  if (!settings || window.top !== window) return;
  // The scan and label pages have their own work; the panel runs elsewhere.
  if (document.querySelector('[data-store-scan], [data-print-label-page]')) return;
  if (window.JGStoreDevice?.isPhone()) return;

  const root = settings.dataset.storeRoot || '../';
  const endpoint = settings.dataset.mobileScannerEndpoint || `${root}api/mobile-scanner/`;
  const modeKey = 'jg-store-scanner-mode';
  const leaderKey = 'jg-print-station-leader';
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let running = false;
  let busy = false;
  let controller = null;
  let leaderTimer = 0;

  const phoneMode = () => {
    try { return window.localStorage.getItem(modeKey) === 'phone'; } catch (_error) { return false; }
  };

  // Only one tab per computer listens, so a job never opens twice.
  const isLeader = () => {
    try {
      const now = Date.now();
      const current = JSON.parse(window.localStorage.getItem(leaderKey) || 'null');
      if (!current || current.id === tabId || now - Number(current.at || 0) > 6000) {
        window.localStorage.setItem(leaderKey, JSON.stringify({ id: tabId, at: now }));
        return true;
      }
      return false;
    } catch (_error) {
      return true;
    }
  };

  const post = async (body, signal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Store Ops is unavailable.');
    return payload;
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const panel = document.createElement('div');
  panel.className = 'admin-print-station';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="admin-print-station-card" role="dialog" aria-modal="true" aria-labelledby="print-station-title">
      <header>
        <div>
          <span class="admin-panel-kicker">Printing for the phone</span>
          <h3 id="print-station-title" data-print-station-order>Order</h3>
        </div>
        <button type="button" class="admin-ghost-btn" data-print-station-close>Close</button>
      </header>
    </div>`;
  document.body.appendChild(panel);
  const card = panel.querySelector('.admin-print-station-card');
  // A fresh frame per job; it is removed (not hidden) when the job ends,
  // because hiding a frame that holds a printed PDF can crash Chrome.
  let frame = null;
  const orderTitle = panel.querySelector('[data-print-station-order]');
  let activeJob = 0;
  let lastReported = '';
  let finishJob = () => {};

  const report = (status, detail = '') => {
    const signature = `${status}|${detail}`;
    if (!activeJob || signature === lastReported) return;
    lastReported = signature;
    post({ action: 'station_status', job: activeJob, status, detail }).catch(() => { lastReported = ''; });
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !frame || event.source !== frame.contentWindow) return;
    const message = event.data || {};
    if (message.source !== 'jg-print-station' || !activeJob) return;
    if (message.type === 'done') {
      report('printed');
      window.setTimeout(() => finishJob(), 1200);
      return;
    }
    const status = String(message.status || '');
    const error = String(message.error || '');
    if (message.confirm) report('confirm', error);
    else if (/attention/i.test(status)) report('attention', error || status);
    else if (/not printed|unavailable|failed|not sent|missing/i.test(status)) report('failed', error || status);
    else report('printing', status);
  });

  const printJob = (taken) => new Promise((resolve) => {
    activeJob = taken.job;
    lastReported = '';
    orderTitle.textContent = taken.order_id;
    const query = new URLSearchParams({
      order: taken.order_id,
      account: taken.source_account || '',
      platform: taken.source_platform || '',
      handoff: taken.handoff,
      station: '1'
    });
    frame = document.createElement('iframe');
    frame.title = 'Shipping label for the phone order';
    frame.dataset.printStationFrame = '';
    frame.src = `${root}dashboard/print-label/?${query}`;
    card.appendChild(frame);
    panel.hidden = false;
    finishJob = () => {
      frame.remove();
      frame = null;
      panel.hidden = true;
      activeJob = 0;
      finishJob = () => {};
      resolve();
    };
  });

  panel.querySelector('[data-print-station-close]').addEventListener('click', () => {
    if (lastReported.startsWith('printed')) {
      finishJob();
      return;
    }
    report('failed', 'Closed on the computer before printing finished.');
    finishJob();
  });

  const loop = async () => {
    if (running) return;
    running = true;
    while (phoneMode()) {
      if (!isLeader()) {
        await sleep(3000);
        continue;
      }
      try {
        controller = new AbortController();
        const waited = await post({ action: 'station_wait', wait: 10 }, controller.signal);
        if (!waited.job) continue;
        const taken = await post({ action: 'station_take', job: waited.job.job });
        if (!taken.taken) continue;
        busy = true;
        await printJob(taken);
        busy = false;
      } catch (_error) {
        busy = false;
        await sleep(3000);
      }
    }
    running = false;
  };

  leaderTimer = window.setInterval(() => {
    if (phoneMode()) {
      if (busy || running) isLeader();
      if (!running) loop();
    }
  }, 2000);
  window.addEventListener('storage', (event) => {
    if (event.key === modeKey && phoneMode()) loop();
  });
  window.addEventListener('pagehide', () => {
    window.clearInterval(leaderTimer);
    controller?.abort();
    try {
      const current = JSON.parse(window.localStorage.getItem(leaderKey) || 'null');
      if (current?.id === tabId) window.localStorage.removeItem(leaderKey);
    } catch (_error) {
      // Another tab takes over after 6 seconds.
    }
  });
  if (phoneMode()) loop();
});
