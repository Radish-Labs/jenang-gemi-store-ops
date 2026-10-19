(() => {
  const settingsStorageKey = 'jg-store-print-helper-v1';
  const helperUrl = 'http://127.0.0.1:47821';

  const reasonMessages = {
    paper_out: 'The printer is out of labels.',
    offline: 'The printer is offline or unplugged.',
    jammed: 'The printer is jammed.',
    door_open: 'The printer cover is open.',
    paused: 'The printer is paused in Windows.',
    needs_attention: 'The printer needs attention.',
    error: 'The printer reported an error.',
    no_printer: 'No label printer is selected. Choose one in Settings > Label printer.',
    bad_label: 'The label file is not a valid PDF.',
    send_failed: 'The label could not be sent to the printer.',
    send_timeout: 'The label could not be sent to the printer.',
    origin_not_allowed: 'The print helper does not recognize this Store Ops address. Download and run the setup again.'
  };

  const describeReason = (reason) => reasonMessages[String(reason || '')] || 'The label could not be printed.';

  const createPrintHelper = ({
    fetchImpl,
    storage,
    baseUrl = helperUrl,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }) => {
    const readSettings = () => {
      let stored = null;
      try {
        stored = JSON.parse(storage.getItem(settingsStorageKey) || 'null');
      } catch (_error) {
        stored = null;
      }
      const configured = Boolean(stored && typeof stored === 'object');
      return {
        configured,
        enabled: configured && Boolean(stored.enabled),
        printer: configured ? String(stored.printer || '') : '',
        fit: configured && Boolean(stored.fit)
      };
    };

    const writeSettings = (changes) => {
      const next = { ...readSettings(), ...changes };
      try {
        storage.setItem(settingsStorageKey, JSON.stringify({
          enabled: Boolean(next.enabled),
          printer: String(next.printer || ''),
          fit: Boolean(next.fit)
        }));
      } catch (_error) {
        // The station keeps using the browser print dialog.
      }
      return readSettings();
    };

    const request = async (path, { method = 'GET', body = null, timeoutMs = 5000 } = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      let payload;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          body,
          cache: 'no-store',
          signal: controller.signal,
          headers: body ? { 'Content-Type': 'application/pdf' } : undefined
        });
        payload = await response.json().catch(() => ({}));
      } catch (_error) {
        throw Object.assign(new Error('The Store Ops print helper is not running on this computer.'), { unreachable: true });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok || payload.ok === false) {
        const reason = String(payload.reason || 'helper_error');
        throw Object.assign(new Error(describeReason(reason)), { reason, status: response.status });
      }
      return payload;
    };

    const status = () => request('/status', { timeoutMs: 2500 });

    const print = (blob, { printer = '', fit = false } = {}) => {
      const query = new URLSearchParams();
      if (printer) query.set('printer', printer);
      if (fit) query.set('fit', '1');
      return request(`/print?${query.toString()}`, { method: 'POST', body: blob, timeoutMs: 20000 });
    };

    const job = (id) => request(`/jobs/${encodeURIComponent(id)}`);
    const cancel = (id) => request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

    // Resolves once the printer has taken the label ("done"), the helper gave
    // up ("failed"/"canceled"), or the outcome can no longer be determined
    // ("unknown"). A printer waiting for labels keeps the watch open.
    const watchJob = async (id, { onUpdate = () => {}, signal = null, intervalMs = 600, stallMs = 90000 } = {}) => {
      let lastSeen = '';
      let lastChangeAt = Date.now();
      let misses = 0;
      for (;;) {
        if (signal?.aborted) return { state: 'aborted', reason: '' };
        let view;
        try {
          view = await job(id);
          misses = 0;
        } catch (error) {
          // The label was already submitted. A status request failure says
          // nothing about whether it printed, and must not trigger a reprint.
          const reason = error.unreachable ? 'helper_unreachable' : (error.reason || 'helper_error');
          const retryable = error.unreachable || error.status >= 500 || reason === 'helper_error';
          misses += 1;
          if (!retryable || misses >= 5) return { state: 'unknown', reason };
          await wait(intervalMs);
          continue;
        }
        if (signal?.aborted) return { state: 'aborted', reason: '' };
        if (['done', 'failed', 'canceled'].includes(view.state)) return view;
        const seen = `${view.state}:${view.reason || ''}`;
        if (seen !== lastSeen) {
          lastSeen = seen;
          lastChangeAt = Date.now();
          onUpdate(view);
        }
        if (view.state !== 'attention' && Date.now() - lastChangeAt > stallMs) {
          return { state: 'unknown', reason: 'stalled' };
        }
        await wait(intervalMs);
      }
    };

    return { readSettings, writeSettings, status, print, job, cancel, watchJob, describeReason };
  };

  // A 100 x 150 mm page so a test print exercises the real label stock.
  const buildTestLabelPdf = (lines) => {
    const escapeText = (value) => String(value).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
    const text = lines.map((line, index) => `BT /F1 ${index === 0 ? 20 : 11} Tf 28 ${372 - (index * 30)} Td (${escapeText(line)}) Tj ET`).join('\n');
    const content = `2 w 14 14 255 397 re S\n${text}`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 283 425] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
      const offset = pdf.length;
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createPrintHelper, buildTestLabelPdf, describeReason, settingsStorageKey };
  }
  if (typeof window === 'undefined') return;

  const helper = createPrintHelper({
    fetchImpl: (...args) => window.fetch(...args),
    storage: window.localStorage
  });
  window.JGStoreOpsPrintHelper = helper;

  const bindSettingsPanel = () => {
    const panel = document.querySelector('[data-print-helper-panel]');
    if (!panel) return;

    const healthCard = panel.querySelector('[data-print-helper-health]');
    const healthTitle = panel.querySelector('[data-print-helper-title]');
    const healthDetail = panel.querySelector('[data-print-helper-detail]');
    const optionsNode = panel.querySelector('[data-print-helper-options]');
    const enabledInput = panel.querySelector('[data-print-helper-enabled]');
    const printerSelect = panel.querySelector('[data-print-helper-printer]');
    const fitInput = panel.querySelector('[data-print-helper-fit]');
    const testButton = panel.querySelector('[data-print-helper-test]');
    let connected = false;
    let testing = false;

    const setHealth = (stateName, title, detail) => {
      if (healthCard) {
        ['is-ok', 'is-error', 'is-checking', 'is-ready'].forEach((name) => healthCard.classList.remove(name));
        healthCard.classList.add(`is-${stateName}`);
      }
      if (healthTitle) healthTitle.textContent = title;
      if (healthDetail) healthDetail.textContent = detail;
    };

    const renderControls = () => {
      const settings = helper.readSettings();
      if (optionsNode) optionsNode.hidden = !connected;
      if (enabledInput instanceof HTMLInputElement) enabledInput.checked = settings.enabled;
      if (fitInput instanceof HTMLInputElement) fitInput.checked = settings.fit;
      if (testButton instanceof HTMLButtonElement) testButton.disabled = !connected || testing;
    };

    const renderPrinters = (printers) => {
      if (!(printerSelect instanceof HTMLSelectElement)) return;
      const settings = helper.readSettings();
      const defaultPrinter = printers.find((printer) => printer.default);
      printerSelect.replaceChildren();
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = defaultPrinter ? `Windows default (${defaultPrinter.name})` : 'Windows default printer';
      printerSelect.append(defaultOption);
      printers.forEach((printer) => {
        const option = document.createElement('option');
        option.value = printer.name;
        option.textContent = printer.name;
        printerSelect.append(option);
      });
      if (settings.printer && !printers.some((printer) => printer.name === settings.printer)) {
        const missing = document.createElement('option');
        missing.value = settings.printer;
        missing.textContent = `${settings.printer} (not found)`;
        printerSelect.append(missing);
      }
      printerSelect.value = settings.printer;
    };

    const check = async () => {
      setHealth('checking', 'Looking for the print helper', 'Checking this computer.');
      let payload;
      try {
        payload = await helper.status();
      } catch (error) {
        connected = false;
        renderControls();
        setHealth(
          'error',
          error.unreachable ? 'Print helper not found on this computer' : 'Print helper refused this page',
          error.unreachable
            ? 'Download the helper, run it once on this computer, then press Recheck. Until then labels use the browser print dialog.'
            : error.message
        );
        return;
      }
      connected = true;
      // A station that just installed the helper wants it switched on.
      if (!helper.readSettings().configured) helper.writeSettings({ enabled: true });
      const printers = Array.isArray(payload.printers) ? payload.printers : [];
      renderPrinters(printers);
      renderControls();
      const settings = helper.readSettings();
      const target = settings.printer
        ? printers.find((printer) => printer.name === settings.printer)
        : (printers.find((printer) => printer.default) || (printers.length === 1 ? printers[0] : null));
      if (!target) {
        setHealth('ready', 'Choose a label printer', settings.printer ? `${settings.printer} is not installed on this computer.` : 'Windows has no default printer. Pick the label printer below.');
      } else if (target.problem) {
        setHealth('ready', describeReason(target.problem), `${target.name} · helper ${payload.version || ''}`.trim());
      } else {
        setHealth('ok', 'Print helper connected', `${target.name} · helper ${payload.version || ''}`.trim());
      }
    };

    const testPrint = async () => {
      if (!connected || testing) return;
      testing = true;
      renderControls();
      setHealth('checking', 'Printing a test label', 'Sending a test label to the printer.');
      const settings = helper.readSettings();
      const pdf = buildTestLabelPdf(['Store Ops', 'Test label', new Date().toLocaleString('en-GB')]);
      try {
        const sent = await helper.print(new Blob([pdf], { type: 'application/pdf' }), settings);
        const controller = new AbortController();
        let problem = '';
        const outcome = await helper.watchJob(sent.id, {
          signal: controller.signal,
          stallMs: 30000,
          onUpdate: (view) => {
            if (view.state !== 'attention') return;
            // A test label must not pop out later, once the printer recovers.
            problem = view.reason;
            controller.abort();
            helper.cancel(sent.id).catch(() => {});
          }
        });
        if (outcome.state === 'done') {
          setHealth('ok', 'Test label printed', `${sent.printer} accepted the label.`);
        } else if (problem) {
          setHealth('error', describeReason(problem), 'The test label was canceled. Fix the printer and try again.');
        } else if (outcome.state === 'unknown') {
          setHealth('ready', 'Could not confirm the test label', 'Check whether the label came out, then press Recheck.');
        } else {
          setHealth('error', describeReason(outcome.reason), 'The test label was not printed.');
        }
      } catch (error) {
        setHealth('error', error.message, 'The test label was not printed.');
      }
      testing = false;
      renderControls();
    };

    enabledInput?.addEventListener('change', () => {
      helper.writeSettings({ enabled: enabledInput.checked });
    });
    fitInput?.addEventListener('change', () => {
      helper.writeSettings({ fit: fitInput.checked });
    });
    printerSelect?.addEventListener('change', () => {
      helper.writeSettings({ printer: printerSelect.value });
      check().catch(() => {});
    });
    panel.querySelector('[data-print-helper-check]')?.addEventListener('click', () => {
      check().catch(() => {});
    });
    testButton?.addEventListener('click', () => {
      testPrint().catch(() => {});
    });
    // Only look for the helper when someone opens this tab, so other devices
    // are never asked for local network access.
    document.querySelectorAll('[data-settings-tab="printer"]').forEach((button) => {
      button.addEventListener('click', () => {
        check().catch(() => {});
      });
    });
    renderControls();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSettingsPanel);
  } else {
    bindSettingsPanel();
  }
})();
