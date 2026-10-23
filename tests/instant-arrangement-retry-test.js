const assert = require('node:assert/strict');
global.window = global;
global.document = { addEventListener() {} };
require('../store-home.js');
const action = global.JGStoreOrderPresentation.instantArrangementAction;
for (const state of ['requested', 'retry', 'failed']) {
  const order = { instant: true, instantArrangementState: state, instantArrangementError: 'No supported pickup address' };
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal(action(order).disabled, false);
    assert.equal(action(order).label, 'Retry arrange');
    assert.equal(action(order).error, 'No supported pickup address');
  }
  assert.equal(action(order, { submitting: true }).disabled, true);
  assert.equal(action(order, { submitting: true }).label, 'Arranging…');
  assert.equal(action(order, { locked: true }).disabled, true);
  assert.equal(action(order, { enabled: false }).disabled, true);
}
assert.equal(action({ instantArrangementState: 'required' }).label, 'Accept + arrange');
assert.equal(action({ instantArrangementState: 'label_pending' }).label, 'Retry label');
assert.equal(action({ instantArrangementState: 'label_pending' }).disabled, false);
console.log('Instant arrangement retry presentation passed');

const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../store-home.js'), 'utf8');
const actionSource = source.slice(source.indexOf('  const arrangeInstantShipment ='), source.indexOf('  const showShopeeArrangementError ='));
(async () => {
  const order = { id: 'INSTANT-TEST', instant: true, instantArrangementState: 'requested' };
  let respond;
  let calls = 0;
  let timer;
  let hang = false;
  const pending = new Set();
  const context = {
    state: { orders: [order] }, orderPresentation: global.JGStoreOrderPresentation,
    bigSetEnabled: true, arrangingInstantOrderIds: pending,
    AbortController, Error, setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {},
    saveOrders() {}, renderBoard() {}, showBoardAlert() {}, async refreshOrders() {},
    postOrderAction(_action, _order, _extra, options) {
      calls++;
      return new Promise((resolve, reject) => {
        respond = resolve;
        if (hang) options.signal.addEventListener('abort', () => {
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        });
      });
    }
  };
  vm.createContext(context);
  vm.runInContext(actionSource + '\nglobalThis.arrange = arrangeInstantShipment;', context);
  const first = context.arrange(order.id);
  assert.equal(pending.has(order.id), true);
  await context.arrange(order.id);
  assert.equal(calls, 1, 'Double-clicking must submit only one request');
  respond({ arrangement: { state: 'retry', error: 'No supported pickup address' } });
  await first;
  assert.equal(pending.size, 0);
  assert.equal(action(order).disabled, false);
  const second = context.arrange(order.id);
  assert.equal(calls, 2, 'A failed request must be immediately retryable');
  respond({ arrangement: { state: 'retry', error: 'No supported pickup address' } });
  await second;
  hang = true;
  const timedOut = context.arrange(order.id);
  timer();
  await timedOut;
  assert.equal(pending.size, 0, 'A hung request must release the button');
  assert.match(order.instantArrangementError, /timed out/);
  assert.equal(action(order).disabled, false);
  order.labelBacked = true;
  await context.arrange(order.id);
  assert.equal(calls, 3, 'A label-backed order must not be arranged again');
  console.log('Instant duplicate-click, retry, and timeout handling passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
