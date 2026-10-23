global.window = global;
global.document = { addEventListener() {} };

const fs = require('node:fs');
const path = require('node:path');

require('../store-home.js');

const assert = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const presentation = global.JGStoreOrderPresentation;
assert(presentation && typeof presentation.isDropOff === 'function', 'Store Ops must expose its production handover normalizer.');

assert(
  presentation.normalizeHandoverMethod({ handoverMethod: 'DROP_OFF' }) === 'DROP_OFF',
  'Store Ops must preserve the API drop-off method.'
);
assert(
  presentation.normalizeHandoverMethod({ handover_method: 'drop-off' }) === 'DROP_OFF',
  'Store Ops must normalize legacy drop-off spelling.'
);
assert(
  presentation.isDropOff({ handoverMethod: 'DROP_OFF' }),
  'A recorded drop-off order must receive the visual treatment.'
);
assert(
  !presentation.isDropOff({ handoverMethod: 'PICKUP' }),
  'Pickup orders must not receive the drop-off visual treatment.'
);
assert(
  !presentation.isDropOff({}),
  'Orders without a recorded handover decision must not be guessed as drop-off.'
);
assert(
  presentation.isCancellationRequested({ marketplaceStatus: 'IN_CANCEL' }),
  'Shopee IN_CANCEL orders must receive the cancellation hold.'
);
assert(
  typeof presentation.isCompletedMarketplaceOrder === 'undefined',
  'Browser presentation must never treat marketplace shipment status as Store Ops completion.'
);
assert(
  presentation.requiresManualInstantArrangement({ instant: true, manualArrangementRequired: true }),
  'Instant orders must expose their manual arrangement action.'
);
assert(
  presentation.canCurrentEmployeeUnclaim({ claimedBy: 'operator-1', fulfillmentStatus: 'CLAIMED' }, 'operator-1'),
  'The profile that owns a live claim must be allowed to unclaim it.'
);
assert(
  !presentation.canCurrentEmployeeUnclaim({ claimedBy: 'operator-2', fulfillmentStatus: 'CLAIMED' }, 'operator-1'),
  'A different profile must not be offered the unclaim action.'
);
assert(
  !presentation.canCurrentEmployeeUnclaim({ claimedBy: 'operator-1', fulfillmentStatus: 'FULFILLED' }, 'operator-1'),
  'A fulfilled order must never be reopened by the unclaim action.'
);
assert(
  presentation.requiresManualInstantArrangement({ instant: true, shipmentArranged: false, labelBacked: false }),
  'Instant orders must retain the manual arrangement action when lifecycle flags are absent.'
);
assert(
  !presentation.requiresManualInstantArrangement({ instant: true, shipmentArranged: true, labelBacked: true }),
  'Instant orders that already have an arranged label must proceed to Store Ops processing.'
);
assert(
  presentation.isInstantManualLifecycle({ instant: true, instantArrangementState: 'label_pending' }),
  'An Instant card must stay visible while its label is prepared.'
);
assert(
  presentation.isInstantManualLifecycle({ instant: true, shipmentArranged: true, instantArrangementState: 'display_only' }),
  'An Instant row from the temporary display-only contract must migrate back to its manual action.'
);
assert(
  presentation.formatHandoverSlot({ handoverSlotLabel: 'Sat, 1 Aug 2026 · 13:00-15:00' }) === 'Sat, 1 Aug 2026 · 13:00-15:00',
  'Store Ops must preserve the marketplace-selected pickup day.'
);

