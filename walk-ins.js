document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-walk-ins]');
  if (!root) return;

  const endpoint = root.dataset.walkInsEndpoint || '../api/walk-ins/';
  const scanBridgeEndpoint = root.dataset.scanBridgeEndpoint || '../api/scan-bridge/';
  const scanSerialEndpoint = root.dataset.scanSerialEndpoint || '../api/scan-serial/';
  const invoiceLayout = window.JGInvoicePrintLayout;
  const invoiceType = String(root.dataset.walkInsInvoiceType || 'walk_in').trim() === 'whatsapp' ? 'whatsapp' : 'walk_in';
  const isWhatsappInvoice = invoiceType === 'whatsapp';
  const defaultCustomerName = root.dataset.walkInsDefaultCustomer || (isWhatsappInvoice ? 'WhatsApp customer' : 'Walk-in customer');
  const contactKind = root.dataset.walkInsContactKind || (isWhatsappInvoice ? 'address' : 'email');
  const contactFallback = contactKind === 'address' ? 'No address' : 'No email';
  const requiresShippingCost = root.dataset.walkInsRequiresShippingCost === 'true';
  const refs = {
    catalogStatus: document.querySelector('[data-walkins-catalog-status]'),
    invoiceNumber: document.querySelector('[data-walkins-invoice-number]'),
    error: document.querySelector('[data-walkins-error]'),
    customerName: document.querySelector('[data-walkins-customer-name]'),
    customerPhone: document.querySelector('[data-walkins-customer-phone]'),
    customerEmail: document.querySelector('[data-walkins-customer-email]'),
    clearCustomer: document.querySelector('[data-walkins-clear-customer]'),
    discountValue: document.querySelector('[data-walkins-discount-value]'),
    discountPrefix: document.querySelector('[data-walkins-discount-prefix]'),
    discountHelp: document.querySelector('[data-walkins-discount-help]'),
    shippingCost: document.querySelector('[data-walkins-shipping-cost]'),
    itemCount: document.querySelector('[data-walkins-item-count]'),
    cartList: document.querySelector('[data-walkins-cart-list]'),
    clearCart: document.querySelector('[data-walkins-clear-cart]'),
    skipSearch: document.querySelector('[data-walkins-skip-search]'),
    skipList: document.querySelector('[data-walkins-skip-list]'),
    summaryCustomer: document.querySelector('[data-walkins-summary-customer]'),
    summaryContact: document.querySelector('[data-walkins-summary-contact]'),
    subtotal: document.querySelector('[data-walkins-subtotal]'),
    discount: document.querySelector('[data-walkins-discount]'),
    tax: document.querySelector('[data-walkins-tax]'),
    shippingTotal: document.querySelector('[data-walkins-shipping-total]'),
    totalItems: document.querySelector('[data-walkins-total-items]'),
    total: document.querySelector('[data-walkins-total]'),
    complete: document.querySelector('[data-walkins-complete]'),
    print: document.querySelector('[data-walkins-print]'),
    printStage: document.querySelector('[data-walkins-print-stage]'),
    newInvoice: document.querySelector('[data-walkins-new-invoice]'),
    completeModal: document.querySelector('[data-walkins-complete-modal]'),
    completeInvoice: document.querySelector('[data-walkins-complete-invoice]'),
    recentList: document.querySelector('[data-walkins-recent-list]')
  };

  const state = {
    catalog: [],
    productBySku: new Map(),
    productByTag: new Map(),
    invoiceNumber: '',
    cart: [],
    paymentMethod: 'Cash',
    invoicePrinted: false,
    recent: [],
    busy: false,
    scannerReady: false,
    scannerLabel: '',
    scannerSettings: { baud_rate: 9600 },
    discountMode: 'percentage'
  };

  let scanBuffer = '';
  let scanBufferTimer = 0;
  let serialPort = null;
  let serialReader = null;
  let serialLoopActive = false;
  let serialReadBuffer = '';
  let serverSerialTimer = 0;
  let serverSerialPolling = false;
  let serverSerialErrorShown = false;
  let printCleanupTimer = 0;
  const recentScanSignals = new Map();
  const duplicateSignalWindowMs = 90;

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const normalizeCode = (value) => String(value || '').trim().toUpperCase();
  const normalizeScannerSettings = (settings) => {
    const baudRate = [9600, 19200, 38400, 57600, 115200].includes(Number(settings?.baud_rate)) ? Number(settings.baud_rate) : 9600;
    return { baud_rate: baudRate };
  };
  const moneyValue = (value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  };
  const shippingCostValue = () => {
    const rawValue = String(refs.shippingCost?.value || '').replace(/[^0-9]/g, '');
    return rawValue === '' ? 0 : moneyValue(rawValue);
  };
  const shippingCostMissing = () => requiresShippingCost && String(refs.shippingCost?.value || '').trim() === '';
  const formatShippingCostInput = () => {
    if (!(refs.shippingCost instanceof HTMLInputElement)) return;
    const digits = refs.shippingCost.value.replace(/[^0-9]/g, '');
    refs.shippingCost.value = digits === '' ? '' : new Intl.NumberFormat('id-ID').format(Number(digits));
  };
  const discountRateForItem = (item) => Math.max(0, Math.min(100, moneyValue(item.discount_rate)));
  const lineGross = (item) => moneyValue(item.sale_price) * Number(item.qty || 0);
  const lineDiscount = (item) => Math.round(lineGross(item) * discountRateForItem(item)) / 100;
  const lineTotal = (item) => Math.max(0, lineGross(item) - lineDiscount(item));

  const orderDiscount = (eligibleTotal) => {
    const raw = String(refs.discountValue?.value || '').trim();
    if (raw === '') return { type: '', value: 0, total: 0, valid: true, message: '' };
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return { type: state.discountMode, value: 0, total: 0, valid: false, message: 'Enter a valid non-negative discount value.' };
    }
    if (state.discountMode === 'percentage') {
      if (value > 100) return { type: state.discountMode, value, total: 0, valid: false, message: 'Discount percentage cannot be more than 100%.' };
      return { type: state.discountMode, value, total: Math.round(eligibleTotal * value) / 100, valid: true, message: '' };
    }
    if (value > eligibleTotal) {
      return { type: state.discountMode, value, total: 0, valid: false, message: 'Sale price cannot be more than the current merchandise total.' };
    }
    return { type: state.discountMode, value, total: Math.max(0, eligibleTotal - value), valid: true, message: '' };
  };

  const formatRupiah = (value) => new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(moneyValue(value));
  const formatPrintNumber = (value) => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(moneyValue(value));

  const setError = (message = '') => {
    if (!refs.error) return;
    refs.error.hidden = message === '';
    refs.error.textContent = message;
  };

  const setCatalogStatus = (message, tone = '') => {
    if (!refs.catalogStatus) return;
    refs.catalogStatus.textContent = message;
    refs.catalogStatus.classList.toggle('admin-status-badge-warn', tone === 'warn');
  };

  const setScannerStatus = (ready, label = '', detail = '') => {
    state.scannerReady = Boolean(ready);
    state.scannerLabel = state.scannerReady ? (label || state.scannerLabel || '') : '';
  };

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

  const requestJson = async (options = {}) => {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...options
    });
    const payload = await readJsonResponse(response, 'Walk Ins request failed.');
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
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

  const parseScannerCodes = (buffer) => String(buffer || '').split(/\r\n|\r|\n|\t/)
    .map((code) => normalizeCode(code))
    .filter(Boolean);

  const skuFromBarcode = (value) => {
    const barcode = normalizeCode(value).replace(/[^A-Z0-9]/g, '');
    const withoutChecksum = barcode.slice(0, -1);
    return /^\d{11}$/.test(withoutChecksum) ? `0${withoutChecksum}` : withoutChecksum;
  };

  const findProductByScan = (value) => {
    const code = normalizeCode(value);
    const candidates = [...new Set([
      code,
      skuFromBarcode(code),
      code.replace(/[^A-Z0-9-]/g, ''),
      code.replace(/[^A-Z0-9]/g, '')
    ].filter(Boolean))];
    for (const candidate of candidates) {
      const product = state.productBySku.get(candidate) || state.productByTag.get(candidate);
      if (product) return product;
    }
    return null;
  };

  const shouldIgnoreDuplicateSignal = (code, source) => {
    const now = Date.now();
    const key = `${source}:${code}`;
    const previous = recentScanSignals.get(key) || 0;
    recentScanSignals.set(key, now);
    recentScanSignals.forEach((timestamp, signalKey) => {
      if (now - timestamp > 1000) recentScanSignals.delete(signalKey);
    });
    return previous > 0 && now - previous < duplicateSignalWindowMs;
  };

  const scannerPortLabel = (port) => {
    if (!port) return '';
    const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
    const vendorId = Number(info.usbVendorId || 0);
    const productId = Number(info.usbProductId || 0);
    if (!vendorId && !productId) return 'USB-COM scanner';
    return `USB-COM scanner (${[vendorId, productId]
      .map((value) => value.toString(16).toUpperCase().padStart(4, '0'))
      .join(':')})`;
  };

  const hydrateCatalog = (catalog) => {
    state.catalog = Array.isArray(catalog) ? catalog : [];
    state.productBySku = new Map();
    state.productByTag = new Map();
    state.catalog.forEach((product) => {
      const sku = normalizeCode(product.sku);
      const tag = normalizeCode(product.tag);
      if (sku) state.productBySku.set(sku, product);
      if (tag) state.productByTag.set(tag, product);
    });
    setCatalogStatus(`${state.catalog.length} SKUs ready`);
  };

  const totals = () => {
    const subtotal = state.cart.reduce((sum, item) => sum + lineGross(item), 0);
    const catalogDiscount = state.cart.reduce((sum, item) => sum + lineDiscount(item), 0);
    const manualDiscount = {
      type: '',
      value: 0,
      total: 0,
      valid: true,
      message: ''
    };
    const discount = catalogDiscount;
    const tax = 0;
    const itemCount = state.cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const shippingCost = isWhatsappInvoice ? shippingCostValue() : 0;
    return { subtotal, discount, catalogDiscount, manualDiscount, tax, shippingCost, total: subtotal - discount + tax + shippingCost, itemCount };
  };

  const renderInvoiceNumber = () => {
    if (refs.invoiceNumber) refs.invoiceNumber.textContent = state.invoiceNumber || 'New invoice';
  };

  const renderCustomerSummary = () => {
    const name = String(refs.customerName?.value || '').trim();
    const phone = String(refs.customerPhone?.value || '').trim();
    const contact = String(refs.customerEmail?.value || '').trim();
    if (refs.summaryCustomer) refs.summaryCustomer.textContent = name || defaultCustomerName;
    if (refs.summaryContact) refs.summaryContact.textContent = `${phone || 'No phone'} / ${contact || contactFallback}`;
  };

  const invoiceCustomerLabel = () => isWhatsappInvoice ? 'Whatsapp' : 'Walk In';

  const renderTotals = () => {
    const summary = totals();
    if (refs.itemCount) refs.itemCount.textContent = `${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'} in cart`;
    if (refs.subtotal) refs.subtotal.textContent = formatRupiah(summary.subtotal);
    if (refs.discount) refs.discount.textContent = formatRupiah(summary.discount);
    if (refs.tax) refs.tax.textContent = formatRupiah(summary.tax);
    if (refs.shippingTotal) refs.shippingTotal.textContent = formatRupiah(summary.shippingCost);
    if (refs.totalItems) refs.totalItems.textContent = String(summary.itemCount);
    if (refs.total) refs.total.textContent = formatRupiah(summary.total);
    if (refs.complete instanceof HTMLButtonElement) {
      const needsPrintedInvoice = state.cart.length > 0 && !state.invoicePrinted;
      const shippingMissing = shippingCostMissing();
      refs.complete.disabled = state.busy || state.cart.length === 0 || needsPrintedInvoice || shippingMissing || !summary.manualDiscount.valid;
      refs.complete.classList.toggle('is-locked', needsPrintedInvoice);
      refs.complete.title = shippingMissing
        ? 'Enter a shipping cost before completing this invoice.'
        : (needsPrintedInvoice ? 'Print this invoice before completing the sale.' : '');
    }
    if (refs.print instanceof HTMLButtonElement) {
      refs.print.disabled = state.cart.length === 0 || shippingCostMissing() || !summary.manualDiscount.valid;
      refs.print.title = !summary.manualDiscount.valid ? summary.manualDiscount.message : (shippingCostMissing() ? 'Enter a shipping cost before printing this invoice.' : '');
    }
  };

  const renderCart = () => {
    if (!refs.cartList) return;
    if (!state.cart.length) {
      refs.cartList.innerHTML = `
        <div class="admin-walkins-empty">
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10M8 9h1M11 9h2M15 9h1M8 15h2M12 15h1M15 15h1"/></svg>
          </span>
          <strong>No products added</strong>
          <small>Scan a product or quick-add a skip-scan product.</small>
        </div>
      `;
      renderTotals();
      return;
    }

    refs.cartList.innerHTML = state.cart.map((item) => {
      const unitPrice = moneyValue(item.sale_price);
      const qty = Number(item.qty || 0);
      const discountRate = discountRateForItem(item);
      return `
        <article class="admin-walkins-cart-row" data-cart-sku="${escapeHtml(item.sku)}">
          <span class="admin-walkins-row-icon ${item.scanned ? 'is-scanned' : ''}" aria-hidden="true">
            ${item.scanned
              ? '<svg viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M7 12h10M8 9h1M11 9h2M15 9h1M8 15h2M12 15h1M15 15h1"/></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'}
          </span>
          <span class="admin-walkins-row-main">
            <strong>${escapeHtml(item.name || item.sku)}</strong>
            <small>
              <code>${escapeHtml(item.sku)}</code>
              <i>${item.scanned ? 'Scanned' : 'Skip-scan'}</i>
              ${discountRate > 0 ? `<i>${formatPrintNumber(discountRate)}% off</i>` : ''}
              ${unitPrice <= 0 ? '<b>No sale price</b>' : ''}
            </small>
          </span>
          <label class="admin-walkins-item-discount">
          <span>Discount (%)</span>
          <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value="${discountRate}"
          data-cart-discount="${escapeHtml(item.sku)}"
          aria-label="Discount percentage for ${escapeHtml(item.sku)}"
  >
</label>
          <span class="admin-walkins-row-price">
            <strong>${formatRupiah(unitPrice)}</strong>
            <small>${formatRupiah(lineTotal(item))}</small>
          </span>
          <span class="admin-walkins-qty">
            <button type="button" data-cart-decrease="${escapeHtml(item.sku)}" aria-label="Decrease ${escapeHtml(item.sku)}">-</button>
            <strong>${qty}</strong>
            <button type="button" data-cart-increase="${escapeHtml(item.sku)}" aria-label="Increase ${escapeHtml(item.sku)}">+</button>
          </span>
          <button type="button" class="admin-walkins-remove" data-cart-remove="${escapeHtml(item.sku)}" aria-label="Remove ${escapeHtml(item.sku)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
          </button>
        </article>
      `;
    }).join('');
    renderTotals();
  };

  const renderSkipScan = () => {
    if (!refs.skipList) return;
    const query = String(refs.skipSearch?.value || '').trim().toLowerCase();
    const rows = state.catalog.filter((product) => {
      if (!product.skip_scan) return false;
      if (!query) return true;
      return [
        product.sku,
        product.tag,
        product.name,
        product.brand_name,
        product.product_name,
        product.flavor_name
      ].join(' ').toLowerCase().includes(query);
    }).slice(0, 24);

    if (!rows.length) {
      refs.skipList.innerHTML = `<p class="admin-empty">${state.catalog.length ? 'No skip-scan products match the search.' : 'No SKU catalog loaded.'}</p>`;
      return;
    }

    refs.skipList.innerHTML = rows.map((product) => `
      <button type="button" class="admin-walkins-skip-item" data-skip-sku="${escapeHtml(product.sku)}">
        <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
        <strong>${escapeHtml(product.name || product.sku)}</strong>
        <small>${escapeHtml(product.sku || '')}${product.tag ? ` / ${escapeHtml(product.tag)}` : ''}</small>
        <b>${formatRupiah(product.sale_price)}</b>
      </button>
    `).join('');
  };

  const renderRecent = () => {
    if (!refs.recentList) return;
    if (!state.recent.length) {
      refs.recentList.innerHTML = '<p class="admin-empty">No walk-in invoices yet.</p>';
      return;
    }

    refs.recentList.innerHTML = state.recent.map((invoice) => `
      <article class="admin-walkins-recent-row">
        <span>
          <strong>${escapeHtml(invoice.invoice_number || '')}</strong>
          <small>${escapeHtml(invoice.customer_name || defaultCustomerName)} / ${escapeHtml(invoice.invoice_label || invoice.sale_type || invoice.payment_method || '')}</small>
        </span>
        <b>${formatRupiah(invoice.total)}</b>
      </article>
    `).join('');
  };

  const renderAll = () => {
    renderInvoiceNumber();
    renderCustomerSummary();
    renderCart();
    renderSkipScan();
    renderRecent();
  };

  const invalidatePrintedInvoice = () => {
    state.invoicePrinted = false;
    if (refs.printStage) refs.printStage.innerHTML = '';
  };

  const addToCart = (product, scanned) => {
    if (!product || !product.sku) return;
    setError('');
    invalidatePrintedInvoice();
    const sku = normalizeCode(product.sku);
    const existing = state.cart.find((item) => normalizeCode(item.sku) === sku);
    if (existing) {
      existing.qty += 1;
      existing.scanned = Boolean(existing.scanned || scanned);
    } else {
      state.cart.unshift({
        sku: product.sku,
        tag: product.tag || '',
        name: product.name || product.sku,
        sale_price: product.sale_price || '0.00',
        discount_rate: product.discount_rate || 0,
        qty: 1,
        scanned: Boolean(scanned),
        skip_scan: Boolean(product.skip_scan)
      });
    }
    renderCart();
  };

  const handleScan = (value, source = 'scanner') => {
    const code = normalizeCode(value);
    if (!code) return false;
    if (shouldIgnoreDuplicateSignal(code, source)) return false;
    const product = findProductByScan(code);
    if (!product) {
      setError(`Barcode "${code}" was not found in the live SKU database.`);
      return false;
    }
    addToCart(product, true);
    setScannerStatus(true, state.scannerLabel, `Received ${code}`);
    return true;
  };

  const submitScanBuffer = () => {
    const value = scanBuffer;
    scanBuffer = '';
    window.clearTimeout(scanBufferTimer);
    handleScan(value, 'keyboard');
  };

  const pushSerialChunk = (chunk) => {
    serialReadBuffer += chunk;
    const parts = serialReadBuffer.split(/\r\n|\r|\n|\t/);
    serialReadBuffer = parts.pop() || '';
    parts.forEach((part) => handleScan(part, 'browser-serial'));
    window.clearTimeout(scanBufferTimer);
    scanBufferTimer = window.setTimeout(() => {
      if (!serialReadBuffer.trim()) return;
      const value = serialReadBuffer;
      serialReadBuffer = '';
      handleScan(value, 'browser-serial');
    }, 160);
  };

  const readSerialLoop = async () => {
    if (serialLoopActive || !serialPort?.readable) return;
    serialLoopActive = true;
    const decoder = new TextDecoder();
    serialReader = serialPort.readable.getReader();
    try {
      while (true) {
        const { value, done } = await serialReader.read();
        if (done) break;
        if (value) pushSerialChunk(decoder.decode(value, { stream: true }));
      }
      const remaining = decoder.decode();
      if (remaining) pushSerialChunk(remaining);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setScannerStatus(false, state.scannerLabel, 'Scanner disconnected');
    } finally {
      serialReader?.releaseLock();
      serialReader = null;
      serialLoopActive = false;
    }
  };

  const openSerialPort = async (port) => {
    serialPort = port;
    window.clearInterval(serverSerialTimer);
    serverSerialTimer = 0;
    if (!serialPort.readable && !serialPort.writable) {
      await serialPort.open({ baudRate: Number(state.scannerSettings.baud_rate || 9600) });
    }
    setScannerStatus(true, scannerPortLabel(port), scannerPortLabel(port));
    readSerialLoop().catch(() => {});
  };

  const pollServerSerialScanner = async () => {
    if (serialPort?.readable || serialPort?.writable) return;
    if (serverSerialPolling) return;
    if (!serverCanSeeLocalUsb()) {
      window.clearInterval(serverSerialTimer);
      serverSerialTimer = 0;
      setScannerStatus(false, '', 'No scanner selected');
      return;
    }
    serverSerialPolling = true;
    try {
      const query = new URLSearchParams({ baud_rate: String(state.scannerSettings.baud_rate || 9600) });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to read USB-COM scanner.');
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Unable to read USB-COM scanner.');
      }
      serverSerialErrorShown = false;
      const label = payload.device || 'Local USB-COM scanner';
      setScannerStatus(true, label, label);
      (Array.isArray(payload.codes) ? payload.codes : []).forEach((code) => handleScan(code, 'server-serial'));
    } catch (error) {
      if (serverSerialErrorShown) return;
      serverSerialErrorShown = true;
      setScannerStatus(false, '', error instanceof Error ? error.message : 'Connect scanner');
    } finally {
      serverSerialPolling = false;
    }
  };

  const startServerSerialPolling = () => {
    if (serverSerialTimer) return;
    pollServerSerialScanner();
    serverSerialTimer = window.setInterval(pollServerSerialScanner, 280);
  };

  const connectApprovedScanner = async () => {
    if (navigator.serial) {
      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length) {
          await openSerialPort(ports[0]);
          return true;
        }
      } catch (_error) {
        setScannerStatus(false, '', 'Connect scanner');
        return false;
      }
      setScannerStatus(false, '', 'No scanner selected');
      return false;
    }

    if (serverCanSeeLocalUsb()) {
      startServerSerialPolling();
      return true;
    }

    setScannerStatus(false, '', 'No scanner selected');
    return false;
  };

  const changeQuantity = (sku, delta) => {
    invalidatePrintedInvoice();
    state.cart = state.cart
      .map((item) => normalizeCode(item.sku) === normalizeCode(sku)
        ? { ...item, qty: Math.max(0, Number(item.qty || 0) + delta) }
        : item)
      .filter((item) => Number(item.qty || 0) > 0);
    renderCart();
  };

  const removeItem = (sku) => {
    invalidatePrintedInvoice();
    state.cart = state.cart.filter((item) => normalizeCode(item.sku) !== normalizeCode(sku));
    renderCart();
  };

  const resetInvoice = (invoiceNumber = '') => {
    state.invoiceNumber = invoiceNumber || state.invoiceNumber;
    state.cart = [];
    state.paymentMethod = 'Cash';
    state.invoicePrinted = false;
    state.discountMode = 'percentage';
    if (refs.customerName instanceof HTMLInputElement) refs.customerName.value = '';
    if (refs.customerPhone instanceof HTMLInputElement) refs.customerPhone.value = '';
    if (refs.customerEmail instanceof HTMLInputElement) refs.customerEmail.value = '';
    if (refs.shippingCost instanceof HTMLInputElement) refs.shippingCost.value = '';
    if (refs.discountValue instanceof HTMLInputElement) refs.discountValue.value = '';
    if (refs.discountPrefix) refs.discountPrefix.textContent = '%';
    if (refs.discountHelp) refs.discountHelp.textContent = 'Percentage off the merchandise total.';
    document.querySelectorAll('[data-walkins-discount-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.walkinsDiscountMode === 'percentage');
    });
    document.querySelectorAll('[data-walkins-payment]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.walkinsPayment === 'Cash');
    });
    setError('');
    if (refs.printStage) refs.printStage.innerHTML = '';
    renderAll();
  };

  const showCompleteModal = (invoiceNumber) => {
    if (refs.completeInvoice) refs.completeInvoice.textContent = invoiceNumber;
    if (!refs.completeModal) return;
    refs.completeModal.hidden = false;
    window.setTimeout(() => {
      refs.completeModal.hidden = true;
    }, 1600);
  };

  const customerDetails = () => ({
    name: String(refs.customerName?.value || '').trim() || defaultCustomerName,
    phone: String(refs.customerPhone?.value || '').trim() || '-',
    contact: String(refs.customerEmail?.value || '').trim() || '-'
  });

  const currentInvoiceSale = () => {
    const customer = customerDetails();
    const summary = totals();
    return {
      invoice: {
        invoice_number: state.invoiceNumber || 'New invoice',
        invoice_type: invoiceType,
        invoice_label: invoiceCustomerLabel(),
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: contactKind === 'email' ? customer.contact : '-',
        customer_address: contactKind === 'address' ? customer.contact : '-',
        created_at: new Date().toISOString(),
        subtotal: summary.subtotal,
        discount_total: summary.discount,
        discount_type: summary.manualDiscount.type,
        discount_value: summary.manualDiscount.value,
        shipping_cost: summary.shippingCost,
        total: summary.total
      },
      items: state.cart.map((item) => ({
        ...item,
        line_total: lineTotal(item)
      }))
    };
  };

  const buildPrintableInvoice = () => {
    invoiceLayout.renderInvoice(refs.printStage, currentInvoiceSale(), { logoRoot: '../' });
  };

  const waitForPrintAssets = async () => {
    await invoiceLayout.waitForAssets(refs.printStage);
  };

  const prepareInvoicePrint = () => {
    if (!state.cart.length) {
      setError('Add at least one product before printing the invoice.');
      return false;
    }
    if (shippingCostMissing()) {
      setError('Enter a shipping cost before printing this invoice. Use 0 when shipping is free.');
      return false;
    }
    const summary = totals();
    if (!summary.manualDiscount.valid) {
      setError(summary.manualDiscount.message);
      return false;
    }
    if (!invoiceLayout) {
      setError('Invoice print layout is not available.');
      return false;
    }
    setError('');
    buildPrintableInvoice();
    document.body.classList.add('is-walkins-printing');
    state.invoicePrinted = true;
    renderTotals();
    return true;
  };

  const finishInvoicePrint = () => {
    window.clearTimeout(printCleanupTimer);
    printCleanupTimer = 0;
    document.body.classList.remove('is-walkins-printing');
  };

  const printInvoice = async () => {
    if (!prepareInvoicePrint()) return;
    try {
      await waitForPrintAssets();
      window.focus();
      window.print();
      printCleanupTimer = window.setTimeout(finishInvoicePrint, 10000);
    } catch (_error) {
      state.invoicePrinted = false;
      finishInvoicePrint();
      renderTotals();
      setError('Unable to open the print dialog from this browser.');
    }
  };

  const completeSale = async () => {
    if (!state.cart.length || state.busy || !state.invoicePrinted) return;
    if (shippingCostMissing()) {
      setError('Enter a shipping cost before completing this invoice. Use 0 when shipping is free.');
      renderTotals();
      return;
    }
    const summary = totals();
    if (!summary.manualDiscount.valid) {
      setError(summary.manualDiscount.message);
      renderTotals();
      return;
    }
    state.busy = true;
    renderTotals();
    setError('');
    if (refs.complete) refs.complete.textContent = 'Completing...';

    try {
      const payload = await requestJson({
        method: 'POST',
        body: JSON.stringify({
          action: 'complete_sale',
          invoice_type: invoiceType,
          shipping_cost: shippingCostValue(),
          invoice_number: state.invoiceNumber,
          customer: {
            full_name: refs.customerName?.value || '',
            phone: refs.customerPhone?.value || '',
            email: isWhatsappInvoice ? '' : (refs.customerEmail?.value || ''),
            address: isWhatsappInvoice ? (refs.customerEmail?.value || '') : ''
          },
          payment_method: state.paymentMethod,
          discount: null,
          items: state.cart.map((item) => ({
            sku: item.sku,
            qty: item.qty,
            discount_rate: discountRateForItem(item),
            scanned: Boolean(item.scanned)
          }))
        })
      });

      const completedInvoice = payload.sale?.invoice?.invoice_number || state.invoiceNumber;
      hydrateCatalog(payload.catalog || state.catalog);
      state.recent = Array.isArray(payload.recent) ? payload.recent : state.recent;
      state.invoiceNumber = payload.invoice_number || '';
      resetInvoice(state.invoiceNumber);
      showCompleteModal(completedInvoice);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to complete sale.');
    } finally {
      state.busy = false;
      if (refs.complete) refs.complete.textContent = 'Complete sale';
      renderAll();
    }
  };

  const loadScannerSettings = async () => {
    try {
      const response = await fetch(scanBridgeEndpoint, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to load scanner settings.');
      state.scannerSettings = normalizeScannerSettings(payload.settings || state.scannerSettings);
    } catch (_error) {
      state.scannerSettings = normalizeScannerSettings(state.scannerSettings);
    }
  };

  const loadInitialState = async () => {
    setCatalogStatus('Loading SKUs', 'warn');
    const payload = await requestJson();
    state.invoiceNumber = payload.invoice_number || state.invoiceNumber;
    state.recent = Array.isArray(payload.recent) ? payload.recent : [];
    hydrateCatalog(payload.catalog || []);
    renderAll();
  };

  refs.skipSearch?.addEventListener('input', renderSkipScan);
  refs.skipList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-skip-sku]');
    if (!(button instanceof HTMLButtonElement)) return;
    const product = state.productBySku.get(normalizeCode(button.dataset.skipSku || ''));
    addToCart(product, false);
  });
  refs.cartList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const increase = target?.closest('[data-cart-increase]');
    const decrease = target?.closest('[data-cart-decrease]');
    const remove = target?.closest('[data-cart-remove]');
    if (increase instanceof HTMLButtonElement) changeQuantity(increase.dataset.cartIncrease || '', 1);
    if (decrease instanceof HTMLButtonElement) changeQuantity(decrease.dataset.cartDecrease || '', -1);
    if (remove instanceof HTMLButtonElement) removeItem(remove.dataset.cartRemove || '');
  });
    refs.cartList?.addEventListener('change', (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches('[data-cart-discount]')) return;

    const sku = target.dataset.cartDiscount || '';
    const item = state.cart.find((product) => product.sku === sku);

    if (!item) return;

    const rawValue = target.value.trim();
    const rate = Number(rawValue);

    if (
      rawValue === '' ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      target.value = String(discountRateForItem(item));
      setError('Discount must be between 0% and 100%.');
      return;
    }

    invalidatePrintedInvoice();
    setError('');

    item.discount_rate = rate;

    renderCart();
  });
  refs.clearCart?.addEventListener('click', () => {
    invalidatePrintedInvoice();
    state.cart = [];
    renderCart();
  });
  refs.clearCustomer?.addEventListener('click', () => {
    [refs.customerName, refs.customerPhone, refs.customerEmail].forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = '';
    });
    invalidatePrintedInvoice();
    renderCustomerSummary();
    renderTotals();
    refs.customerName?.focus();
  });
  [refs.customerName, refs.customerPhone, refs.customerEmail].forEach((input) => {
    input?.addEventListener('input', () => {
      invalidatePrintedInvoice();
      renderCustomerSummary();
      renderTotals();
    });
  });
  refs.shippingCost?.addEventListener('input', () => {
    formatShippingCostInput();
    invalidatePrintedInvoice();
    renderTotals();
  });
  document.querySelectorAll('[data-walkins-payment]').forEach((button) => {
    button.addEventListener('click', () => {
      invalidatePrintedInvoice();
      state.paymentMethod = button.dataset.walkinsPayment || 'Cash';
      document.querySelectorAll('[data-walkins-payment]').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      renderTotals();
    });
  });
  refs.complete?.addEventListener('click', completeSale);
  refs.print?.addEventListener('click', printInvoice);
  refs.newInvoice?.addEventListener('click', async () => {
    if (state.cart.length && !window.confirm('Clear this invoice and start a new one?')) return;
    try {
      const payload = await requestJson();
      state.invoiceNumber = payload.invoice_number || state.invoiceNumber;
      hydrateCatalog(payload.catalog || state.catalog);
      state.recent = Array.isArray(payload.recent) ? payload.recent : state.recent;
      resetInvoice(state.invoiceNumber);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to start a new invoice.');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [data-store-settings-modal]')) return;

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

  window.addEventListener('storeops:scanner-status', (event) => {
    const detail = event instanceof CustomEvent && event.detail ? event.detail : {};
    if (detail.ready) {
      setScannerStatus(true, detail.label || '', detail.label || 'Ready for scans');
      connectApprovedScanner().catch(() => {});
      return;
    }
    setScannerStatus(false, '', detail.title || 'No scanner selected');
  });

  window.addEventListener('focus', () => {
    connectApprovedScanner().catch(() => {});
  });

  window.addEventListener('beforeprint', () => {
    if (state.cart.length) prepareInvoicePrint();
  });
  window.addEventListener('afterprint', finishInvoicePrint);
  window.addEventListener('pagehide', () => {
    window.clearInterval(serverSerialTimer);
    window.clearTimeout(scanBufferTimer);
    if (serialReader) serialReader.cancel().catch(() => {});
    if (serialPort?.readable || serialPort?.writable) serialPort.close().catch(() => {});
  });

  setScannerStatus(false, '', 'No scanner selected');
  Promise.all([
    loadScannerSettings(),
    loadInitialState()
  ])
    .then(() => connectApprovedScanner())
    .catch((error) => {
      setCatalogStatus('SKU load failed', 'warn');
      setError(error instanceof Error ? error.message : 'Unable to load Walk Ins.');
    });
});
