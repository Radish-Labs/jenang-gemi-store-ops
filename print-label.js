document.addEventListener('DOMContentLoaded', async () => {
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
  const remotePanel = document.querySelector('[data-remote-print]');

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
  let orderId = params.get('order') || '';
  if (!orderId) {
    try { orderId = window.sessionStorage.getItem(activeOrderStorageKey) || ''; } catch (_error) { /* Storage is optional. */ }
  }
  let handoffOrder = null;
  if (params.get('handoff')) {
    if (statusNode) statusNode.textContent = 'Loading order…';
    try {
      handoffOrder = await window.JGStoreScanHandoff.load(params, ordersEndpoint);
    } catch (error) {
      if (statusNode) statusNode.textContent = 'Unable to load order';
      const errorNode = document.querySelector('[data-print-error]');
      if (errorNode) {
        errorNode.textContent = error instanceof Error ? error.message : 'Reload this page to retry.';
        errorNode.hidden = false;
      }
      return;
    }
  }
  const requestedAccount = params.get('account') || '';
  const requestedPlatform = params.get('platform') || '';
  const isReprint = params.get('reprint') === '1';
  // Reprint from the board's "Printed" toast: print straight away.
  const autoReprint = isReprint && params.get('auto') === '1';
  const orders = readOrders();
  const storedOrder = orders.find((item) => String(item.id || '') === orderId) || null;
  const order = handoffOrder || storedOrder || (orderId ? {
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
  // No waiting on a finished label: the board shows a toast with Reprint.
  const printedHoldMs = 300;
  const lastPrintStorageKey = 'jg-store-last-print';
  let labelBlob = null;
  let helperAvailable = false;
  let helperRun = 0;
  let helperJobId = '';
  let completionAcknowledged = false;
  let closeTimer = 0;

  // Station mode: this page runs inside the computer's print panel for an
  // order the phone scanned. It prints on its own and reports to the panel.
  const stationMode = params.get('station') === '1' && window.parent !== window;
  // Phone mode: phones have no printer, so the label prints on the computer.
  const remotePrint = !stationMode && !isReprint && Boolean(window.JGStoreDevice?.isPhone());
  const postToStation = (message) => {
    if (!stationMode) return;
    try {
      window.parent.postMessage({ source: 'jg-print-station', orderId: order?.id || orderId, ...message }, window.location.origin);
    } catch (_error) {
      // The panel falls back to its own timeout.
    }
  };

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
    // Print station: completes the order as the phone's profile.
    ...(params.get('station') === '1' && params.get('handoff') ? { station_handoff: params.get('handoff') } : {}),
    ...extra
  });

  const setError = (message) => {
    for (const node of [errorNode, document.querySelector('[data-print-confirmation-error]')]) {
      if (!node) continue;
      node.textContent = message;
      node.hidden = message === '';
    }
  };

  const updateStoredOrder = (mutator) => {
    if (!order) return;
    // An older label tab must not replace newer board rows with its startup cache.
    const latestOrders = readOrders();
    const index = latestOrders.findIndex((item) => item
      && String(item.id || '') === String(order.id || '')
      && normalizeSourceKey(item.platform) === normalizeSourceKey(order.platform)
      && sourceKeyFromOrder(item) === sourceKeyFromOrder(order));
    const cachedOrder = { ...order, ...(index >= 0 ? latestOrders[index] : {}) };
    mutator(cachedOrder);
    if (index >= 0) latestOrders[index] = cachedOrder;
    else latestOrders.push(cachedOrder);
    writeOrders(latestOrders);
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

  // The board shows "Printed <order> · Reprint" for this label.
  const rememberLastPrint = (job = 0) => {
    if (!order) return;
    try {
      window.localStorage.setItem(lastPrintStorageKey, JSON.stringify({
        orderId: String(order.id || ''),
        platform: String(order.platform || requestedPlatform || '').toLowerCase(),
        account: sourceAccount,
        package: packageNumber,
        job,
        at: Date.now()
      }));
    } catch (_error) {
      // No toast this time; Reprint label on the board still works.
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
    // Keep a durable retry when storage is available, but do not prevent
    // server confirmation just because this browser's storage is full.
    persistPendingCompletion(payload);
    const key = completionQueueKey(payload);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(ordersEndpoint, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok || responsePayload.ok !== true) {
        throw new Error(responsePayload.error || 'Store Ops did not confirm completion.');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Store Ops took too long to confirm. Retry confirmation without printing another label.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    removeAcknowledgedCompletion(key);
    if (!stationMode) rememberLastPrint();
    return new Date().toISOString();
  };

  const setConfirmationDisabled = (disabled) => {
    if (confirmPrintedButton instanceof HTMLButtonElement) {
      confirmPrintedButton.disabled = disabled;
      confirmPrintedButton.textContent = disabled && printClosing ? 'Saving printed order…' : 'Printed successfully';
    }
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
    if (stationMode) {
      postToStation({ type: 'done' });
      return;
    }
    if (remotePrint) {
      window.location.href = '../';
      return;
    }
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

    // The print window closed: finish without asking. If the label didn't
    // come out, the board's toast has Reprint.
    const confirmAfterPrint = () => {
      if (!printInProgress) return;
      window.setTimeout(() => {
        if (printInProgress && !printClosing) closeConfirmedPrintTab();
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
      if (stationMode) printLabel();
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
    if (isReprint && !stationMode && !autoReprint) return;
    if (hasAutoPrinted() && !stationMode && !autoReprint) {
      setError('This label was already sent to the printer. Press Printed successfully if it came out, or Print to send it again.');
      offerManualConfirmation('Confirm print');
      return;
    }
    printThroughHelper();
  };

  // In the computer's print panel there is nobody to press Print, so print
  // straight away: through the helper when it runs, else the browser dialog.
  const startStationOrHelperPrint = async () => {
    await startHelperMode();
    if ((stationMode || autoReprint) && !helperAvailable && !printInProgress) printLabel();
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

  // The label as the source sends it.
  const fetchLabelBlob = async () => {
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

    return response.blob();
  };

  // A layout chosen on the phone (turn, size) replaces the automatic reshape.
  const chosenLayout = order?.print_layout || null;
  const preparedLabelBlob = async (raw, layout = chosenLayout) => {
    const labelReshape = window.JGStoreOpsLabelReshape || null;
    const blob = layout && labelReshape && !labelReshape.isDefaultLayout(layout)
      ? new Blob([await labelReshape.applyLayout(await raw.arrayBuffer(), layout)], { type: 'application/pdf' })
      : await labelSizedBlob(raw);
    const page = labelReshape && layout ? labelReshape.cleanLayout(layout).page : 0;
    if (!page) return blob;
    const single = await labelReshape.keepPage(await blob.arrayBuffer(), page);
    return single ? new Blob([single], { type: 'application/pdf' }) : blob;
  };

  const loadLabel = async () => {
    if (!order) return;
    const blob = await preparedLabelBlob(await fetchLabelBlob());
    labelBlob = blob;
    if (labelUrl) URL.revokeObjectURL(labelUrl);
    labelUrl = URL.createObjectURL(blob);
    if (labelFrame instanceof HTMLIFrameElement) {
      labelLoaded = false;
      labelFrame.addEventListener('load', () => {
        labelLoaded = true;
        setPrintEnabled(true);
        if (statusNode) statusNode.textContent = 'Ready';
        startStationOrHelperPrint();
      }, { once: true });
      labelFrame.src = labelUrl;
    } else {
      labelLoaded = true;
      setPrintEnabled(true);
      if (statusNode) statusNode.textContent = 'Ready';
      startStationOrHelperPrint();
    }
    if (previewNode) previewNode.hidden = false;
  };

  if (orderIdNode) orderIdNode.textContent = order?.id || orderId || 'Order missing';
  if (!order) {
    if (statusNode) statusNode.textContent = 'Order missing';
    setError('Order ID is required.');
  }
  if (stationMode) {
    const report = () => {
      const status = String(statusNode?.textContent || '').trim();
      const error = String(errorNode && !errorNode.hidden ? errorNode.textContent : '').trim();
      const confirm = Boolean(confirmationNode && !confirmationNode.hidden && !(confirmPrintedButton instanceof HTMLButtonElement && confirmPrintedButton.disabled));
      postToStation({ type: 'status', status, error, confirm });
    };
    const observer = new MutationObserver(report);
    [statusNode, errorNode, confirmationNode, confirmPrintedButton].forEach((node) => {
      if (node) observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    report();
  }

  const runRemotePrint = () => {
    const endpoint = '../../api/mobile-scanner/';
    const title = remotePanel?.querySelector('[data-remote-print-title]');
    const detail = remotePanel?.querySelector('[data-remote-print-detail]');
    const icon = remotePanel?.querySelector('[data-remote-print-icon]');
    const retry = remotePanel?.querySelector('[data-remote-print-retry]');
    const confirmHere = remotePanel?.querySelector('[data-remote-print-confirm]');
    const againHere = remotePanel?.querySelector('[data-remote-print-again]');
    root.querySelectorAll('.admin-label-option-grid, .admin-label-preview, .admin-label-print-confirmation, .admin-label-print-done, .admin-label-browser-print')
      .forEach((node) => { node.hidden = true; node.style.display = 'none'; });
    if (remotePanel) remotePanel.hidden = false;
    let job = 0;
    let known = '';
    let run = 0;
    // Turn and size picked on the preview; null prints the label as it comes.
    let layout = null;
    const show = (heading, text, tone = 'info', canRetry = false, controls = '') => {
      if (title) title.textContent = heading;
      if (detail) detail.textContent = text;
      if (remotePanel) remotePanel.dataset.tone = tone;
      if (icon) icon.textContent = tone === 'ok' ? '✓' : (tone === 'error' ? '!' : '');
      if (retry) retry.hidden = !canRetry;
      if (confirmHere) { confirmHere.hidden = controls !== 'confirm'; confirmHere.disabled = false; }
      if (againHere) { againHere.hidden = !controls; againHere.disabled = false; }
      if (statusNode) statusNode.textContent = heading;
    };
    const render = (state) => {
      const pcOffline = !state.station_online;
      switch (state.status) {
        case 'queued':
          show(pcOffline ? 'No computer is ready' : 'Sent to the computer',
            pcOffline
              ? 'Open Store Ops on the packing computer (any profile). It prints as soon as it connects.'
              : 'Waiting for the computer to start printing…', pcOffline ? 'error' : 'info');
          return false;
        case 'taken':
        case 'printing':
          show('Printing on the computer…', state.detail || 'The label is being printed.');
          return false;
        case 'attention':
          show('Printer needs attention', state.detail || 'Check the printer at the computer.', 'error', false, 'again');
          return false;
        case 'confirm':
          show('Printing on the computer…', 'It finishes by itself when the print window closes.', 'info', false, 'confirm');
          return false;
        case 'printed':
          show('Printed', 'Back to the orders…', 'ok');
          markPrinted(new Date().toISOString());
          rememberLastPrint(job);
          window.setTimeout(() => { window.location.href = '../'; }, 150);
          return true;
        case 'failed':
          // The computer may still fix the printer and retry, so keep watching.
          show('Not printed', state.detail || 'The computer could not print this label.', 'error', true);
          return false;
        default:
          show('Not printed', 'The print request expired. Send it again.', 'error', true);
          return true;
      }
    };
    const watch = async (thisRun) => {
      while (thisRun === run) {
        try {
          const query = new URLSearchParams({ action: 'print_job', job: String(job), known, wait: '10' });
          const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
          const state = await response.json();
          if (!response.ok || state.ok === false) throw new Error(state.error || 'Connection lost.');
          if (thisRun !== run) return;
          known = String(state.signature || '');
          if (render(state)) return;
        } catch (_error) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
    };
    const send = async () => {
      run += 1;
      const thisRun = run;
      known = '';
      show('Sending to the computer…', 'The label prints on the packing computer.');
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ action: 'print_request', order, ...(layout ? { layout } : {}) })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Unable to reach Store Ops.');
        job = Number(payload.job || 0);
        render({ status: 'queued', station_online: Boolean(payload.station_online) });
        watch(thisRun);
      } catch (error) {
        show('Not sent', error instanceof Error ? error.message : 'Unable to reach Store Ops.', 'error', true);
      }
    };
    retry?.addEventListener('click', send);
    const command = async (name, button) => {
      if (!job || !button) return;
      button.disabled = true;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ action: 'print_command', job, command: name })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false || !payload.sent) throw new Error(payload.error || 'The computer has moved on.');
        if (detail) detail.textContent = name === 'confirm' ? 'Saving…' : 'Printing again…';
      } catch (error) {
        button.disabled = false;
        if (detail) detail.textContent = error instanceof Error ? error.message : 'Unable to reach Store Ops.';
      }
    };
    confirmHere?.addEventListener('click', () => command('confirm', confirmHere));
    againHere?.addEventListener('click', () => command('reprint', againHere));
    chooseLayout().then((chosen) => {
      layout = chosen || null;
      send();
    });
  };

  // Phone: preview the label and fix its turn and size before it is sent.
  // The preview is the exact PDF the computer will print.
  const pdfJsUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const pdfJsWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const loadPdfJs = () => new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = pdfJsUrl;
    script.onload = () => {
      if (!window.pdfjsLib) { reject(new Error('Preview unavailable.')); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Preview unavailable.'));
    document.head.appendChild(script);
  });

  const chooseLayout = () => new Promise((resolve) => {
    const section = document.querySelector('[data-remote-layout]');
    const canvas = section?.querySelector('[data-remote-layout-canvas]');
    const note = section?.querySelector('[data-remote-layout-note]');
    const sizeNode = section?.querySelector('[data-remote-layout-size]');
    const resetButton = section?.querySelector('[data-remote-layout-reset]');
    const controls = section ? [...section.querySelectorAll('[data-remote-layout-rotate], [data-remote-layout-smaller], [data-remote-layout-larger], [data-remote-layout-reset]')] : [];
    const reshape = window.JGStoreOpsLabelReshape || null;
    if (!section || !(canvas instanceof HTMLCanvasElement) || !reshape) { resolve(null); return; }
    if (remotePanel) remotePanel.hidden = true;
    section.hidden = false;
    if (statusNode) statusNode.textContent = 'Check the label';
    let raw = null;
    let pdfjs = null;
    const pagesBox = section.querySelector('[data-remote-layout-pages]');
    const pageLabel = section.querySelector('[data-remote-layout-page]');
    const prevButton = section.querySelector('[data-remote-layout-prev]');
    const nextButton = section.querySelector('[data-remote-layout-next]');
    const allButton = section.querySelector('[data-remote-layout-all]');
    const oneButton = section.querySelector('[data-remote-layout-one]');
    const sendButton = section.querySelector('[data-remote-layout-send]');
    let current = { rotate: 0, size: 100 };
    let edited = false;
    let drawRun = 0;
    let viewPage = 1;
    let pageCount = 1;
    let onlyThisPage = false;
    const showPages = () => {
      if (pagesBox) pagesBox.hidden = pageCount <= 1;
      if (pageLabel) pageLabel.textContent = `Page ${viewPage} of ${pageCount}`;
      if (prevButton) prevButton.disabled = viewPage <= 1;
      if (nextButton) nextButton.disabled = viewPage >= pageCount;
      if (allButton) {
        allButton.textContent = `All ${pageCount} pages`;
        allButton.setAttribute('aria-pressed', String(!onlyThisPage));
      }
      if (oneButton) {
        oneButton.textContent = `Only page ${viewPage}`;
        oneButton.setAttribute('aria-pressed', String(onlyThisPage));
      }
      if (sendButton) {
        sendButton.textContent = pageCount > 1
          ? (onlyThisPage ? `Print page ${viewPage} on computer` : `Print all ${pageCount} pages on computer`)
          : 'Print on computer';
      }
    };
    const setControls = (enabled) => controls.forEach((button) => { button.disabled = !enabled; });
    setControls(false);

    const draw = async () => {
      const thisDraw = ++drawRun;
      if (sizeNode) sizeNode.textContent = edited ? `${current.size}%` : 'Original';
      if (resetButton) resetButton.hidden = !edited;
      try {
        const blob = await preparedLabelBlob(raw, edited ? current : null);
        const data = new Uint8Array(await blob.arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        pageCount = doc.numPages;
        viewPage = Math.min(Math.max(1, viewPage), pageCount);
        const page = await doc.getPage(viewPage);
        if (thisDraw !== drawRun) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const width = Math.min(section.clientWidth || 320, 360);
        const viewport = page.getViewport({ scale: (width * ratio) / base.width });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.round(viewport.height / ratio)}px`;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (thisDraw !== drawRun) return;
        canvas.hidden = false;
        section.dataset.drawn = String(thisDraw);
        if (note) {
          note.textContent = '';
          note.hidden = true;
        }
        showPages();
      } catch (_error) {
        if (thisDraw !== drawRun) return;
        if (note) { note.hidden = false; note.textContent = 'The preview could not be drawn. The label can still be printed.'; }
      }
    };
    const change = (next) => {
      current = reshape.cleanLayout(next);
      edited = !reshape.isDefaultLayout(current);
      draw();
    };
    section.querySelector('[data-remote-layout-rotate]')?.addEventListener('click', () => change({ ...current, rotate: current.rotate + 90 }));
    section.querySelector('[data-remote-layout-smaller]')?.addEventListener('click', () => change({ ...current, size: current.size - 5 }));
    section.querySelector('[data-remote-layout-larger]')?.addEventListener('click', () => change({ ...current, size: current.size + 5 }));
    resetButton?.addEventListener('click', () => change({ rotate: 0, size: 100 }));
    prevButton?.addEventListener('click', () => { viewPage -= 1; showPages(); draw(); });
    nextButton?.addEventListener('click', () => { viewPage += 1; showPages(); draw(); });
    allButton?.addEventListener('click', () => { onlyThisPage = false; showPages(); });
    oneButton?.addEventListener('click', () => { onlyThisPage = true; showPages(); });
    sendButton?.addEventListener('click', () => {
      drawRun += 1;
      section.hidden = true;
      if (remotePanel) remotePanel.hidden = false;
      const page = onlyThisPage && pageCount > 1 ? viewPage : 0;
      resolve(edited || page ? { ...current, page } : null);
    }, { once: true });

    (async () => {
      try {
        [raw, pdfjs] = await Promise.all([fetchLabelBlob(), loadPdfJs()]);
        if (statusNode) statusNode.textContent = 'Check the label';
        setControls(true);
        await draw();
      } catch (error) {
        if (note) {
          note.hidden = false;
          note.textContent = `${error instanceof Error ? error.message : 'The label could not be loaded.'} You can still print it on the computer as it comes.`;
        }
      }
    })();
  });

  renderOptions();
  if (order && remotePrint) {
    runRemotePrint();
  } else if (order) {
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

  // Print station: the phone pressed Printed successfully or Print again.
  if (stationMode) {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const message = event.data || {};
      if (message.source !== 'jg-print-station-command') return;
      if (message.command === 'confirm') {
        if (confirmPrintedButton instanceof HTMLButtonElement && !confirmPrintedButton.disabled
          && confirmationNode && !confirmationNode.hidden) confirmPrintedButton.click();
      } else if (message.command === 'reprint' && !printClosing) {
        window.clearTimeout(closeTimer);
        if (helperAvailable) requestHelperPrint();
        else printLabel();
      }
    });
  }

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
