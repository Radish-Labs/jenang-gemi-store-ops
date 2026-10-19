const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'store-home.js'), 'utf8');
const scan = fs.readFileSync(path.join(root, 'store-scan.js'), 'utf8');
const print = fs.readFileSync(path.join(root, 'print-label.js'), 'utf8');
const handoff = fs.readFileSync(path.join(root, 'scan-handoff.js'), 'utf8');
const target = { id: 'NEW', platform: 'shopee', sourceAccountKey: 'shop-a', packageNumber: 'P1',
  customerName: 'Buyer', items: [{sku:'SKU-30', scanSku:'SKU-15', quantity:2, scanQuantity:4, productName:'Test product'}] };
const previous = { id: 'OLD', platform: 'shopee', sourceAccountKey:'shop-a', items: [] };

function storage(rows, blocked = false) {
  const data = new Map([['jg-store-live-orders',JSON.stringify(rows)]]);
  return {getItem(k){if(blocked)throw Error('SecurityError');return data.get(k)||null;},
    setItem(k,v){if(blocked)throw Error('QuotaExceededError');data.set(k,v);}};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

async function startOrder() {
  let handler, finishRequest, posted;
  const state = {orders:[previous,target]};
  const popup = {location:{},closed:false,close(){this.closed=true;}};
  const localStorage = storage([],true);
  const context = vm.createContext({state, URLSearchParams, encodeURIComponent,
    window:{localStorage,sessionStorage:localStorage,open:()=>popup},
    document:{querySelector:()=>({addEventListener:(_event,fn)=>{handler=fn;}})},
    HTMLButtonElement:class {}, activeOrder:()=>target,
    normalizeSourceKey:v=>v, sourceKeyFromOrder:o=>o.sourceAccountKey,
    ordersStorageKey:'jg-store-live-orders',ordersStorageMetaKey:'meta',activeOrderStorageKey:'active',
    ordersEtag:'',bigSetEnabled:true,automaticArrangementPaused:false,writeClientCache(){},
    postOrderAction:(_action,_order,extra)=>{posted=JSON.parse(JSON.stringify(extra));return new Promise(resolve=>{finishRequest=resolve;});},
    showBoardAlert:message=>{throw Error(message);},refreshOrders:async()=>{}
  });
  const save = home.slice(home.indexOf('  const saveOrders ='),home.indexOf('  const syncOrdersFromStorage ='));
  const click = home.slice(home.indexOf("  document.querySelector('[data-next-scan]')"),home.indexOf("  document.querySelectorAll('[data-close-fulfillment-modal]')"));
  vm.runInContext(save+click,context);
  const pending = handler({currentTarget:null});
  // A refresh loses the order while begin_fulfillment is in flight.
  state.orders = [previous];
  finishRequest({ok:true,scan_handoff:'saved-token'});
  await pending;
  assert.deepEqual(posted.scan_order,target);
  assert.equal(popup.location.href,'./scan/?order=NEW&handoff=saved-token');
}

async function openScan({rows=[],blocked=false,serverOrder=target,status=200,query='?order=NEW&handoff=saved-token'}={}) {
  const nodes = new Map(), handlers = {}, requests = [], timers = [];
  const node = () => ({textContent:'',innerHTML:'',hidden:false,classList:{toggle(){}},addEventListener(){}});
  const document = {querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},addEventListener(e,f){handlers[e]=f;}};
  const localStorage=storage(rows,blocked);
  const window={localStorage,sessionStorage:localStorage,location:{search:query,hostname:'store.jenanggemi.com'},
    addEventListener(){},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},clearInterval(){},setInterval(){return 1;}};
  let clock = Date.now();
  class ScanDate extends Date { static now() { clock += 500; return clock; } }
  const context=vm.createContext({document,window,URLSearchParams,AbortSignal,console,Date:ScanDate,Error,
    navigator:{serial:{getPorts:async()=>[],addEventListener(){}}},
    fetch:async(url)=>{requests.push(url);const isHandoff=url.includes('scan_handoff=');
      const payload=isHandoff?{ok:status===200,order:serverOrder,error:'Session expired. Return to the board.'}:{ok:true,settings:{},database:{skus:[]}};
      return {ok:!isHandoff||status===200,status:isHandoff?status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)};}
  });
  vm.runInContext(handoff,context);
  vm.runInContext(scan,context);
  await handlers.DOMContentLoaded();
  await tick();
  return {nodes,handlers,window,requests,timers};
}

function updatePrintCache(rows, order) {
  const localStorage=storage(rows);
  const context=vm.createContext({order,sourceAccount:order.sourceAccountKey,
    readOrders:()=>JSON.parse(localStorage.getItem('jg-store-live-orders')),
    writeOrders:orders=>localStorage.setItem('jg-store-live-orders',JSON.stringify(orders))});
  vm.runInContext(print.slice(print.indexOf('  const normalizeSourceKey ='),print.indexOf('  const orderActionPayload ='))+
    print.slice(print.indexOf('  const updateStoredOrder ='),print.indexOf('  const markPrinted ='))+
    "\nupdateStoredOrder(o=>{o.status='FULFILLED';});",context);
  return JSON.parse(localStorage.getItem('jg-store-live-orders'));
}

