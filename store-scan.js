document.addEventListener('DOMContentLoaded', async () => {
  const root = document.querySelector('[data-store-scan]');
  if (!root) return;

  const ordersStorageKey = 'jg-store-live-orders';
  const activeOrderStorageKey = 'jg-store-active-order-id';
  const pendingScanQueueStorageKey = 'jg-store-pending-scan-queues-v1';
  const skuCatalogStorageKey = 'jg-store-sku-catalog';
  const scanBridgeEndpoint = '../../api/scan-bridge/';
  const scanSerialEndpoint = '../../api/scan-serial/';
  const skuDbEndpoint = '../../api/sku-db/';
  const ordersEndpoint = '../../api/orders-v2/';
  const scanFlushDelayMs = 30000;
  const orderIdNode = document.querySelector('[data-scan-order-id]');
  const scanError = document.querySelector('[data-scan-error]');
  const scanList = document.querySelector('[data-scan-list]');
  const scanProgress = document.querySelector('[data-scan-progress]');
  const scanStatus = document.querySelector('[data-scan-status]');
  const syncStatus = document.querySelector('[data-sync-status]');
  const stockWarning = document.querySelector('[data-stock-warning]');
  const stockWarningProducts = document.querySelector('[data-stock-warning-products]');
  const stockWarningDismiss = document.querySelector('[data-stock-warning-dismiss]');

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const readOrders = () => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ordersStorageKey) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (_error) {
      return [];
    }
  };

  const writeOrders = (orders) => {
    try {
      window.localStorage.setItem(ordersStorageKey, JSON.stringify(orders));
    } catch (_error) {
      // Scanning can continue for this page load without persistence.
    }
  };

  const params = new URLSearchParams(window.location.search);
  let orderId = params.get('order') || '';
  if (!orderId) {
    try { orderId = window.sessionStorage.getItem(activeOrderStorageKey) || ''; } catch (_error) { /* Storage is optional. */ }
  }
  let handoffOrder = null;
  if (params.get('handoff')) {
    if (orderIdNode) orderIdNode.textContent = 'Loading order…';
    try {
      handoffOrder = await window.JGStoreScanHandoff.load(params, ordersEndpoint);
    } catch (error) {
      if (orderIdNode) orderIdNode.textContent = 'Unable to load order';
      const errorNode = document.querySelector('[data-scan-error]');
      if (errorNode) {
        errorNode.textContent = error instanceof Error ? error.message : 'Reload this page to retry.';
        errorNode.hidden = false;
      }
      return;
    }
  }
  const orders = readOrders();
  const order = handoffOrder || orders.find((item) => item && String(item.id || '') === orderId) || null;
  const scans = new Map();
  let scanBuffer = '';
  let scanBufferTimer = 0;
  let printRedirecting = false;
  let scannerSettings = { baud_rate: 9600 };
  let serialPort = null;
  let serialReader = null;
  let serialReadBuffer = '';
  let serverSerialTimer = 0;
  let serverSerialErrorShown = false;
  let lastScanKey = '';
  let lastScanAt = 0;
  let pendingScanEvents = [];
  let activeFlushBatch = [];
  let flushTimer = 0;
  let flushingScans = false;
  let scanCompletedOnServer = false;
  let scanCompletionQueued = false;
  let claimSynced = false;
  let claimSyncPromise = null;
  let stockRowsByCode = new Map();
  let soldOutByScanSku = new Map();
  let soldOutSignature = '';
  let dismissedSoldOutSignature = '';
  let stockRefreshPromise = null;

  if (orderIdNode) orderIdNode.textContent = order?.id || 'Order missing';

  const scanCountFor = (sku) => Number(scans.get(sku) || 0);
  const scanSkuFor = (item) => String(item.scanSku || item.sku || '');
  const scanQuantityFor = (item) => Number(item.scanQuantity || item.quantity || 0);
  const skipScanFor = (item) => Boolean(item.skipScan || item.skip_scan);
  const skipQuantityFor = (item) => Number(item.skipQuantity || (skipScanFor(item) ? scanQuantityFor(item) : 0));
  const manualQuantityFor = (item) => Math.max(0, scanQuantityFor(item) - skipQuantityFor(item));
  const readJsonResponse = async (response, fallbackMessage) => {
    const text = await response.text();
    if (text.trim() === '') {
      throw new Error(`${fallbackMessage} Empty response from ${response.url || 'server'}. HTTP ${response.status}.`);
    }
    try {
      return JSON.parse(text);
    } catch (_error) {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 220);
      throw new Error(`${fallbackMessage} Expected JSON but got HTTP ${response.status}: ${preview || 'no response body'}`);
    }
  };
  const serverCanSeeLocalUsb = () => {
    const host = window.location.hostname;
    return host === ''
      || host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  };
  const sourceSkusFor = (item) => {
    if (Array.isArray(item.sourceSkus)) return item.sourceSkus;
    const sku = String(item.sku || '').trim();
    return sku ? [sku] : [];
  };
  const sourceBarcodesFor = (item) => {
    if (Array.isArray(item.sourceBarcodes)) return item.sourceBarcodes;
    const barcode = String(item.barcode || '').trim();
    return barcode ? [barcode] : [];
  };

  const stockCode = (value) => String(value || '').trim().toUpperCase();

  const stockCandidatesFor = (item) => Array.from(new Set([
    ...sourceSkusFor(item),
    item.sku,
    item.tag
  ].map(stockCode).filter(Boolean)));

  const readCachedStockRows = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(skuCatalogStorageKey) || 'null');
      const rows = Array.isArray(cached) ? cached : (Array.isArray(cached?.items) ? cached.items : []);
      const orderRows = Array.isArray(order?.items) ? order.items : [];
      return rows.concat(orderRows).filter((row) => row && typeof row === 'object');
    } catch (_error) {
      return [];
    }
  };

  const stockQuantityForRow = (row) => {
    const value = row.current_stock ?? row.currentStock;
    if (value === '' || value === null || typeof value === 'undefined') return null;
    const quantity = Number(value);
    return Number.isFinite(quantity) ? quantity : null;
  };

  const applyStockRows = (rows) => {
    const nextRowsByCode = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || typeof row !== 'object' || stockQuantityForRow(row) === null) return;
      [row.sku, row.tag].map(stockCode).filter(Boolean).forEach((code) => {
        if (!nextRowsByCode.has(code)) nextRowsByCode.set(code, row);
      });
    });

    stockRowsByCode = nextRowsByCode;
    const nextSoldOut = new Map();
    scanItems().forEach((item) => {
      const rowsForItem = Array.from(new Set(stockCandidatesFor(item)
        .map((code) => stockRowsByCode.get(code))
        .filter(Boolean)));
      const soldOutRows = rowsForItem.filter((row) => Number(stockQuantityForRow(row)) <= 0);
      if (!soldOutRows.length) return;
      nextSoldOut.set(scanSkuFor(item), {
        name: String(item.productName || item.scanProductName || scanSkuFor(item) || 'Order product'),
        skus: Array.from(new Set(soldOutRows.map((row) => stockCode(row.sku || row.tag)).filter(Boolean)))
      });
    });

    const nextSignature = Array.from(nextSoldOut.values())
      .flatMap((alert) => alert.skus)
      .sort()
      .join('|');
    if (!nextSignature) dismissedSoldOutSignature = '';
    soldOutByScanSku = nextSoldOut;
    soldOutSignature = nextSignature;
    render();
  };

  const stockWarningRequiresDismissal = () => Boolean(
    soldOutSignature && soldOutSignature !== dismissedSoldOutSignature
  );

  const renderStockWarning = () => {
    if (!stockWarning) return;
    const requiresDismissal = stockWarningRequiresDismissal();
    stockWarning.hidden = !requiresDismissal;
    if (!requiresDismissal) return;
    const names = Array.from(soldOutByScanSku.values()).map((alert) => alert.name);
    if (stockWarningProducts) {
      stockWarningProducts.textContent = `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} sold out (stock 0).`;
    }
  };

  const refreshStockInBackground = () => {
    if (!order || stockRefreshPromise) return stockRefreshPromise;
    stockRefreshPromise = fetch(skuDbEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then((response) => readJsonResponse(response, 'Unable to refresh inventory.').then((payload) => {
        if (!response.ok) throw new Error(payload.error || 'Unable to refresh inventory.');
        applyStockRows(payload.database?.skus || []);
        return true;
      }))
      .catch(() => false)
      .finally(() => {
        stockRefreshPromise = null;
      });
    return stockRefreshPromise;
  };

  const normalizeSourceKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);

  const sourceKeyFromOrder = (targetOrder) => {
    const platform = normalizeSourceKey(targetOrder?.platform || '');
    const accountKey = normalizeSourceKey(targetOrder?.sourceAccountKey || targetOrder?.account_key || '');
    if (accountKey) return accountKey;
    if (platform === 'partner') {
      const partnerCode = normalizeSourceKey(targetOrder?.partnerCode || targetOrder?.partner_code || targetOrder?.account || '');
      return `partner-${partnerCode || 'unknown'}`;
    }
    const account = normalizeSourceKey(targetOrder?.account || '');
    return account || platform || 'default';
  };

  const orderActionPayload = (action, extra = {}) => ({
    action,
    order_id: String(order?.id || orderId || ''),
    source_platform: normalizeSourceKey(order?.platform || ''),
    source_account: sourceKeyFromOrder(order),
    ...extra
  });

  const postOrderAction = async (action, extra = {}, options = {}) => {
    const response = await fetch(ordersEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: Boolean(options.keepalive),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(orderActionPayload(action, extra))
    });
    const payload = await readJsonResponse(response, 'Unable to sync scan activity.');
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Unable to sync scan activity.');
    }
    return payload;
  };

  const scanQueueKey = () => [
    normalizeSourceKey(order?.platform || ''),
    sourceKeyFromOrder(order),
    String(order?.id || orderId || '')
  ].join('\u0000');

  const readPendingScanQueues = () => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pendingScanQueueStorageKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const writePendingScanQueues = (queues) => {
    try {
      window.localStorage.setItem(pendingScanQueueStorageKey, JSON.stringify(queues));
    } catch (_error) {
      // Scan state remains in memory for this page load.
    }
  };

  const consolidateScanItems = (items) => {
    const grouped = new Map();
    (items || []).forEach((item) => {
      const scanSku = scanSkuFor(item);
      const scanBarcode = String(item.scanBarcode || item.barcode || scanSku);
      const key = scanSku || scanBarcode || String(item.productName || item.scanProductName || '');
      const quantity = Number(item.quantity || 0);
      const scanQuantity = scanQuantityFor(item);
      const skipQuantity = skipScanFor(item) ? scanQuantity : 0;
      if (!key) return;

      const sourceSku = String(item.sku || '').trim();
      const sourceBarcode = String(item.barcode || '').trim();
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.scanQuantity += scanQuantity;
        existing.skipQuantity = Number(existing.skipQuantity || 0) + skipQuantity;
        existing.skipScan = Number(existing.skipQuantity || 0) >= existing.scanQuantity;
        if (sourceSku && !existing.sourceSkus.includes(sourceSku)) existing.sourceSkus.push(sourceSku);
        if (sourceBarcode && !existing.sourceBarcodes.includes(sourceBarcode)) existing.sourceBarcodes.push(sourceBarcode);
        return;
      }

      grouped.set(key, {
        ...item,
        quantity,
        scanQuantity,
        skipQuantity,
        sourceSkus: sourceSku ? [sourceSku] : [],
        sourceBarcodes: sourceBarcode ? [sourceBarcode] : []
      });
    });

    return Array.from(grouped.values());
  };

  const scanItems = () => order ? consolidateScanItems(order.items) : [];
  const totalRequired = () => scanItems().reduce((sum, item) => sum + scanQuantityFor(item), 0);
  const totalScanned = () => scanItems().reduce((sum, item) => {
    const required = scanQuantityFor(item);
    return sum + skipQuantityFor(item) + Math.min(scanCountFor(scanSkuFor(item)), manualQuantityFor(item), required);
  }, 0);

  const currentProgress = () => ({
    completed: totalScanned(),
    required: totalRequired()
  });

  const clearPendingScanQueue = () => {
    if (!order) return;
    const queues = readPendingScanQueues();
    delete queues[scanQueueKey()];
    writePendingScanQueues(queues);
  };

  const persistPendingScanQueue = () => {
    if (!order) return;
    const hasPendingCompletion = scanCompletionQueued && !scanCompletedOnServer;
    if (!pendingScanEvents.length && !hasPendingCompletion) {
      clearPendingScanQueue();
      return;
    }

    const queues = readPendingScanQueues();
    queues[scanQueueKey()] = {
      order_id: String(order.id || orderId || ''),
      source_platform: normalizeSourceKey(order.platform || ''),
      source_account: sourceKeyFromOrder(order),
      events: activeFlushBatch.concat(pendingScanEvents),
      progress: currentProgress(),
      complete: hasPendingCompletion,
      updated_at: new Date().toISOString()
    };
    writePendingScanQueues(queues);
  };

  const restorePendingScanQueue = () => {
    if (!order) return;
    const queue = readPendingScanQueues()[scanQueueKey()];
    if (!queue || typeof queue !== 'object') return;
    pendingScanEvents = Array.isArray(queue.events) ? queue.events.filter((event) => event && typeof event === 'object') : [];
    scanCompletionQueued = Boolean(queue.complete);
    pendingScanEvents.forEach((event) => {
      if (event.type !== 'scan') return;
      const sku = String(event.sku || '').trim();
      if (!sku) return;
      scans.set(sku, scanCountFor(sku) + Math.max(1, Number(event.quantity || 1)));
    });
  };

  const scheduleScanFlush = (delay = scanFlushDelayMs) => {
    if (flushTimer) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      flushScanEvents().catch(() => {});
    }, delay);
  };

  const updateSyncStatus = (stateName = '') => {
    if (!syncStatus) return;
    const pending = pendingScanEvents.length + (scanCompletionQueued && !scanCompletedOnServer ? 1 : 0);
    syncStatus.hidden = stateName === '' && pending === 0 && !flushingScans;
    syncStatus.classList.toggle('is-error', stateName === 'error');
    syncStatus.textContent = stateName === 'error'
      ? `Sync pending (${pending || 'retry'})`
      : (flushingScans ? 'Syncing scans' : `Sync pending (${pending})`);
  };

  const queueScanEvent = (event) => {
    pendingScanEvents.push({
      ...event,
      client_created_at: new Date().toISOString(),
      progress_scanned: totalScanned(),
      progress_required: totalRequired()
    });
    persistPendingScanQueue();
    updateSyncStatus();
    scheduleScanFlush();
  };

  const ensureClaimOnServer = async () => {
    if (!order || claimSynced) return true;
    if (claimSyncPromise) return claimSyncPromise;
    claimSyncPromise = postOrderAction('claim_order')
      .then(() => {
        claimSynced = true;
        return true;
      })
      .finally(() => {
        claimSyncPromise = null;
      });
    return claimSyncPromise;
  };

  const flushScanEvents = async () => {
    const hasPendingCompletion = scanCompletionQueued && !scanCompletedOnServer;
    if (!order || flushingScans || (pendingScanEvents.length === 0 && !hasPendingCompletion)) {
      updateSyncStatus();
      return pendingScanEvents.length === 0 && !hasPendingCompletion;
    }

    flushingScans = true;
    updateSyncStatus();
    const batch = pendingScanEvents.splice(0, pendingScanEvents.length);
    activeFlushBatch = batch;
    persistPendingScanQueue();
    try {
      await ensureClaimOnServer();
      if (batch.length) {
        await postOrderAction('record_scan', {
          events: batch,
          progress: currentProgress()
        });
      }
      if (scanCompletionQueued && !scanCompletedOnServer) {
        await postOrderAction('complete_scan', { progress: currentProgress() });
        scanCompletedOnServer = true;
      }
      activeFlushBatch = [];
      flushingScans = false;
      persistPendingScanQueue();
      updateSyncStatus();
      return pendingScanEvents.length === 0 && (!scanCompletionQueued || scanCompletedOnServer);
    } catch (error) {
      pendingScanEvents = activeFlushBatch.concat(pendingScanEvents);
      activeFlushBatch = [];
      flushingScans = false;
      persistPendingScanQueue();
      updateSyncStatus('error');
      scheduleScanFlush();
      setError(error instanceof Error ? error.message : 'Scan sync failed. Final fulfillment is blocked until sync completes.');
      return false;
    }
  };

  const maybeOpenPrintLabelPage = () => {
    if (!order || printRedirecting) return;
    if (stockWarningRequiresDismissal()) return;
    if (totalRequired() <= 0 || totalScanned() < totalRequired()) return;
    scanCompletionQueued = true;
    persistPendingScanQueue();
    updateSyncStatus();
    scheduleScanFlush();
    openPrintLabelPage();
  };

  const normalizeScanCode = (value) => String(value || '').trim().toUpperCase();
  const skuFromBarcode = (value) => {
    const barcode = normalizeScanCode(value);
    const sku = barcode.slice(0, -1);
    return /^\d{11}$/.test(sku) ? `0${sku}` : sku;
  };

  const setError = (message) => {
    if (!scanError) return;
    scanError.textContent = message;
    scanError.hidden = message === '';
  };

  const setScanStatus = (title, detail = '') => {
    if (!scanStatus) return;
    scanStatus.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    `;
  };

  const openPrintLabelPage = () => {
    if (!order || printRedirecting) return;
    printRedirecting = true;
    try {
      window.sessionStorage.setItem(activeOrderStorageKey, order.id);
    } catch (_error) {
      // Query string still carries the order id.
    }
    setScanStatus('Scan complete', 'Opening label choices while sync continues in the background.');
    window.setTimeout(() => {
      const account = String(order.sourceAccountKey || order.account_key || '');
      const platform = String(order.platform || '').toLowerCase();
      window.location.href = `../print-label/?order=${encodeURIComponent(order.id)}${account ? `&account=${encodeURIComponent(account)}` : ''}${platform ? `&platform=${encodeURIComponent(platform)}` : ''}${params.get('handoff') ? `&handoff=${encodeURIComponent(params.get('handoff'))}` : ''}`;
    }, 420);
  };

  const expectedScanCodes = () => {
    if (!order) return '';
    return [...new Set(scanItems().map((item) => scanSkuFor(item)).filter(Boolean))].join(', ');
  };

  const render = () => {
    renderStockWarning();
    if (!order) {
      if (scanList) scanList.innerHTML = '<div class="admin-board-empty">Return to the order board and start an order first.</div>';
      if (scanProgress) scanProgress.textContent = '0/0';
      return;
    }

    const scanned = totalScanned();
    const required = totalRequired();
    if (scanProgress) scanProgress.textContent = `${scanned}/${required}`;
    if (scanList) {
      scanList.innerHTML = scanItems().map((item) => {
        const scanSku = scanSkuFor(item);
        const required = scanQuantityFor(item);
        const skipped = skipQuantityFor(item);
        const manualRequired = manualQuantityFor(item);
        const count = skipped + Math.min(scanCountFor(scanSku), manualRequired, required);
        const complete = count >= required;
        const soldOut = soldOutByScanSku.get(scanSku);
        const sourceSkus = sourceSkusFor(item).filter((sku) => sku && sku !== scanSku);
        const codeLabel = sourceSkus.length === 1
          ? `Order ${sourceSkus[0]} -> scan ${scanSku}`
          : `${scanSku} / ${item.scanBarcode || item.barcode}`;
        return `
          <article class="admin-scan-item ${complete ? 'is-complete' : ''} ${soldOut ? 'is-sold-out' : ''}">
            <div>
              <strong>${escapeHtml(item.scanProductName || item.productName)}</strong>
              <span>${escapeHtml(skipped > 0 ? `${codeLabel} / Skip Scan` : codeLabel)}</span>
              ${soldOut ? '<span class="admin-scan-item-stock-warning"><b>SOLD OUT</b> Stock is 0 · Update PO amount received</span>' : ''}
            </div>
            <em>${count}/${escapeHtml(required)}</em>
          </article>
        `;
      }).join('');
    }

    if (required > 0 && scanned >= required) {
      window.setTimeout(maybeOpenPrintLabelPage, 120);
    }
  };

  const handleScan = (value) => {
    if (!order || !value) return false;
    const scannedCode = skuFromBarcode(value);
    if (!scannedCode) return false;
    if (stockWarningRequiresDismissal()) {
      const message = 'Sold-out product detected. Dismiss the stock warning before scanning.';
      setError(message);
      setScanStatus('SCAN BLOCKED — SOLD OUT', 'Update PO amount received, or dismiss the warning to continue.');
      if (stockWarningDismiss instanceof HTMLButtonElement) stockWarningDismiss.focus();
      return false;
    }
    const now = Date.now();
    if (lastScanKey === scannedCode && now - lastScanAt < 450) return false;
    lastScanKey = scannedCode;
    lastScanAt = now;
    setScanStatus(`Received ${scannedCode}`, 'Checking this scan against the active order.');
    const items = scanItems();
    const match = items.find((item) => {
      const itemSku = normalizeScanCode(scanSkuFor(item));
      const itemBarcode = normalizeScanCode(item.scanBarcode || item.barcode);
      return scannedCode === itemSku || scannedCode === itemBarcode;
    });

    if (!match) {
      const soldSkuMatch = items.find((item) => {
        const sourceSkus = sourceSkusFor(item).map(normalizeScanCode);
        const sourceBarcodes = sourceBarcodesFor(item).map(normalizeScanCode);
        const scanSku = normalizeScanCode(scanSkuFor(item));
        return (sourceSkus.includes(scannedCode) || sourceBarcodes.includes(scannedCode)) && scannedCode !== scanSku;
      });

      if (soldSkuMatch) {
        const requiredSku = scanSkuFor(soldSkuMatch);
        const requiredCount = scanQuantityFor(soldSkuMatch);
        const message = `ASTRA requires ${requiredCount} scan${requiredCount === 1 ? '' : 's'} of ${requiredSku} for this order SKU.`;
        setError(message);
        setScanStatus('Scan is the order SKU', message);
        queueScanEvent({
          type: 'scan_error',
          code: scannedCode,
          sku: requiredSku,
          message
        });
        return false;
      }

      setError('Barcode not found in this order.');
      setScanStatus('Scan not found', `${scannedCode} is not required. Expected: ${expectedScanCodes() || 'No active SKU'}.`);
      queueScanEvent({
        type: 'scan_error',
        code: scannedCode,
        message: 'Barcode not found in this order.'
      });
      return false;
    }

    const matchManualRequired = manualQuantityFor(match);
    if (matchManualRequired <= 0) {
      setError(`${match.scanProductName || match.productName} is set to Skip Scan.`);
      setScanStatus('Scan skipped', `${match.scanProductName || match.productName} is already counted as scanned.`);
      queueScanEvent({
        type: 'scan_error',
        code: scannedCode,
        sku: scanSkuFor(match),
        message: 'Scanned item is configured as Skip Scan.'
      });
      return false;
    }

    const matchSku = scanSkuFor(match);
    const current = scanCountFor(matchSku);
    if (current >= matchManualRequired) {
      setError(`${match.scanProductName || match.productName} is already fully scanned.`);
      setScanStatus('Already complete', `${match.scanProductName || match.productName} does not need more scans.`);
      queueScanEvent({
        type: 'scan_error',
        code: scannedCode,
        sku: scanSkuFor(match),
        message: 'Item already fully scanned.'
      });
      return false;
    }

    scans.set(matchSku, current + 1);
    setError('');
    queueScanEvent({
      type: 'scan',
      code: scannedCode,
      sku: matchSku,
      quantity: 1,
      message: `${match.scanProductName || match.productName} accepted`
    });
    render();
    setScanStatus('Scan accepted', `${match.scanProductName || match.productName} ${skipQuantityFor(match) + current + 1}/${scanQuantityFor(match)}`);
    if (totalRequired() > 0 && totalScanned() >= totalRequired()) {
      maybeOpenPrintLabelPage();
    }
    return true;
  };

  const submitScanBuffer = () => {
    const value = scanBuffer;
    scanBuffer = '';
    window.clearTimeout(scanBufferTimer);
    handleScan(value);
  };

  const pushSerialChunk = (chunk) => {
    serialReadBuffer += chunk;
    const parts = serialReadBuffer.split(/\r\n|\r|\n|\t/);
    serialReadBuffer = parts.pop() || '';
    parts.forEach((part) => handleScan(part));
    window.clearTimeout(scanBufferTimer);
    scanBufferTimer = window.setTimeout(() => {
      if (!serialReadBuffer.trim()) return;
      const value = serialReadBuffer;
      serialReadBuffer = '';
      handleScan(value);
    }, 160);
  };

  const readSerialLoop = async () => {
    if (!serialPort?.readable) return;
    const decoder = new TextDecoderStream();
    const closed = serialPort.readable.pipeTo(decoder.writable);
    serialReader = decoder.readable.getReader();
    try {
      while (true) {
        const { value, done } = await serialReader.read();
        if (done) break;
        if (value) pushSerialChunk(value);
      }
    } catch (_error) {
      setScanStatus('Barcode input unavailable', 'Scanner setup and testing are available in Store Ops Settings.');
    } finally {
      serialReader?.releaseLock();
      serialReader = null;
      await closed.catch(() => {});
    }
  };

  const openSerialPort = async (port) => {
    serialPort = port;
    window.clearInterval(serverSerialTimer);
    serverSerialTimer = 0;
    if (!serialPort.readable && !serialPort.writable) {
      await serialPort.open({ baudRate: Number(scannerSettings.baud_rate || 9600) });
    }
    setScanStatus('Ready to scan', 'Scan each product barcode.');
    readSerialLoop().catch(() => {});
  };

  const openApprovedSerialScanner = async () => {
    if (!navigator.serial || serialPort?.readable || serialPort?.writable) return false;
    const ports = await navigator.serial.getPorts();
    if (!ports.length) return false;
    await openSerialPort(ports[0]);
    return true;
  };

  const pollServerSerialScanner = async () => {
    if (serialPort?.readable || serialPort?.writable) return;
    if (!serverCanSeeLocalUsb()) {
      window.clearInterval(serverSerialTimer);
      serverSerialTimer = 0;
      if (!serverSerialErrorShown) {
        serverSerialErrorShown = true;
        setScanStatus('Ready for barcode input', 'Scanner setup and testing are available in Store Ops Settings.');
      }
      return;
    }
    try {
      const query = new URLSearchParams({ baud_rate: String(scannerSettings.baud_rate || 9600) });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to read server USB-COM scanner.');
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Unable to read server USB-COM scanner.');
      }
      serverSerialErrorShown = false;
      const codes = Array.isArray(payload.codes) ? payload.codes : [];
      codes.forEach((code) => handleScan(code));
      if (codes.length) setScanStatus('Ready to scan', `Reading ${payload.device || 'serial device'}.`);
    } catch (error) {
      if (serverSerialErrorShown) return;
      serverSerialErrorShown = true;
      const message = error instanceof Error ? error.message : 'Unable to read server USB-COM scanner.';
      setScanStatus('USB-COM scanner not readable', `${message} Web Serial is still available from Chrome or Edge.`);
    }
  };

  const startServerSerialPolling = () => {
    if (serverSerialTimer) return;
    pollServerSerialScanner();
    serverSerialTimer = window.setInterval(pollServerSerialScanner, 280);
  };

  const bindBrowserSerialEvents = () => {
    if (!navigator.serial || typeof navigator.serial.addEventListener !== 'function') return;
    navigator.serial.addEventListener('connect', () => {
      openApprovedSerialScanner().catch(() => {
        setScanStatus('Ready for barcode input', 'Scanner setup and testing are available in Store Ops Settings.');
      });
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target && event.target !== serialPort) return;
      if (serialReader) serialReader.cancel().catch(() => {});
      serialPort = null;
      setScanStatus('Barcode input unavailable', 'Scanner setup and testing are available in Store Ops Settings.');
    });
  };

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target === stockWarningDismiss && (event.key === 'Enter' || event.key === ' ')) return;

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      submitScanBuffer();
      return;
    }

    if (event.key.length !== 1) return;
    event.preventDefault();
    scanBuffer += event.key;
    window.clearTimeout(scanBufferTimer);
    scanBufferTimer = window.setTimeout(submitScanBuffer, 260);
  });

  stockWarningDismiss?.addEventListener('click', () => {
    if (!soldOutSignature) return;
    dismissedSoldOutSignature = soldOutSignature;
    setError('');
    render();
    setScanStatus('Stock warning dismissed', 'Scanning is enabled. Confirm the PO amount received before printing.');
    if (totalRequired() > 0 && totalScanned() >= totalRequired()) {
      window.setTimeout(maybeOpenPrintLabelPage, 120);
    }
  });

  let stockResumeTimer = 0;
  const refreshStockOnResume = () => {
    window.clearTimeout(stockResumeTimer);
    stockResumeTimer = window.setTimeout(() => {
      refreshStockInBackground();
    }, 40);
  };

  window.addEventListener('focus', refreshStockOnResume);
  window.addEventListener('pageshow', refreshStockOnResume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStockOnResume();
  });

  const initialize = async () => {
    applyStockRows(readCachedStockRows());
    refreshStockInBackground();
    try {
      const response = await fetch(scanBridgeEndpoint, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to load scanner settings.');
      scannerSettings = payload.settings || scannerSettings;
    } catch (_error) {
      scannerSettings = { baud_rate: 9600 };
    }

    restorePendingScanQueue();
    render();
    updateSyncStatus();
    if (pendingScanEvents.length || (scanCompletionQueued && !scanCompletedOnServer)) {
      scheduleScanFlush();
    }
    if (!navigator.serial) {
      setScanStatus('Checking USB-COM scanner', 'Reading the local serial device if the server can access it.');
      startServerSerialPolling();
      return;
    }

    try {
      if (!(await openApprovedSerialScanner())) {
        setScanStatus('Ready for barcode input', 'Scanner setup and testing are available in Store Ops Settings.');
        if (serverCanSeeLocalUsb()) startServerSerialPolling();
      }
    } catch (_error) {
      setScanStatus('Ready for barcode input', 'Scanner setup and testing are available in Store Ops Settings.');
      if (serverCanSeeLocalUsb()) startServerSerialPolling();
    }
  };

  window.addEventListener('pagehide', () => {
    window.clearTimeout(stockResumeTimer);
    window.clearTimeout(flushTimer);
    flushTimer = 0;
    persistPendingScanQueue();
    window.clearInterval(serverSerialTimer);
    if (serialReader) serialReader.cancel().catch(() => {});
    if (serialPort?.readable || serialPort?.writable) serialPort.close().catch(() => {});
  });

  bindBrowserSerialEvents();
  initialize();
});