const listedOrders = [
  { id: 'DROP', handoverMethod: 'DROP_OFF' },
  { id: 'PICKUP', handoverMethod: 'PICKUP' },
  { id: 'UNKNOWN' }
];
assert(
  presentation.filterOrdersByHandover(listedOrders, false).length === 3,
  'The safe default must keep every listed order visible.'
);
const dropOffOnly = presentation.filterOrdersByHandover(listedOrders, true);
assert(
  dropOffOnly.length === 1 && dropOffOnly[0].id === 'DROP',
  'The optional filter must show only orders explicitly recorded as drop-off.'
);
assert(
  listedOrders.length === 3,
  'Filtering the board must not mutate or remove orders from IS_LISTED.'
);
assert(
  presentation.shouldShowOrderLoading(false, []),
  'Store Ops must show loading until the first order snapshot confirms whether the queue is empty.'
);
assert(
  !presentation.shouldShowOrderLoading(true, []),
  'A confirmed zero-order snapshot must show the real empty state instead of loading forever.'
);
assert(
  presentation.shouldShowOrderLoading(false, listedOrders),
  'Cached orders must stay hidden until the first live refresh resolves.'
);
const dashboardTemplate = fs.readFileSync(path.join(__dirname, '../dashboard/index.php'), 'utf8');
const storeHome = fs.readFileSync(path.join(__dirname, '../store-home.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(__dirname, '../admin.css'), 'utf8');
const ordersApi = fs.readFileSync(path.join(__dirname, '../api/orders/index.php'), 'utf8');
const ordersV2Api = fs.readFileSync(path.join(__dirname, '../api/orders-v2/index.php'), 'utf8');
const fulfillmentRuntime = fs.readFileSync(path.join(__dirname, '../store-ops-fulfillment-runtime.php'), 'utf8');
assert(
  dashboardTemplate.includes('data-order-board aria-busy="true"')
    && dashboardTemplate.includes('admin-board-empty admin-board-loading'),
  'The server-rendered queue must show loading before Store Ops JavaScript starts.'
);
assert(
  fulfillmentRuntime.includes("$key['order_id'] === '260807QAWE3UNJ'")
    && fulfillmentRuntime.includes("status = \"UNCLAIMED\"")
    && fulfillmentRuntime.includes("throw new RuntimeException('Claim this order before working on it.')"),
  'The exact recovery must clear its stale completion, while future durable completions require a real Start claim.'
);
assert(
  dashboardTemplate.includes('data-automation-pause-notice')
    && dashboardTemplate.includes('data-automation-pause-copy'),
  'The queue must explain the global pause once instead of repeating a warning on every order.'
);
assert(
  dashboardTemplate.includes('data-order-context-menu')
    && dashboardTemplate.includes('data-unclaim-order')
    && storeHome.includes("addEventListener('contextmenu'")
    && storeHome.includes("postOrderAction('release_order', order)"),
  'A profile must be able to right-click its claimed card and release it through the existing API.'
);
assert(
  storeHome.includes('data-arrange-instant') && storeHome.includes('Accept + arrange'),
  'The Instant card must provide one combined acceptance and arrangement button.'
);
assert(
  !storeHome.includes('isCompletedMarketplaceOrder'),
  'Arranged or shipped orders must stay in Listed until Store Ops records FULFILLED.'
);
assert(
  !storeHome.includes('class="admin-order-products"')
    && storeHome.includes('Arrange in marketplace')
    && !storeHome.includes('This order is visible for tracking'),
  'Compact cards must leave product details in the order preview and use a short arrangement action.'
);
assert(
  adminCss.includes('repeat(var(--order-columns, 1), minmax(0, 1fr))')
    && adminCss.includes('grid-template-rows: repeat(var(--order-rows, 6), minmax(88px, auto))')
    && adminCss.includes('grid-auto-flow: column')
    && adminCss.includes('overflow-x: hidden')
    && storeHome.includes("board.style.setProperty('--order-rows'")
    && adminCss.includes('.is-store-home .admin-store-home .admin-order-board'),
  'The operational queue must fill urgency down columns and add rows instead of horizontal overflow.'
);
assert(
  storeHome.includes("!order.instant ? 'is-deadline-urgent' : ''")
    && !storeHome.includes("!isLocked ? 'is-critical' : ''"),
  'Non-Instant urgent orders must use the amber deadline cue; red is reserved for Instant orders.'
);
assert(
  storeHome.includes('Handle in ${escapeHtml(marketplaceName)}') && storeHome.includes('do not process'),
  'Cancellation-requested cards must visibly direct staff to Shopee and block processing.'
);
assert(
  adminCss.includes('align-items: start')
    && adminCss.includes('.is-store-home .admin-store-home .admin-manual-order-btn'),
  'A taller exception card must not stretch the other compact cards in its grid row.'
);
assert(
  adminCss.includes('.admin-order-card.is-instant') && adminCss.includes('@keyframes admin-instant-pulse'),
  'Instant cards must always receive their red pulse treatment.'
);
assert(
  adminCss.includes(":root[data-admin-theme='light'] .admin-order-card.is-instant")
    && adminCss.includes('--instant-pulse-alert-bg: #fee2e2'),
  'Light mode must use a readable light-red Instant pulse instead of the dark-theme maroon frame.'
);
assert(
  storeHome.includes("Number(Boolean(b?.instant)) - Number(Boolean(a?.instant))")
    && storeHome.includes("Number(Boolean(b?.weekendDependent)) - Number(Boolean(a?.weekendDependent))")
    && storeHome.includes('Weekend Dependent')
    && storeHome.includes('data-arrange-shopee')
    && storeHome.includes("postOrderAction('get_shopee_arrangement_options', order)")
    && storeHome.includes("postOrderAction('arrange_shopee_shipment', order, selection)")
    && storeHome.includes('shopeeManualRequired')
    && storeHome.includes('manualArrangementNeeded')
    && storeHome.includes("shopeeState === 'automatic' && !automaticArrangementPaused")
    && storeHome.includes('const shopeeDelayed = Boolean(order.deadlineDelayed)')
    && storeHome.includes('shopeeManualRequired && !shopeeDelayed')
    && storeHome.includes('|| shopeeDelayed')
    && storeHome.includes("shopeeDelayed ? 'is-delayed' : ''")
    && storeHome.includes('Shopee has delayed this order and has not released shipping options yet.')
    && storeHome.includes('Auto-arranging…')
    && storeHome.includes('Manual arrange')
    && storeHome.includes('Retry label')
    && !storeHome.includes("shopeeState === 'failed' ? 'Retry arrange'")
    && storeHome.includes("const arrangementIssue = order.instant && String(order.instantArrangementError || '').trim()")
    && storeHome.includes("order.weekendDependentCutoff || '12:00'")
    && storeHome.includes("isWeekendDependent ? 'is-weekend-dependent' : ''"),
  'Instant orders must sort first, while delayed Shopee fallbacks stay disabled until a real deadline makes them actionable.'
);
assert(
  !storeHome.includes('admin-instant-action-error')
    && !storeHome.includes('admin-shopee-action-error')
    && storeHome.includes('admin-preview-arrangement-issue')
    && adminCss.includes('.admin-preview-facts > .admin-preview-arrangement-issue'),
  'Arrangement errors must stay off compact cards and appear only after an operator opens the order preview.'
);
assert(
  ordersApi.includes("'/fulfillment/arrange-shopee'")
    && ordersV2Api.includes("'/fulfillment/arrange-shopee'")
    && ordersApi.includes("'/fulfillment/shipping-options?'")
    && ordersV2Api.includes("'/fulfillment/shipping-options?'")
    && ordersApi.includes("'arrange_shopee_shipment'")
    && ordersV2Api.includes("'arrange_shopee_shipment'")
    && ordersApi.includes("'handover_method'")
    && ordersV2Api.includes("'pickup_time_id'"),
  'Both Store Ops order APIs must load live Shopee choices and submit the selected handover method and pickup time.'
);
assert(
  dashboardTemplate.includes('data-shopee-arrangement-modal')
    && dashboardTemplate.includes('data-shopee-arrangement-options')
    && dashboardTemplate.includes('admin-shopee-arrangement-hero-icon')
    && storeHome.includes('openShopeeArrangementModal(shopeeButton.dataset.arrangeShopee')
    && storeHome.includes('data-handover-method="PICKUP"')
    && storeHome.includes('data-handover-method="DROP_OFF"')
    && storeHome.includes('admin-shopee-option-icon is-pickup')
    && storeHome.includes('admin-shopee-option-icon is-dropoff')
    && adminCss.includes('.admin-shopee-option-check')
    && storeHome.includes('clearPendingCompletionForOrder(order)')
    && storeHome.includes('authorizedRecoveryReopenedAt')
    && storeHome.includes('shopee_manual_required: Boolean(order?.shopeeManualRequired)')
    && !storeHome.includes('showBoardAlert(order.shopeeArrangementError)'),
  'Manual arrange must open a visual live pickup/drop-off chooser, preserve authorization, and keep errors inside the modal.'
);
assert(
  adminCss.includes('.admin-order-card.is-weekend-dependent')
    && adminCss.includes('.admin-order-card.is-manual-arrangement')
    && adminCss.includes('.admin-order-card.is-delayed')
    && adminCss.includes('animation: none')
    && adminCss.includes('@keyframes admin-manual-arrangement-pulse')
    && adminCss.includes('.admin-manual-order-btn.is-shopee-action.is-manual-needed:not(:disabled)')
    && storeHome.includes("manualArrangementVisual ? 'is-manual-arrangement' : ''"),
  'Only manual Shopee work must pulse cyan; Weekend Dependent status alone remains an amber badge and border.'
);
assert(
  storeHome.includes("get('shipping-ux-demo') === '1'")
    && storeHome.includes("shopeeArrangementOrder.textContent = '260812SAMPLE'")
    && storeHome.includes('Demo only—no order or shipment was changed.')
    && adminCss.includes('.admin-shopee-demo-success'),
  'The shipping UX demo must use sample choices, clearly identify itself, and stop before any order API action.'
);
assert(
  dashboardTemplate.includes('admin-shopee-close-btn')
    && dashboardTemplate.includes('admin-shopee-intro-icon')
    && dashboardTemplate.includes('admin-shopee-secure-note')
    && dashboardTemplate.includes('admin-shopee-arrangement-submit')
    && storeHome.includes('admin-shopee-option-meta')
    && storeHome.includes('No pickup window required')
    && adminCss.includes('.admin-shopee-arrangement-card {\n  display: grid;')
    && adminCss.includes('.admin-shopee-arrangement-actions'),
  'The arrangement modal must use polished icon-led controls, intentional spacing, and a stable grid layout.'
);

console.log('store-order-handover-test: ok');
