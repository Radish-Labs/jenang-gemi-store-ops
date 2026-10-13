document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-print-label-page]');
  if (!root) return;

  const ordersStorageKey = 'jg-store-live-orders';
  const printedOrderStorageKey = 'jg-store-printed-order-event';
  const activeOrderStorageKey = 'jg-store-active-order-id';
  const pendingCompletionQueueStorageKey = 'jg-store-pending-order-completions-v1';
  const ordersEndpoint = '../../api/orders-v2/';
  const orderIdNode = document.querySelector('[data-print-order-id]');
  const statusNode = document.querySelector('[data-print-status]');
  const errorNode = document.querySelector('[data-print-error]');
  const optionsNode = document.querySelector('[data-label-options]');
  const confirmationNode = document.querySelector('[data-print-confirmation]');
  const confirmPrintedButton = document.querySelector('[data-confirm-label-printed]');
  const previewNode = document.querySelector('[data-label-preview]');
  const labelFrame = document.querySelector('[data-label-frame]');
  const doneNode = document.querySelector('[data-print-done]');
  const printAgainButton = document.querySelector('[data-print-again]');
  const browserPrintButton = document.querySelector('[data-print-browser-fallback]');

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
      // Printing can continue for this page load without persistence.
    }
  };

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order') || window.sessionStorage.getItem(activeOrderStorageKey) || '';
  const requestedAccount = params.get('account') || '';
  const requestedPlatform = params.get('platform') || '';
  const isReprint = params.get('reprint') === '1';
  const orders = readOrders();
  const storedOrder = orders.find((item) => String(item.id || '') === orderId) || null;
  const order = storedOrder || (orderId ? {
    id: orderId,
    sourceAccountKey: requestedAccount,
    packageNumber: params.get('package') || params.get('package_id') || '',
    platform: requestedPlatform || (orderId.toUpperCase().startsWith('PARTNER-')
      ? 'partner'
      : (orderId.toUpperCase().startsWith('ZEROWEB-')
        ? 'zero_website'
        : (orderId.toUpperCase().startsWith('JGWEB-')
          ? 'jenang_gemi_website'
          : (orderId.toUpperCase().startsWith('WAEXEC-') ? 'whatsapp' : 'shopee'))))
  } : null);
  const sourceAccount = requestedAccount || String(order?.sourceAccountKey || '');
  const packageNumber = String(order?.packageNumber || order?.package_number || params.get('package') || params.get('package_id') || '');
  let printConfirmationTimer = 0;
  let printLifecycleCleanup = () => {};
  let printClosing = false;
  let printInProgress = false;
  let labelUrl = '';
  let labelLoaded = false;

  // Stations with the Store Ops print helper print without the browser
  // dialog and learn from the Windows print queue whether the label went out.
  const printHelper = window.JGStoreOpsPrintHelper || null;
  const helperSettings = printHelper ? printHelper.readSettings() : { enabled: false, printer: '', fit: false };
  const autoPrintedStorageKey = `jg-store-auto-printed:${orderId}`;
  const printedHoldMs = 3000;
  let labelBlob = null;
  let helperAvailable = false;
  let helperRun = 0;
  let helperJobId = '';
  let completionAcknowledged = false;
  let closeTimer = 0;

  // Marketplace labels arrive at label size. Direct, website and partner
  // labels are courier PDFs uploaded at whatever page size the courier uses,
  // so they are redrawn onto a label-sized page before they print.
  const uploadedLabelPlatforms = ['whatsapp', 'zero_website', 'jenang_gemi_website', 'partner'];
  const hasUploadedLabel = uploadedLabelPlatforms.includes(String(order?.platform || '').trim().toLowerCase())
    || /^(WAEXEC|ZEROWEB|JGWEB|PARTNER)-/i.test(orderId);
  const labelSizedBlob = async (blob) => {
    const labelReshape = window.JGStoreOpsLabelReshape || null;
    if (!hasUploadedLabel || !labelReshape) return blob;
    try {
      const reshaped = await labelReshape.reshape(await blob.arrayBuffer());
      return reshaped ? new Blob([reshaped], { type: 'application/pdf' }) : blob;
    } catch (_error) {
      // An unreadable PDF still prints as it was uploaded.
      return blob;
    }
  };

  const normalizeSourceKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);

  const sourceKeyFromOrder = (targetOrder) => {
    const platform = normalizeSourceKey(targetOrder?.platform || '');
    const accountKey = normalizeSourceKey(targetOrder?.sourceAccountKey || targetOrder?.account_key || sourceAccount || '');
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
    label_backed: labelLoaded || Boolean(order?.labelBacked || order?.label_backed),
    ...extra
  });

  const setError = (message) => {
    if (!errorNode) return;
    errorNode.textContent = message;
    errorNode.hidden = message === '';
  };

  const updateStoredOrder = (mutator) => {
    if (!order) return;
    if (storedOrder) {
      mutator(storedOrder);
      writeOrders(orders);
      return;
    }
    const cachedOrder = { ...order, id: String(order.id || orderId || '') };
    mutator(cachedOrder);
    orders.push(cachedOrder);
    writeOrders(orders);
  };

  const markPrinted = (serverAcknowledgedAt) => {
    if (!order) return;
    const printedLabel = {
      source: String(order.platform || 'shopee').toLowerCase(),
      orderId: order.id,
      printedAt: new Date().toISOString(),
      serverAcknowledgedAt
    };
    updateStoredOrder((currentOrder) => {
      currentOrder.printedLabel = printedLabel;
      currentOrder.status = 'FULFILLED';
      currentOrder.fulfillmentStatus = 'FULFILLED';
      currentOrder.started = false;
    });
    try {
      window.localStorage.setItem(printedOrderStorageKey, JSON.stringify({
        orderId: order.id,
        printedAt: printedLabel.printedAt
      }));
    } catch (_error) {
      // Dashboard will still sync the order queue when it regains focus.
    }
  };

  const completionItems = () => (Array.isArray(order?.items) ? order.items : []).map((item) => ({
    sku: String(item.sku || item.tag || item.sourceSkus?.[0] || ''),
    product_name: String(item.productName || item.scanProductName || item.product_name || ''),
    quantity: Math.max(0, Number(item.quantity || item.qty || 0))
  })).filter((item) => item.quantity > 0 && (item.sku || item.product_name));

  const completionQueueKey = (payload) => [
    normalizeSourceKey(payload?.source_platform || ''),
    normalizeSourceKey(payload?.source_account || ''),
    String(payload?.order_id || '').trim(),
    String(payload?.action || '').trim()
  ].join('\u0000');

  const readPendingCompletionQueue = () => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pendingCompletionQueueStorageKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  };

  const persistPendingCompletion = (payload) => {
    try {
      const queue = readPendingCompletionQueue();
      queue[completionQueueKey(payload)] = {
        payload,
        queued_at: new Date().toISOString()
      };
      window.localStorage.setItem(pendingCompletionQueueStorageKey, JSON.stringify(queue));
      return true;
    } catch (_error) {
      return false;
    }
  };

  const removeAcknowledgedCompletion = (key) => {
    try {
      const queue = readPendingCompletionQueue();
      delete queue[key];
      window.localStorage.setItem(pendingCompletionQueueStorageKey, JSON.stringify(queue));
    } catch (_error) {
      // The dashboard can safely retry the idempotent completion later.
    }
  };

  const submitPrintCompletion = async () => {
    if (!order) throw new Error('Order is missing.');
    const timestamp = new Date().toISOString();
    const payload = (isReprint || completionAcknowledged)
      ? orderActionPayload('reprint_label', { printed_at: timestamp })
      : orderActionPayload('fulfill_order', {
        fulfilled_at: timestamp,
        items: completionItems(),
        customer_name: String(order?.customerName || order?.customer_name || order?.username || order?.customer?.username || order?.customer?.name || '').trim()
      });
    if (!persistPendingCompletion(payload)) {
      throw new Error('Store Ops could not save the completion for retry.');
    }
    const key = completionQueueKey(payload);
    const response = await fetch(ordersEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok || responsePayload.ok === false) {
      throw new Error(responsePayload.error || 'Store Ops did not confirm completion.');
    }
    removeAcknowledgedCompletion(key);
    return new Date().toISOString();
  };

  const setConfirmationDisabled = (disabled) => {
    if (confirmPrintedButton instanceof HTMLButtonElement) confirmPrintedButton.disabled = disabled;
  };

  const resetPrintLifecycle = () => {
    window.clearTimeout(printConfirmationTimer);
    printLifecycleCleanup();
    printLifecycleCleanup = () => {};
  };

  const revealPrintConfirmationAtBottom = () => {
    if (!confirmationNode) return;
    confirmationNode.hidden = false;
    window.requestAnimationFrame(() => {
      confirmationNode.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' });
    });
  };

  const showPrintConfirmationFallback = (status = 'Confirm print') => {
    if (!printInProgress || !confirmationNode) return;
    const wasHidden = confirmationNode.hidden;
    setConfirmationDisabled(false);
    if (wasHidden) revealPrintConfirmationAtBottom();
    setPrintEnabled(true);
    if (statusNode) statusNode.textContent = status;
  };

  const leavePrintTab = () => {
    try {
      if (window.opener && !window.opener.closed) window.opener.focus();
    } catch (_error) {
      // Closing the print tab does not depend on focusing its opener.
    }
    window.close();
    window.setTimeout(() => {
      setConfirmationDisabled(false);
      setError('Print confirmed. Your browser prevented automatic closing; you can close this tab.');
    }, 250);
  };

  const closeConfirmedPrintTab = async () => {
    if ((!printInProgress && !labelLoaded) || printClosing) return;
    printInProgress = true;
    printClosing = true;
    resetPrintLifecycle();
    setConfirmationDisabled(true);
    setError('');
    if (statusNode) statusNode.textContent = 'Confirming with Store Ops';
    try {
      const serverAcknowledgedAt = await submitPrintCompletion();
      if (!isReprint && !completionAcknowledged) markPrinted(serverAcknowledgedAt);
      completionAcknowledged = true;
    } catch (error) {
      printClosing = false;
      printInProgress = true;
      setConfirmationDisabled(false);
      if (statusNode) statusNode.textContent = 'Confirmation not sent';
      setError(`${error instanceof Error ? error.message : 'Store Ops could not register the confirmation.'} This order remains listed on every device; press Printed successfully to retry.`);
      return;
    }
    printInProgress = false;
    if (statusNode) statusNode.textContent = 'Print confirmed';
    leavePrintTab();
  };

  const armAutomaticPrintConfirmation = (frameWindow) => {
    resetPrintLifecycle();
    const cleanupCallbacks = [];
    let blurredAt = 0;
    let frameBlurredAt = 0;
    let hiddenAt = 0;

    const confirmAfterPrint = () => {
      if (!printInProgress) return;
      window.setTimeout(() => {
        if (printInProgress) {
          showPrintConfirmationFallback();
        }
      }, 120);
    };
    const addEvent = (target, eventName, listener) => {
      try {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(eventName, listener);
        cleanupCallbacks.push(() => {
          try {
            target.removeEventListener(eventName, listener);
          } catch (_error) {
            // The PDF viewer may become inaccessible while the tab is closing.
          }
        });
      } catch (_error) {
        // Browser-owned PDF viewers may block direct event access.
      }
    };
    const watchPrintMedia = (targetWindow) => {
      try {
        const media = targetWindow?.matchMedia?.('print');
        if (!media) return;
        let enteredPrintMode = media.matches;
        const onChange = (event) => {
          if (event.matches) {
            enteredPrintMode = true;
          } else if (enteredPrintMode) {
            confirmAfterPrint();
          }
        };
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', onChange);
          cleanupCallbacks.push(() => media.removeEventListener('change', onChange));
        } else if (typeof media.addListener === 'function') {
          media.addListener(onChange);
          cleanupCallbacks.push(() => media.removeListener(onChange));
        }
      } catch (_error) {
        // Cross-origin PDF viewers may not expose print media state.
      }
    };

    addEvent(window, 'afterprint', confirmAfterPrint);
    addEvent(frameWindow, 'afterprint', confirmAfterPrint);
    addEvent(window, 'blur', () => {
      blurredAt = Date.now();
    });
    addEvent(window, 'focus', () => {
      if (blurredAt && Date.now() - blurredAt >= 1000) confirmAfterPrint();
      blurredAt = 0;
    });
    addEvent(frameWindow, 'blur', () => {
      frameBlurredAt = Date.now();
    });
    addEvent(frameWindow, 'focus', () => {
      if (frameBlurredAt && Date.now() - frameBlurredAt >= 1000) confirmAfterPrint();
      frameBlurredAt = 0;
    });
    addEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= 500) {
        confirmAfterPrint();
        hiddenAt = 0;
      }
    });
    watchPrintMedia(window);
    watchPrintMedia(frameWindow);

    printConfirmationTimer = window.setTimeout(() => {
      showPrintConfirmationFallback();
    }, 12000);
    printLifecycleCleanup = () => {
      cleanupCallbacks.forEach((cleanup) => cleanup());
    };
  };

  const openPrintDialog = () => {
    if (!labelLoaded || printInProgress) return false;
    resetPrintLifecycle();
    if (confirmationNode) confirmationNode.hidden = true;
    setConfirmationDisabled(true);
    setError('');
    printInProgress = true;
    if (statusNode) statusNode.textContent = 'Printing';
    revealPrintConfirmationAtBottom();
    try {
      const frameWindow = labelFrame instanceof HTMLIFrameElement ? labelFrame.contentWindow : null;
      armAutomaticPrintConfirmation(frameWindow);
      if (frameWindow) {
        frameWindow.focus();
        frameWindow.print();
      } else {
        window.print();
      }
      return true;
    } catch (_error) {
      showPrintConfirmationFallback('Print dialog failed');
      if (statusNode) statusNode.textContent = 'Print dialog failed';
      setError('The browser could not open the print dialog. Use the Print button again.');
      return false;
    }
  };

  const printLabel = () => {
    if (!order || !labelLoaded || printClosing) return;
    if (helperAvailable) {
      requestHelperPrint();
      return;
    }
    if (printInProgress) {
      retryPrintDialog();
      return;
    }
    resetPrintLifecycle();
    setPrintEnabled(false);
    setError('');
    if (!openPrintDialog()) {
      setPrintEnabled(true);
      return;
    }
    showPrintConfirmationFallback();
  };

  const retryPrintDialog = () => {
    resetPrintLifecycle();
    printInProgress = false;
    printClosing = false;
    if (!openPrintDialog()) return;
    showPrintConfirmationFallback();
  };

  const hasAutoPrinted = () => {
    try {
      return window.sessionStorage.getItem(autoPrintedStorageKey) === '1';
    } catch (_error) {
      return false;
    }
  };

  const rememberAutoPrinted = () => {
    try {
      window.sessionStorage.setItem(autoPrintedStorageKey, '1');
    } catch (_error) {
      // A reload may then print this label a second time.
    }
  };

  const offerManualConfirmation = (status) => {
    printInProgress = true;
    showPrintConfirmationFallback(status);
  };

  const finishHelperPrint = async () => {
    if (statusNode) statusNode.textContent = 'Confirming with Store Ops';
    try {
      const serverAcknowledgedAt = await submitPrintCompletion();
      if (!isReprint && !completionAcknowledged) markPrinted(serverAcknowledgedAt);
      completionAcknowledged = true;
    } catch (error) {
      // Only the first completion matters; a reprint is just a history entry.
      if (!isReprint && !completionAcknowledged) {
        setError(`${error instanceof Error ? error.message : 'Store Ops could not register the confirmation.'} The label printed, but this order remains listed on every device; press Printed successfully to retry.`);
        offerManualConfirmation('Confirmation not sent');
        return;
      }
    }
    if (statusNode) statusNode.textContent = 'Print confirmed';
    if (doneNode) {
      doneNode.hidden = false;
      window.requestAnimationFrame(() => {
        doneNode.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'center' });
      });
    }
    // Leave a moment to catch a blank or crooked label before the tab closes.
    closeTimer = window.setTimeout(leavePrintTab, printedHoldMs);
  };

  const printThroughHelper = async () => {
    if (!printHelper || !labelBlob || printClosing) return;
    helperRun += 1;
    const run = helperRun;
    window.clearTimeout(closeTimer);
    resetPrintLifecycle();
    printInProgress = false;
    if (confirmationNode) confirmationNode.hidden = true;
    if (doneNode) doneNode.hidden = true;
    if (browserPrintButton) browserPrintButton.hidden = true;
    setPrintEnabled(false);
    setError('');
    if (statusNode) statusNode.textContent = 'Printing';

    let outcome;
    try {
      const sent = await printHelper.print(labelBlob, helperSettings);
      if (run !== helperRun) return;
      helperJobId = sent.id;
      rememberAutoPrinted();
      outcome = await printHelper.watchJob(sent.id, {
        onUpdate: (view) => {
          if (run !== helperRun) return;
          if (view.state === 'attention') {
            if (statusNode) statusNode.textContent = 'Printer needs attention';
            setError(`${printHelper.describeReason(view.reason)} The label prints as soon as that is fixed. Press Print to cancel it and send a new one.`);
            setPrintEnabled(true);
          } else {
            if (statusNode) statusNode.textContent = 'Printing';
            setError('');
            setPrintEnabled(false);
          }
        }
      });
    } catch (error) {
      outcome = { state: error.unreachable ? 'unreachable' : 'failed', reason: error.reason || '' };
    }
    if (run !== helperRun) return;
    helperJobId = '';

    if (outcome.state === 'done') {
      setError('');
      await finishHelperPrint();
      return;
    }
    setPrintEnabled(true);
    if (outcome.state === 'unreachable') {
      helperAvailable = false;
      if (statusNode) statusNode.textContent = 'Print helper not running';
      setError('The Store Ops print helper is not responding on this computer. Press Print to use the browser print dialog.');
      return;
    }
    if (outcome.state === 'unknown') {
      setError('Store Ops could not confirm that the label printed. If it did, press Printed successfully; otherwise press Print to send it again.');
      offerManualConfirmation('Check the printer');
      return;
    }
    if (statusNode) statusNode.textContent = 'Label not printed';
    setError(`${printHelper.describeReason(outcome.reason)} Fix the printer, then press Print to try again.`);
    if (browserPrintButton) browserPrintButton.hidden = false;
  };

  const requestHelperPrint = () => {
    const waitingJobId = helperJobId;
    if (!waitingJobId) {
      printThroughHelper();
      return;
    }
    // Replace a label stuck behind a printer problem instead of queueing a second one.
    helperJobId = '';
    helperRun += 1;
    printHelper.cancel(waitingJobId).catch(() => {}).then(printThroughHelper);
  };

  const startHelperMode = async () => {
    if (!printHelper || !helperSettings.enabled || !labelBlob) return;
    setPrintEnabled(false);
    try {
      await printHelper.status();
      helperAvailable = true;
    } catch (_error) {
      helperAvailable = false;
    }
    setPrintEnabled(true);
    if (!helperAvailable) {
      setError('The Store Ops print helper is not running on this computer, so Print opens the browser print dialog.');
      return;
    }
    if (isReprint) return;
    if (hasAutoPrinted()) {
      setError('This label was already sent to the printer. Press Printed successfully if it came out, or Print to send it again.');
      offerManualConfirmation('Confirm print');
      return;
    }
    printThroughHelper();
  };

  const platformLabel = (value) => {
    const platform = String(value || '').toLowerCase();
    if (platform === 'partner') return 'Partner';
    if (platform === 'zero_website') return 'ZERO Website';
    if (platform === 'jenang_gemi_website') return 'Jenang Gemi Website';
    if (platform === 'tiktok') return 'TikTok Shop';
    return 'Shopee';
  };

  const renderOptions = () => {
    if (!optionsNode) return;
    const platform = platformLabel(order?.platform);
    optionsNode.innerHTML = `
      <button type="button" class="admin-label-option-card admin-label-print-card" data-print-shopee-label disabled>
        <span>
          <strong>${isReprint ? 'Reprint' : platform} Label</strong>
          <small>${escapeHtml(order?.id || orderId || 'Order')}</small>
        </span>
        <i aria-hidden="true"></i>
      </button>
    `;
  };

  const setPrintEnabled = (enabled) => {
    root.querySelectorAll('[data-print-shopee-label]').forEach((button) => {
      if (button instanceof HTMLButtonElement) button.disabled = !enabled;
    });
  };

  const loadLabel = async () => {
    if (!order) return;
    const platform = platformLabel(order.platform);
    if (statusNode) statusNode.textContent = `Fetching ${platform} label`;
    const sourcePlatform = normalizeSourceKey(order?.platform || 'shopee');
    const response = await fetch(`../../api/orders-v2/?shipping_label=1&order=${encodeURIComponent(order.id)}&platform=${encodeURIComponent(sourcePlatform)}${sourceAccount ? `&account=${encodeURIComponent(sourceAccount)}` : ''}${packageNumber ? `&package=${encodeURIComponent(packageNumber)}` : ''}${isReprint ? '&reprint=1' : ''}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/pdf,application/octet-stream,*/*' }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || contentType.includes('application/json')) {
      let message = `Unable to load ${platform} shipping label.`;
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (_error) {
        // Keep the generic label error.
      }
      throw new Error(message);
    }

    const blob = await labelSizedBlob(await response.blob());
    labelBlob = blob;
    if (labelUrl) URL.revokeObjectURL(labelUrl);
    labelUrl = URL.createObjectURL(blob);
    if (labelFrame instanceof HTMLIFrameElement) {
      labelLoaded = false;
      labelFrame.addEventListener('load', () => {
        labelLoaded = true;
        setPrintEnabled(true);
        if (statusNode) statusNode.textContent = 'Ready';
        startHelperMode();
      }, { once: true });
      labelFrame.src = labelUrl;
    } else {
      labelLoaded = true;
      setPrintEnabled(true);
      if (statusNode) statusNode.textContent = 'Ready';
      startHelperMode();
    }
    if (previewNode) previewNode.hidden = false;
  };

  if (orderIdNode) orderIdNode.textContent = order?.id || orderId || 'Order missing';
  if (!order) {
    if (statusNode) statusNode.textContent = 'Order missing';
    setError('Order ID is required.');
  }
  renderOptions();
  if (order) {
    (async () => {
      await loadLabel();
    })().catch((error) => {
      labelLoaded = false;
      setPrintEnabled(false);
      if (statusNode) statusNode.textContent = 'Label unavailable';
      setError(error instanceof Error ? error.message : 'Unable to load shipping label.');
    });
  }

  window.addEventListener('beforeunload', () => {
    window.clearTimeout(closeTimer);
    resetPrintLifecycle();
    if (labelUrl) URL.revokeObjectURL(labelUrl);
  });

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-print-shopee-label]');
    if (!(button instanceof HTMLButtonElement)) return;
    if (!order || button.disabled) return;
    printLabel();
  });

  confirmPrintedButton?.addEventListener('click', closeConfirmedPrintTab);

  printAgainButton?.addEventListener('click', () => {
    window.clearTimeout(closeTimer);
    requestHelperPrint();
  });

  browserPrintButton?.addEventListener('click', () => {
    helperAvailable = false;
    browserPrintButton.hidden = true;
    setError('');
    printLabel();
  });
});
