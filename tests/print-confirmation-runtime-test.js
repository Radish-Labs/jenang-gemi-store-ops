const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.JG_PRINT_LABEL_SOURCE || path.join(__dirname, '../print-label.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = () => ({ ok: true, json: async () => ({ ok: true }) });

async function openLabel({ fullStorage = false, automatic = false, replies = [ok] } = {}) {
  class Element {
    constructor() { this.hidden = false; this.disabled = false; this.textContent = ''; this.events = {}; }
    addEventListener(name, fn) { this.events[name] = fn; }
    querySelectorAll() { return []; }
    scrollIntoView() {}
  }
  class Button extends Element {}
  const nodes = new Map(), events = {}, timers = new Map(), posts = [];
  const values = new Map([['jg-store-live-orders', JSON.stringify([{id:'ORDER-1',platform:'shopee',sourceAccountKey:'shop-a',items:[{sku:'SKU-1',quantity:1}]}])]]);
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => {
    if (fullStorage && key === 'jg-store-pending-order-completions-v1') throw new Error('QuotaExceededError');
    values.set(key, value);
  }};
  const document = { querySelector(selector) {
    if (selector === '[data-label-frame]') return null;
    if (!nodes.has(selector)) nodes.set(selector, selector === '[data-confirm-label-printed]' ? new Button() : new Element());
    return nodes.get(selector);
  }, addEventListener(name, fn) { events[name] = fn; } };
  let closed = false, printCount = 0, timerId = 0;
  const window = { localStorage: storage, sessionStorage: storage, location: {search:'?order=ORDER-1'},
    addEventListener() {}, requestAnimationFrame: fn => fn(), close: () => { closed = true; },
    clearTimeout: id => timers.delete(id), setTimeout(fn, ms) { timers.set(++timerId, {fn,ms}); return timerId; },
    JGStoreOpsPrintHelper: {readSettings:()=>({enabled:true}), status:async()=>({ok:true}),
      print:async()=>{ printCount++; return {id:'job-1'}; }, watchJob:async()=>({state:automatic?'done':'unknown'})}
  };
  const context = vm.createContext({window,document,URLSearchParams,AbortController,Error,Element,
    HTMLButtonElement:Button,HTMLIFrameElement:class {},URL:{createObjectURL:()=> 'blob:label',revokeObjectURL(){}},
    fetch:async (url, options = {}) => {
      if (options.method !== 'POST') return {ok:true,headers:{get:()=> 'application/pdf'},blob:async()=>({})};
      posts.push(JSON.parse(options.body));
      const reply = replies.shift();
      if (!reply) throw new Error('Unexpected completion request');
      return reply(options);
    }
  });
  vm.runInContext(source, context);
  await events.DOMContentLoaded();
  for (let i = 0; i < 8; i++) await tick();
  return {nodes, posts, timers, values, click:()=>nodes.get('[data-confirm-label-printed]').events.click(),
    get closed(){return closed;}, get printCount(){return printCount;}};
}

(async () => {
  for (const automatic of [false, true]) {
    const page = await openLabel({fullStorage:true,automatic});
    if (!automatic) await page.click();
    else {
      const closeTimer = [...page.timers.values()].find(timer=>timer.ms===300);
      assert.ok(closeTimer, 'confirmed automatic printing schedules closing even when browser storage is full');
      closeTimer.fn();
    }
    assert.equal(page.posts.length, 1, 'full browser storage must not block server completion');
    assert.equal(page.posts[0].action, 'fulfill_order');
    assert.equal(page.closed, true);
    assert.equal(page.printCount, 1, 'confirming never prints another label');
  }
  const rejected = await openLabel({replies:[()=>({ok:false,json:async()=>({error:'Claim this order before working on it.'})}),ok]});
  await rejected.click();
  assert.equal(rejected.closed, false, 'a rejected completion stays open');
  assert.equal(rejected.nodes.get('[data-print-confirmation-error]').hidden, false);
  assert.match(rejected.nodes.get('[data-print-confirmation-error]').textContent, /Claim this order/);
  assert.equal(rejected.nodes.get('[data-confirm-label-printed]').disabled, false);
  await rejected.click();
  assert.equal(rejected.closed, true);
  assert.equal(rejected.printCount, 1);

  const stalled = await openLabel({replies:[({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')))),ok]});
  const pending = stalled.click();
  assert.equal(stalled.nodes.get('[data-confirm-label-printed]').textContent, 'Saving printed order…');
  [...stalled.timers.values()].find(timer=>timer.ms===30000).fn();
  await pending;
  assert.equal(stalled.closed, false);
  assert.equal(stalled.nodes.get('[data-confirm-label-printed]').disabled, false);
  assert.match(stalled.nodes.get('[data-print-confirmation-error]').textContent, /too long/);
  await stalled.click();
  assert.equal(stalled.closed, true);

  const invalid = await openLabel({replies:[()=>({ok:true,json:async()=>{throw new Error('Not JSON');}})]});
  await invalid.click();
  assert.equal(invalid.closed, false, 'an HTML login page or invalid response must not acknowledge completion');
  assert.notEqual(invalid.values.get('jg-store-pending-order-completions-v1'), '{}', 'keep the unacknowledged retry');
  console.log('print-confirmation-runtime-test: ok (full storage, automatic completion, manual retry, timeout, invalid response)');
})().catch(error=>{console.error(error);process.exitCode=1;});