async function printWithoutCachedOrder() {
  const nodes = new Map(), handlers = {}, requests = [];
  const node = () => ({textContent:'',innerHTML:'',hidden:false,events:{},querySelectorAll:()=>[],
    addEventListener(event,fn){this.events[event]=fn;},scrollIntoView(){}});
  const document = {querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},
    addEventListener(event,fn){handlers[event]=fn;}};
  const localStorage=storage([previous]);
  const window={localStorage,sessionStorage:localStorage,
    location:{search:'?order=NEW&handoff=saved-token&account=shop-a&platform=shopee'},
    addEventListener(){},setTimeout(){return 1;},clearTimeout(){},requestAnimationFrame:fn=>fn(),close(){}};
  const context=vm.createContext({window,document,URLSearchParams,AbortSignal,AbortController,Error,console,
    URL:{createObjectURL:()=> 'blob:label',revokeObjectURL(){}},
    HTMLButtonElement:class {},HTMLIFrameElement:class {},
    fetch:async(url,options={})=>{
      requests.push({url,options});
      const payload=url.includes('scan_handoff=')?{ok:true,order:target}:{ok:true};
      return {ok:true,headers:{get:()=> 'application/pdf'},json:async()=>payload,
        text:async()=>JSON.stringify(payload),blob:async()=>({})};
    }});
  vm.runInContext(handoff,context);
  vm.runInContext(print,context);
  await handlers.DOMContentLoaded();
  await tick();
  assert.equal(nodes.get('[data-print-status]').textContent,'Ready');
  const label=requests.find(r=>r.url.includes('shipping_label='));
  assert.match(label.url,/account=shop-a&package=P1/);
  await nodes.get('[data-confirm-label-printed]').events.click();
  const posted=JSON.parse(requests.find(r=>r.options.method==='POST').options.body);
  assert.equal(posted.customer_name,'Buyer');
  assert.equal(posted.items[0].sku,'SKU-30');
  assert.equal(posted.items[0].quantity,2,'Completion uses original sale quantities, not ASTRA scan quantities.');
  assert.equal(posted.source_account,'shop-a');
  assert.equal(JSON.parse(localStorage.getItem('jg-store-live-orders')).length,2);
}

(async()=>{
  await startOrder();
  await printWithoutCachedOrder();
  for (const options of [{rows:[],blocked:true},{rows:[previous]},{rows:[{...target,items:[]}]}]) {
    const result=await openScan(options);
    assert.equal(result.nodes.get('[data-scan-order-id]').textContent,'NEW');
    assert.equal(result.nodes.get('[data-scan-progress]').textContent,'0/4');
    assert.match(result.nodes.get('[data-scan-list]').innerHTML,/SKU-15/);
    assert.ok(result.requests.some(url=>url.includes('scan_handoff=saved-token')));
    // The print transition must carry the same server snapshot even if storage is blocked.
    for(let i=0;i<4;i++){
      for(const key of ['S','K','U','-','1','5','0','Enter']) result.handlers.keydown({key,preventDefault(){}});
    }
    for (const fn of result.timers.slice()) fn();
    for (const fn of result.timers.slice()) fn();
    assert.match(result.window.location.href,/print-label\/\?order=NEW.*handoff=saved-token/);
  }
  const denied=await openScan({rows:[target],status:404});
  assert.equal(denied.nodes.get('[data-scan-order-id]').textContent,'Unable to load order');
  assert.match(denied.nodes.get('[data-scan-error]').textContent,/Session expired/);
  assert.equal(denied.handlers.keydown,undefined,'Do not scan a stale cached order when handoff authorization fails.');
  const wrong=await openScan({serverOrder:previous});
  assert.match(wrong.nodes.get('[data-scan-error]').textContent,/do not match/);
  const legacy=await openScan({rows:[target],query:'?order=NEW'});
  assert.equal(legacy.nodes.get('[data-scan-progress]').textContent,'0/4');
  const updated=updatePrintCache([previous,target],previous);
  assert.deepEqual(updated.find(o=>o.id==='NEW'),target,'An older print tab must preserve newer orders.');
  assert.equal(updated.find(o=>o.id==='OLD').status,'FULFILLED');
  const otherShop={...target,sourceAccountKey:'shop-b'};
  const scoped=updatePrintCache([otherShop],target);
  assert.equal(scoped.length,2);
  assert.equal(scoped[0].status,undefined,'Same ID from another account must remain unchanged.');
  console.log('scan-handoff-test: ok (storage failures, refresh race, ASTRA quantities, print transition, expiry, identity, cache merge)');
})().catch(error=>{console.error(error);process.exitCode=1;});
