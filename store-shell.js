document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-store-shell]');
  if (!root) return;

  const sidebarBackdrop = document.querySelector('[data-store-sidebar-backdrop]');
  const sidebarToggles = document.querySelectorAll('[data-store-sidebar-toggle]');
  const settingsModal = document.querySelector('[data-store-settings-modal]');
  const settingsError = document.querySelector('[data-store-settings-error]');
  const scannerTestScanButton = document.querySelector('[data-scanner-test-scan]');
  const scannerSelectButton = document.querySelector('[data-scanner-select]');
  const scannerSelectAction = document.querySelector('.admin-scanner-select-action');
  const selectedScannerNode = document.querySelector('[data-selected-scanner]');
  const scannerSummary = document.querySelector('[data-scanner-summary]');
  const scannerSummaryDot = document.querySelector('[data-scanner-summary-dot]');
  const settingsTitle = document.querySelector('[data-settings-title]');
  const compactSidebarQuery = window.matchMedia('(max-width: 760px)');
  const sidebarStorageKey = 'jg-store-sidebar-expanded';
  const scanBridgeEndpoint = root.dataset.scanBridgeEndpoint || '../api/scan-bridge/';
  const scanSerialEndpoint = root.dataset.scanSerialEndpoint || '../api/scan-serial/';

  let scannerSettings = {
    baud_rate: 9600
  };
  let selectedScannerPort = null;
  let selectedScannerLabel = '';
  let selectedScannerVerified = false;
  let activeSettingsTab = 'scanner';
  const scannerBarcodeWaitSeconds = 6;
  const scannerBarcodeWaitMs = scannerBarcodeWaitSeconds * 1000;

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

  const normalizeScannerSettings = (settings) => {
    const baudRate = [9600, 19200, 38400, 57600, 115200].includes(Number(settings?.baud_rate)) ? Number(settings.baud_rate) : 9600;
    return { baud_rate: baudRate };
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
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  const browserSerialSupported = () => Boolean(navigator.serial);

  const browserSerialOpenOptions = () => ({
    baudRate: Number(scannerSettings.baud_rate || 9600)
  });

  const isBrowserSerialPortOpen = (port) => Boolean(port?.readable || port?.writable);

  const browserSerialErrorMessage = (error, fallback = 'Unable to use the USB-COM scanner.') => {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!message) return fallback;
    if (/open|networkerror|busy|in use|locked/i.test(message)) {
      return `The browser could not open the scanner serial port. Close other Store Ops tabs or serial apps, unplug and reconnect the scanner, then try Find Scanner again. Browser detail: ${message}`;
    }
    return message;
  };

  const setSelectedScannerPort = (port, { verified = false } = {}) => {
    selectedScannerPort = port || null;
    selectedScannerLabel = port ? scannerPortLabel(port) : '';
    selectedScannerVerified = Boolean(port && verified);
    renderScannerSelection();
  };

  const notifyScannerStatus = (stateName, title = '') => {
    try {
      window.dispatchEvent(new CustomEvent('storeops:scanner-status', {
        detail: {
          state: stateName,
          ready: stateName === 'ready' || stateName === 'ok',
          label: selectedScannerLabel,
          title
        }
      }));
    } catch (_error) {
      // The scanner status badge can remain local if CustomEvent is unavailable.
    }
  };

  const readBrowserSerialCodes = async (port, timeoutMs = 6000) => {
    if (!port?.readable) return [];
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + timeoutMs;
    let buffer = '';
    try {
      while (Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        const result = await Promise.race([
          reader.read(),
          new Promise((resolve) => window.setTimeout(() => resolve({ timeout: true }), remaining))
        ]);
        if (result.timeout || result.done) break;
        if (result.value) {
          buffer += decoder.decode(result.value, { stream: true });
          if (/[\r\n\t]/.test(buffer)) {
            const codes = parseScannerCodes(buffer);
            if (codes.length) return codes;
          }
        }
      }
      return parseScannerCodes(buffer);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };

  const openBrowserSerialPort = async (port) => {
    if (!port) {
      throw new Error('No USB-COM scanner was selected.');
    }
    if (!isBrowserSerialPortOpen(port)) {
      try {
        await port.open(browserSerialOpenOptions());
      } catch (error) {
        if (isBrowserSerialPortOpen(port)) return false;
        throw new Error(browserSerialErrorMessage(error, 'Unable to open the USB-COM scanner.'));
      }
      return true;
    }
    return false;
  };

  const closeBrowserSerialPort = async (port) => {
    if (!isBrowserSerialPortOpen(port)) return;
    await port.close().catch(() => {});
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

  const renderScannerSelection = () => {
    const label = selectedScannerLabel || 'No scanner selected';
    if (selectedScannerNode) selectedScannerNode.textContent = label;
    if (scannerSummary && !scannerSummary.dataset.healthMessage) scannerSummary.textContent = label;
    if (scannerSelectAction) scannerSelectAction.textContent = selectedScannerPort || selectedScannerLabel ? 'Find again' : 'Find Scanner';
    if (scannerSelectButton instanceof HTMLButtonElement) {
      scannerSelectButton.classList.toggle('is-selected', Boolean(selectedScannerPort || selectedScannerLabel));
    }
  };

  const setScannerHealth = (stateName, title, detail) => {
    const card = document.querySelector('[data-scanner-health]');
    const titleNode = document.querySelector('[data-scanner-health-title]');
    const detailNode = document.querySelector('[data-scanner-health-detail]');
    if (card) {
      card.classList.toggle('is-ok', stateName === 'ok');
      card.classList.toggle('is-error', stateName === 'error');
      card.classList.toggle('is-checking', stateName === 'checking');
      card.classList.toggle('is-ready', stateName === 'ready');
    }
    if (titleNode) titleNode.textContent = title;
    if (detailNode) detailNode.textContent = detail;
    if (scannerSummary) {
      scannerSummary.dataset.healthMessage = title;
      scannerSummary.textContent = stateName === 'ok' && selectedScannerLabel
        ? `${selectedScannerLabel} working`
        : title;
    }
    if (scannerSummaryDot) {
      scannerSummaryDot.classList.toggle('is-ok', stateName === 'ok');
      scannerSummaryDot.classList.toggle('is-error', stateName === 'error');
      scannerSummaryDot.classList.toggle('is-checking', stateName === 'checking');
      scannerSummaryDot.classList.toggle('is-ready', stateName === 'ready');
    }
    notifyScannerStatus(stateName, title);
  };

  const scannerHealthDetail = (payload) => {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const firstExisting = candidates.find((candidate) => candidate.path === payload.device)
      || candidates.find((candidate) => candidate.exists)
      || candidates[0]
      || {};
    const checks = payload.checks || {};
    if (!checks.device_exists) {
      return `No scanner serial device was found. Checked: ${candidates.map((candidate) => candidate.path).filter(Boolean).join(', ') || 'no paths'}.`;
    }
    if (!checks.device_readable) {
      const user = payload.web_user ? ` User: ${payload.web_user}.` : '';
      return `Found ${payload.device}, but it is not readable. Permissions: ${firstExisting.permissions || 'unknown'}.${user} Add the web-server user to dialout or install a udev rule for the scanner.`;
    }
    if (!checks.configured) {
      return `Found ${payload.device}, but stty configuration failed: ${payload.error || 'no command output'}`;
    }
    if (!checks.opened) {
      const user = payload.web_user ? ` User: ${payload.web_user}.` : '';
      return `Found ${payload.device}, but PHP could not open it. Permissions: ${firstExisting.permissions || 'unknown'}.${user} Add the web-server user to dialout or configure a udev rule.`;
    }
    return `Serial path is open on ${payload.device} at ${payload.baud_rate || scannerSettings.baud_rate} baud. Click Test and scan any barcode to prove data is arriving.`;
  };

  const checkBrowserScannerHealth = async () => {
    if (!browserSerialSupported()) {
      setScannerHealth('error', 'Browser cannot access USB-COM', 'Open Store Ops in Chrome or Edge so the browser can talk to the local USB-COM scanner.');
      return false;
    }

    const ports = await navigator.serial.getPorts();
    if (!ports.length) {
      setSelectedScannerPort(null);
      setScannerHealth('ready', 'Find Scanner', `Click Find Scanner, choose the USB-COM barcode scanner, then scan any barcode within ${scannerBarcodeWaitSeconds} seconds to pair it with Store Ops.`);
      return false;
    }

    if (!selectedScannerPort || !ports.includes(selectedScannerPort)) {
      setSelectedScannerPort(ports[0], { verified: selectedScannerVerified });
    }

    if (selectedScannerVerified) {
      setScannerHealth('ok', 'Scanner connected', `${selectedScannerLabel} is paired with this browser.`);
    } else {
      setScannerHealth('ready', 'Scanner permission ready', `${selectedScannerLabel} is approved. Use Test and scan a real barcode to confirm data is arriving.`);
    }
    return true;
  };

  const checkScannerHealth = async () => {
    setScannerHealth('checking', 'Checking scanner', 'Checking whether this browser can reach the local USB-COM scanner.');
    try {
      if (browserSerialSupported()) {
        return await checkBrowserScannerHealth();
      }

      if (!serverCanSeeLocalUsb()) {
        setScannerHealth('error', 'Browser cannot access USB-COM', 'Open Store Ops in Chrome or Edge so the browser can talk to the local USB-COM scanner.');
        return false;
      }

      const query = new URLSearchParams({
        status: '1',
        baud_rate: String(scannerSettings.baud_rate || 9600)
      });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to run USB-COM health check.');
      if (!response.ok || !payload.ok) {
        setScannerHealth('error', 'Scanner command path failed', scannerHealthDetail(payload));
        return false;
      }
      selectedScannerLabel = payload.device || 'Local USB-COM scanner';
      renderScannerSelection();
      setScannerHealth('ready', 'Scanner path ready', scannerHealthDetail(payload));
      return true;
    } catch (error) {
      setScannerHealth('error', 'Scanner health check failed', error instanceof Error ? error.message : 'Unable to run USB-COM health check.');
      return false;
    }
  };

  const selectScanner = async () => {
    if (!browserSerialSupported()) {
      setScannerHealth('error', 'Scanner selection unavailable', 'Use Chrome or Edge to select a USB-COM scanner from this device.');
      return null;
    }
    if (scannerSelectButton instanceof HTMLButtonElement) scannerSelectButton.disabled = true;
    try {
      setScannerHealth('checking', 'Finding scanner', `Choose the USB-COM barcode scanner. Store Ops will then listen ${scannerBarcodeWaitSeconds} seconds for a barcode.`);
      const port = await navigator.serial.requestPort();
      setSelectedScannerPort(port);
      setScannerHealth('checking', 'Waiting for barcode scan', `Scan any barcode within ${scannerBarcodeWaitSeconds} seconds to pair ${selectedScannerLabel} with Store Ops.`);
      const openedHere = await openBrowserSerialPort(port);
      try {
        const codes = await readBrowserSerialCodes(port, scannerBarcodeWaitMs);
        const code = String(codes[0] || '');
        if (!code) {
          setScannerHealth('ready', 'Scanner selected', `${selectedScannerLabel} is approved, but no barcode arrived within ${scannerBarcodeWaitSeconds} seconds. Click Test and scan any barcode to finish checking it.`);
          return port;
        }
        selectedScannerVerified = true;
        setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${selectedScannerLabel}.`);
      } finally {
        if (openedHere) await closeBrowserSerialPort(port);
      }
      return port;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      setScannerHealth('error', 'Scanner selection failed', browserSerialErrorMessage(error, 'Unable to select the USB-COM scanner.'));
      return null;
    } finally {
      if (scannerSelectButton instanceof HTMLButtonElement) scannerSelectButton.disabled = false;
    }
  };

  const testScannerScan = async () => {
    setScannerHealth('checking', 'Waiting for barcode scan', `Scan any product barcode within ${scannerBarcodeWaitSeconds} seconds.`);
    if (scannerTestScanButton instanceof HTMLButtonElement) scannerTestScanButton.disabled = true;
    try {
      if (browserSerialSupported()) {
        const approvedPorts = await navigator.serial.getPorts();
        let port = selectedScannerPort || approvedPorts[0] || null;
        if (!port) {
          port = await selectScanner();
          return Boolean(port && selectedScannerVerified);
        }
        if (!port) return false;
        setSelectedScannerPort(port, { verified: selectedScannerVerified });
        const openedHere = await openBrowserSerialPort(port);
        try {
          const codes = await readBrowserSerialCodes(port, scannerBarcodeWaitMs);
          const code = String(codes[0] || '');
          if (!code) {
            setScannerHealth('error', 'Scanner test failed', 'The browser opened the local USB-COM port, but no barcode data arrived within 6 seconds.');
            return false;
          }
          selectedScannerVerified = true;
          setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${selectedScannerLabel} through this browser.`);
          return true;
        } finally {
          if (openedHere) await closeBrowserSerialPort(port);
        }
      }

      if (!serverCanSeeLocalUsb()) {
        throw new Error('This browser cannot access USB-COM scanners from a hosted Store Ops site. Use Chrome or Edge.');
      }

      const query = new URLSearchParams({
        test: '1',
        baud_rate: String(scannerSettings.baud_rate || 9600)
      });
      const response = await fetch(`${scanSerialEndpoint}?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to run scanner test.');
      const code = Array.isArray(payload.codes) ? String(payload.codes[0] || '') : '';
      if (!response.ok || !payload.ok || !code) {
        setScannerHealth('error', 'Scanner test failed', payload.error || 'No barcode data was received from USB-COM.');
        return false;
      }
      selectedScannerLabel = payload.device || 'Local USB-COM scanner';
      selectedScannerVerified = true;
      renderScannerSelection();
      setScannerHealth('ok', 'Scanner connected', `Received ${code} from ${payload.device || 'USB-COM scanner'} at ${payload.baud_rate || scannerSettings.baud_rate} baud.`);
      return true;
    } catch (error) {
      setScannerHealth('error', 'Scanner test failed', browserSerialErrorMessage(error, 'Unable to run scanner test.'));
      return false;
    } finally {
      if (scannerTestScanButton instanceof HTMLButtonElement) scannerTestScanButton.disabled = false;
    }
  };

  const bindBrowserSerialEvents = () => {
    if (!browserSerialSupported() || typeof navigator.serial.addEventListener !== 'function') return;
    navigator.serial.addEventListener('connect', () => {
      checkBrowserScannerHealth().catch(() => {});
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target && event.target !== selectedScannerPort) return;
      setSelectedScannerPort(null);
      setScannerHealth('ready', 'Scanner disconnected', 'Reconnect the scanner. If it was already paired with this browser, Store Ops will detect it when it appears again.');
    });
  };

  const renderScannerSettings = () => {
    scannerSettings = normalizeScannerSettings(scannerSettings);
    renderScannerSelection();
  };

  const loadScannerSettings = async () => {
    try {
      const response = await fetch(scanBridgeEndpoint, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await readJsonResponse(response, 'Unable to load scanner settings.');
      scannerSettings = normalizeScannerSettings(payload.settings || scannerSettings);
    } catch (_error) {
      scannerSettings = normalizeScannerSettings(scannerSettings);
    }
    renderScannerSettings();
  };

  const settingsTabTitles = {
    scanner: 'Scanner setup',
    printer: 'Label printer'
  };

  const activateSettingsTab = (tab) => {
    activeSettingsTab = Object.hasOwn(settingsTabTitles, tab) ? tab : 'scanner';
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const isActive = button.dataset.settingsTab === activeSettingsTab;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      const isActive = panel.dataset.settingsPanel === activeSettingsTab;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
    if (settingsTitle) settingsTitle.textContent = settingsTabTitles[activeSettingsTab];
  };

  const openSettingsModal = () => {
    if (!settingsModal) return;
    if (settingsError) {
      settingsError.textContent = '';
      settingsError.hidden = true;
    }
    activateSettingsTab('scanner');
    renderScannerSettings();
    settingsModal.hidden = false;
    checkScannerHealth().catch(() => {});
    if (scannerSelectButton instanceof HTMLButtonElement) {
      window.setTimeout(() => scannerSelectButton.focus(), 40);
    }
  };

  const closeSettingsModal = () => {
    if (settingsModal) settingsModal.hidden = true;
  };

  const storedSidebarExpanded = () => {
    try {
      const stored = window.localStorage.getItem(sidebarStorageKey);
      return stored === null ? true : stored === '1';
    } catch (_error) {
      return true;
    }
  };

  const setSidebarExpanded = (expanded, { persist = !compactSidebarQuery.matches } = {}) => {
    const nextExpanded = Boolean(expanded);
    root.classList.toggle('is-sidebar-expanded', nextExpanded);
    sidebarToggles.forEach((button) => {
      button.setAttribute('aria-expanded', String(nextExpanded));
      button.setAttribute('aria-label', nextExpanded ? 'Collapse navigation' : 'Open navigation');
      button.title = nextExpanded ? 'Collapse navigation' : 'Open navigation';
    });
    if (sidebarBackdrop) sidebarBackdrop.hidden = !(compactSidebarQuery.matches && nextExpanded);
    if (!persist) return;
    try {
      window.localStorage.setItem(sidebarStorageKey, nextExpanded ? '1' : '0');
    } catch (_error) {
      // Navigation remains usable without storage.
    }
  };

  const syncSidebarForViewport = () => {
    setSidebarExpanded(compactSidebarQuery.matches ? false : storedSidebarExpanded(), { persist: false });
  };


  document.querySelector('[data-open-store-settings]')?.addEventListener('click', () => {
    if (compactSidebarQuery.matches) setSidebarExpanded(false, { persist: false });
    openSettingsModal();
  });
  document.querySelectorAll('[data-close-store-settings]').forEach((button) => {
    button.addEventListener('click', closeSettingsModal);
  });
  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => activateSettingsTab(button.dataset.settingsTab || 'scanner'));
  });
  scannerSelectButton?.addEventListener('click', () => {
    selectScanner().catch(() => {});
  });
  document.querySelector('[data-scanner-health-check]')?.addEventListener('click', () => {
    checkScannerHealth().catch(() => {});
  });
  scannerTestScanButton?.addEventListener('click', () => {
    testScannerScan().catch(() => {});
  });

  sidebarToggles.forEach((button) => {
    button.addEventListener('click', () => {
      setSidebarExpanded(!root.classList.contains('is-sidebar-expanded'));
    });
  });
  sidebarBackdrop?.addEventListener('click', () => setSidebarExpanded(false, { persist: false }));
  document.querySelectorAll('.admin-store-sidebar a').forEach((link) => {
    link.addEventListener('click', () => {
      if (compactSidebarQuery.matches) setSidebarExpanded(false, { persist: false });
    });
  });
  if (typeof compactSidebarQuery.addEventListener === 'function') {
    compactSidebarQuery.addEventListener('change', syncSidebarForViewport);
  } else if (typeof compactSidebarQuery.addListener === 'function') {
    compactSidebarQuery.addListener(syncSidebarForViewport);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && compactSidebarQuery.matches && root.classList.contains('is-sidebar-expanded')) {
      setSidebarExpanded(false, { persist: false });
      return;
    }
    if (event.key === 'Escape' && settingsModal?.hidden === false) {
      closeSettingsModal();
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === sidebarStorageKey && !compactSidebarQuery.matches) {
      setSidebarExpanded(event.newValue !== '0', { persist: false });
    }
  });

  window.JGStoreOpsScanner = {
    openSettings: openSettingsModal,
    check: checkScannerHealth,
    getState: () => ({
      ready: Boolean(selectedScannerPort || selectedScannerLabel),
      label: selectedScannerLabel,
      settings: { ...scannerSettings }
    })
  };

  syncSidebarForViewport();
  bindBrowserSerialEvents();
  loadScannerSettings()
    .then(() => checkScannerHealth())
    .catch(() => {});
});
