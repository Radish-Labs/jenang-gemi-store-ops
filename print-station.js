// Print station: a packing computer prints the labels for orders that phones
// scanned, from any profile, whatever profile the computer is signed in to.
// A computer counts as a packing computer when it has the print helper on,
// printed a label in the last 14 days, or has the mobile scanner switched on;
// other computers (an office laptop) never take phone labels. Runs in one
// Store Ops tab per computer.
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

  const helperKey = 'jg-store-print-helper-v1';
  const printedKey = 'jg-store-printed-order-event';
  const recentPrintMs = 14 * 24 * 60 * 60 * 1000;
  const isPackingComputer = () => {
    try {
      const storage = window.localStorage;
      if (storage.getItem(modeKey) === 'phone') return true;
      if (JSON.parse(storage.getItem(helperKey) || 'null')?.enabled) return true;
      const printedAt = Date.parse(JSON.parse(storage.getItem(printedKey) || 'null')?.printedAt || '');
      return Number.isFinite(printedAt) && Date.now() - printedAt < recentPrintMs;
    } catch (_error) {
      return false;
    }
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

  // Send progress one update at a time and always end on the newest, so
  // two quick updates can never arrive at the server in the wrong order.
  let sending = false;
  let pending = null;
  const flushReports = async () => {
    if (sending) return;
    sending = true;
    while (pending) {
      const next = pending;
      pending = null;
      try {
        await post({ action: 'station_status', job: next.job, status: next.status, detail: next.detail });
      } catch (_error) {
        if (!pending) pending = next;
        await sleep(1500);
      }
    }
    sending = false;
  };
  let jobDone = false;
  const report = (status, detail = '') => {
    const signature = `${status}|${detail}`;
    // After "printed", late status messages from the label page are ignored.
    if (!activeJob || signature === lastReported || (jobDone && status !== 'printed')) return;
    lastReported = signature;
    pending = { job: activeJob, status, detail };
    flushReports();
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !frame || event.source !== frame.contentWindow) return;
    const message = event.data || {};
    if (message.source !== 'jg-print-station' || !activeJob) return;
    if (message.type === 'done') {
      report('printed');
      jobDone = true;
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
    jobDone = false;
    orderTitle.textContent = taken.for_name ? `${taken.order_id} · for ${taken.for_name}` : taken.order_id;
    const query = new URLSearchParams({
      order: taken.order_id,
      account: taken.source_account || '',
      platform: taken.source_platform || '',
      handoff: taken.handoff,
      station: '1'
    });
    // Taps on the phone (Printed successfully / Print again) for this job.
    const thisJob = taken.job;
    (async () => {
      while (activeJob === thisJob) {
        try {
          const waited = await post({ action: 'station_command', job: thisJob, wait: 10 });
          if (waited.command && activeJob === thisJob && frame) {
            frame.contentWindow?.postMessage({ source: 'jg-print-station-command', command: waited.command }, window.location.origin);
          }
        } catch (_error) {
          await sleep(1500);
        }
      }
    })();
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
    while (isPackingComputer()) {
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
    if (isPackingComputer()) {
      if (busy || running) isLeader();
      if (!running) loop();
    }
  }, 2000);
  window.addEventListener('storage', (event) => {
    if ([modeKey, helperKey, printedKey].includes(event.key) && isPackingComputer()) loop();
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
  if (isPackingComputer()) loop();
});
