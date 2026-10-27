const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { createPrintHelper, buildTestLabelPdf, settingsStorageKey } = require(path.join(root, 'print-helper.js'));

const labelScript = read('print-label.js');
const labelMarkup = read('dashboard/print-label/index.php');
const shellMarkup = read('store-ops-shell.php');
const dashboardMarkup = read('dashboard/index.php');
const helperScript = read('print-helper/store-ops-print-helper.ps1');
const setupTemplate = read('print-helper/setup-template.cmd');
const setupEndpoint = read('api/print-helper/index.php');

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value))
  };
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

const sourceChecks = () => {
  assert.match(labelScript, /const startHelperMode = async \(\) => \{\s*if \(!printHelper \|\| !helperSettings\.enabled \|\| !labelBlob\) return;/, 'only a station that switched the helper on may look for it');
  const startFlow = labelScript.match(/const startHelperMode = async \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(startFlow, /if \(isReprint && !stationMode && !autoReprint\) return;[\s\S]*if \(hasAutoPrinted\(\) && !stationMode && !autoReprint\) \{[\s\S]*return;[\s\S]*printThroughHelper\(\);/, 'a finished scan, a print station job and a toast Reprint print by themselves; a reprint opened by hand or a reloaded tab must not');
  const helperFlow = labelScript.match(/const printThroughHelper = async \(\) => \{[\s\S]*?\n  \};/)[0];
  assert.match(helperFlow, /if \(outcome\.state === 'done'\) \{[\s\S]*?await finishHelperPrint\(\);/, 'the order completes only after the printer took the label');
  assert.doesNotMatch(helperFlow, /submitPrintCompletion|markPrinted/, 'a failed or unconfirmed print must never complete the order');
  assert.match(helperFlow, /outcome\.state === 'unknown'[\s\S]*offerManualConfirmation\(/, 'an unconfirmed print falls back to the manual confirmation button');
  assert.match(labelScript, /const finishHelperPrint = async \(\) => \{[\s\S]*await submitPrintCompletion\(\)[\s\S]*closeTimer = window\.setTimeout\(leavePrintTab, printedHoldMs\)/, 'a printed label is acknowledged by the server before the tab closes');
  assert.match(labelScript, /const requestHelperPrint = \(\) => \{[\s\S]*printHelper\.cancel\(waitingJobId\)/, 'sending a label again replaces the one stuck in the queue');
  assert.match(labelScript, /const printLabel = \(\) => \{[\s\S]*?if \(helperAvailable\) \{\s*requestHelperPrint\(\);\s*return;/, 'Print uses the helper when it is available and the browser dialog otherwise');
  assert.match(labelMarkup, /data-print-done[\s\S]*data-print-again[\s\S]*data-print-browser-fallback/, 'the label page offers Print again and a browser fallback');

  for (const [name, markup] of [['shell', shellMarkup], ['dashboard', dashboardMarkup]]) {
    assert.match(markup, /jg_store_ops_print_helper_settings_tab\(\)/, `${name} settings should list the Label printer tab`);
    assert.match(markup, /jg_store_ops_print_helper_settings_panel\(/, `${name} settings should include the Label printer panel`);
  }
  assert.match(shellMarkup, /data-settings-panel="printer" data-print-helper-panel[\s\S]*api\/print-helper\/[\s\S]*data-print-helper-check[\s\S]*data-print-helper-test[\s\S]*print-helper\.js/, 'the panel offers the download, a recheck, a test print, and loads the helper client');

  assert.doesNotMatch(helperScript, /[^\x00-\x7f]/, 'Windows PowerShell 5.1 needs an ASCII-only helper');
  assert.doesNotMatch(setupTemplate, /[^\x00-\x7f]/, 'cmd.exe needs an ASCII-only setup file');
  assert.match(helperScript, /Prefixes\.Add\(\('http:\/\/127\.0\.0\.1:\{0\}\/' -f \$Port\)\)/, 'the helper must only listen on this computer');
  assert.match(helperScript, /\$AllowedOrigins -notcontains \$origin[\s\S]*?403/, 'other websites must not be able to print');
  assert.equal(setupTemplate.split('#JG-SETUP-BODY').length, 3, 'the setup body marker appears once in the launcher and once before the body');
  for (const placeholder of ['{{ORIGIN}}', '{{PORT}}', '{{HELPER_BASE64}}']) {
    assert.equal(setupTemplate.split(placeholder).length, 2, `${placeholder} should be filled exactly once`);
    assert.ok(setupEndpoint.includes(`'${placeholder}'`), `${placeholder} should be filled by the download endpoint`);
  }
  assert.match(setupEndpoint, /jg_admin_require_auth_json\(\);/, 'only signed-in staff may download the setup file');
  assert.match(read('print-helper.js'), /const helperUrl = 'http:\/\/127\.0\.0\.1:47821';/);
  assert.match(setupEndpoint, /const JG_PRINT_HELPER_PORT = 47821;/, 'the page and the helper must agree on the port');
};

const clientChecks = async () => {
  const storage = memoryStorage();
  const calls = [];
  let responses = [];
  const client = createPrintHelper({
    storage,
    baseUrl: 'http://helper.test',
    wait: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  });

  assert.deepEqual(client.readSettings(), { configured: false, enabled: false, printer: '', fit: false }, 'an unconfigured station keeps the browser dialog');
  client.writeSettings({ enabled: true, printer: 'Label Printer' });
  assert.deepEqual(JSON.parse(storage.getItem(settingsStorageKey)), { enabled: true, printer: 'Label Printer', fit: false });
  assert.equal(client.readSettings().configured, true);

  responses = [jsonResponse(200, { ok: true, id: 'a'.repeat(32), state: 'sending' })];
  await client.print('pdf', { printer: 'Label Printer', fit: true });
  assert.equal(calls.at(-1).url, 'http://helper.test/print?printer=Label+Printer&fit=1');
  assert.equal(calls.at(-1).method, 'POST');

  responses = [jsonResponse(409, { ok: false, reason: 'paper_out' })];
  await assert.rejects(client.print('pdf'), (error) => error.reason === 'paper_out' && /out of labels/.test(error.message) && !error.unreachable);
  responses = [new TypeError('Failed to fetch')];
  await assert.rejects(client.status(), (error) => error.unreachable === true);

  const seen = [];
  responses = [
    jsonResponse(200, { ok: true, state: 'printing', reason: '' }),
    jsonResponse(200, { ok: true, state: 'attention', reason: 'paper_out' }),
    jsonResponse(200, { ok: true, state: 'attention', reason: 'paper_out' }),
    jsonResponse(200, { ok: true, state: 'printing', reason: '' }),
    jsonResponse(200, { ok: true, state: 'done', reason: '' })
  ];
  const finished = await client.watchJob('job', { onUpdate: (view) => seen.push(`${view.state}:${view.reason}`) });
  assert.equal(finished.state, 'done');
  assert.deepEqual(seen, ['printing:', 'attention:paper_out', 'printing:'], 'each printer change is reported once');

  responses = Array.from({ length: 5 }, () => new TypeError('Failed to fetch'));
  assert.deepEqual(await client.watchJob('job'), { state: 'unknown', reason: 'helper_unreachable' }, 'a vanished helper must not be read as a printed label');
  responses = [jsonResponse(404, { ok: false, reason: 'unknown_job' })];
  assert.equal((await client.watchJob('job')).state, 'unknown', 'a lost job record does not prove that the label failed to print');
  const callsBeforeRecovery = calls.length;
  responses = [
    jsonResponse(500, { ok: false, reason: 'helper_error' }),
    jsonResponse(200, { ok: true, state: 'done', reason: '' })
  ];
  assert.equal((await client.watchJob('job')).state, 'done', 'a temporary queue query error should recover and allow normal completion');
  assert.deepEqual(calls.slice(callsBeforeRecovery), [
    { url: 'http://helper.test/jobs/job', method: 'GET' },
    { url: 'http://helper.test/jobs/job', method: 'GET' }
  ], 'recovering print status must never send another label');
  responses = Array.from({ length: 5 }, () => jsonResponse(500, { ok: false, reason: 'helper_error' }));
  assert.deepEqual(await client.watchJob('job'), { state: 'unknown', reason: 'helper_error' }, 'persistent tracking errors should offer manual confirmation');
  responses = [jsonResponse(403, { ok: false, reason: 'origin_not_allowed' })];
  assert.deepEqual(await client.watchJob('job'), { state: 'unknown', reason: 'origin_not_allowed' }, 'lost access to status is not proof of a failed print');
  responses = [jsonResponse(200, { ok: true, state: 'failed', reason: 'send_failed' })];
  assert.deepEqual(await client.watchJob('job'), { ok: true, state: 'failed', reason: 'send_failed' }, 'an explicitly failed print job must remain failed');
  responses = [jsonResponse(200, { ok: true, state: 'printing', reason: '' }), jsonResponse(200, { ok: true, state: 'printing', reason: '' })];
  assert.equal((await client.watchJob('job', { stallMs: -1 })).state, 'unknown', 'a label that never leaves the queue is not assumed printed');
  const aborted = new AbortController();
  aborted.abort();
  assert.equal((await client.watchJob('job', { signal: aborted.signal })).state, 'aborted');

  const pdf = buildTestLabelPdf(['Store Ops', 'Test (label)']);
  assert.ok(pdf.startsWith('%PDF-1.4\n') && pdf.endsWith('%%EOF\n'));
  const xrefOffset = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
  assert.ok(pdf.slice(xrefOffset).startsWith('xref\n'), 'startxref should point at the cross-reference table');
  const offsets = [...pdf.slice(xrefOffset).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.ok(pdf.slice(offset).startsWith(`${index + 1} 0 obj\n`), `object ${index + 1} offset`));
  assert.ok(pdf.includes('(Test \\(label\\))'), 'label text is escaped');
};

// Drives the real helper script against a fake print queue. PowerShell is
// optional on development machines; point JG_PWSH at one to run this part.
const helperChecks = async () => {
  const pwsh = process.env.JG_PWSH || 'pwsh';
  if (spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status !== 0) {
    console.log('print-helper-test: PowerShell not found, skipping the helper run');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-print-helper-'));
  const port = 47000 + Math.floor(Math.random() * 900);
  const origin = 'https://store.example.test';
  const statePath = path.join(dir, 'mock.json');
  const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
  const printers = [{ name: 'Label Printer', default: true, problem: '' }, { name: 'Office A4', default: false, problem: '' }];
  writeState({ printers, jobs: [], exitCode: 0 });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port, allowedOrigins: [origin] }));
  const child = spawn(pwsh, ['-NoProfile', '-File', path.join(root, 'print-helper/store-ops-print-helper.ps1'), '-ConfigPath', path.join(dir, 'config.json'), '-MockStatePath', statePath], { stdio: 'ignore' });

  const base = `http://127.0.0.1:${port}`;
  const call = (pathname, options = {}) => fetch(`${base}${pathname}`, { ...options, headers: { Origin: origin, ...(options.headers || {}) } });
  try {
    let up = false;
    for (let attempt = 0; attempt < 60 && !up; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      up = await fetch(`${base}/status`).then((response) => response.ok, () => false);
    }
    assert.ok(up, 'the helper should start');

    const status = await call('/status');
    assert.equal(status.headers.get('access-control-allow-origin'), origin);
    const statusBody = await status.json();
    assert.deepEqual(statusBody.printers.map((printer) => printer.name), ['Label Printer', 'Office A4']);

    assert.equal((await fetch(`${base}/status`, { headers: { Origin: 'https://evil.example' } })).status, 403, 'another website may not even read status');
    assert.equal((await fetch(`${base}/print`, { method: 'POST', body: '%PDF-1.4' })).status, 403, 'printing needs the Store Ops origin');
    const preflight = await call('/print', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

    assert.equal((await call('/print', { method: 'POST', body: 'not a pdf' })).status, 422);
    assert.equal((await (await call('/print?printer=Missing', { method: 'POST', body: '%PDF-1.4 x' })).json()).reason, 'no_printer');

    const client = createPrintHelper({
      storage: memoryStorage(),
      baseUrl: base,
      fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...(options.headers || {}), Origin: origin } })
    });

    // Out of labels, then refilled: the job waits and then completes.
    const sent = await client.print('%PDF-1.4 label', {});
    assert.equal(sent.printer, 'Label Printer', 'the Windows default printer is used when none is chosen');
    assert.equal(fs.readdirSync(path.join(dir, 'spool')).length, 1, 'the label is written for the print queue');
    writeState({ printers, jobs: [{ id: 7, printer: 'Label Printer', document: 'label', mask: 64 }], exitCode: 0 });
    const updates = [];
    const outcome = await client.watchJob(sent.id, {
      intervalMs: 50,
      onUpdate: (view) => {
        updates.push(`${view.state}:${view.reason}`);
        if (view.reason === 'paper_out') writeState({ printers, jobs: [{ id: 7, printer: 'Label Printer', document: 'label', mask: 16 }], exitCode: 0 });
        else if (updates.includes('attention:paper_out')) writeState({ printers, jobs: [], exitCode: 0 });
      }
    });
    assert.equal(outcome.state, 'done');
    assert.ok(updates.includes('attention:paper_out'), 'an empty printer is reported while the label waits');
    assert.equal(fs.readdirSync(path.join(dir, 'spool')).length, 0, 'finished labels are removed from the spool folder');

    // A stuck label can be withdrawn from the queue.
    const stuck = await client.print('%PDF-1.4 label', {});
    writeState({ printers, jobs: [{ id: 8, printer: 'Label Printer', document: 'label', mask: 32 }], exitCode: 0 });
    assert.equal((await client.job(stuck.id)).reason, 'offline');
    assert.equal((await client.cancel(stuck.id)).state, 'canceled');
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs, [], 'canceling removes the label from the print queue');

    // A printer that is already stopped refuses new labels.
    writeState({ printers: [{ name: 'Label Printer', default: true, problem: 'offline' }], jobs: [], exitCode: 0 });
    await assert.rejects(client.print('%PDF-1.4 label', {}), (error) => error.reason === 'offline');

    // A label that never reached the queue is a failure, not a success.
    writeState({ printers, jobs: [], exitCode: 1 });
    const failed = await client.print('%PDF-1.4 label', {});
    assert.deepEqual(await client.watchJob(failed.id, { intervalMs: 200 }).then((view) => [view.state, view.reason]), ['failed', 'send_failed']);
  } finally {
    // PowerShell ignores SIGTERM while it waits for a request.
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

(async () => {
  sourceChecks();
  await clientChecks();
  await helperChecks();
  console.log('print-helper-test: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
