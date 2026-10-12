<?php
declare(strict_types=1);

require dirname(__DIR__) . '/website-orders-bootstrap.php';

function website_ops_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected === $actual) return;
    fwrite(STDERR, $message . PHP_EOL);
    fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
    fwrite(STDERR, 'Actual: ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

$before = jg_store_ops_website_parse_utc('2026-06-23T01:00:00.000000Z');
$after = jg_store_ops_website_parse_utc('2026-06-23T01:00:00.000001Z');
website_ops_expect(true, $after > $before, 'Store Ops must preserve the precise UTC cutover ordering.');
website_ops_expect('2026-06-23 01:00:00.000001', $after->format('Y-m-d H:i:s.u'), 'Store Ops must not truncate the executive cutover boundary.');
$missingTimestampRejected = false;
try {
    jg_store_ops_website_parse_utc('');
} catch (InvalidArgumentException) {
    $missingTimestampRejected = true;
}
website_ops_expect(true, $missingTimestampRejected, 'Store Ops must reject a missing irreversible cutover timestamp.');
$ambiguousTimestampRejected = false;
try {
    jg_store_ops_website_parse_utc('tomorrow');
} catch (InvalidArgumentException) {
    $ambiguousTimestampRejected = true;
}
website_ops_expect(true, $ambiguousTimestampRejected, 'Store Ops must reject ambiguous text as a permanent cutover timestamp.');
website_ops_expect(true, jg_store_ops_website_activation_requires_readiness(['enabled' => false]), 'The first Store Ops projection must require readiness.');
website_ops_expect(false, jg_store_ops_website_activation_requires_readiness(['enabled' => true]), 'An idempotent Store Ops projection retry must not reopen the readiness gate.');
website_ops_expect(
    true,
    jg_store_ops_website_cutover_matches('2026-06-23T01:00:00.123456Z', '2026-06-23 01:00:00.123456'),
    'Equivalent Store Ops cutover timestamps must be idempotent.'
);
website_ops_expect(
    false,
    jg_store_ops_website_cutover_matches('2026-06-23T01:00:00.123456Z', '2026-06-23T01:00:00.123457Z'),
    'Store Ops must reject a different permanent cutover timestamp.'
);
website_ops_expect(
    ['shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok'],
    jg_store_ops_big_set_sources_from_values('', 'jenang-gemi-shopee', '', 'jenang-gemi-tiktok'),
    'Store Ops must expose normalized marketplace source coverage for Big Set readiness.'
);
website_ops_expect(
    ['shopee:zero-shopee'],
    jg_store_ops_big_set_sources_from_values('shopee:zero-shopee', 'ignored', 'ignored', 'ignored'),
    'An explicit Store Ops marketplace source list must override legacy account settings.'
);
website_ops_expect(
    ['shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok'],
    jg_store_ops_normalize_marketplace_sources([
        'TIKTOK:jenang-gemi-tiktok',
        'shopee:jenang-gemi-shopee',
        'shopee:jenang-gemi-shopee',
        'zero_website',
    ]),
    'Store Ops must freeze only normalized account-level marketplace sources.'
);
website_ops_expect(
    JG_STORE_OPS_ZERO_SCOPE_AFTER,
    jg_store_ops_zero_scope_expansion(
        '2026-07-24T05:15:24.846138Z',
        JG_STORE_OPS_ZERO_SCOPE_BEFORE
    ),
    'The authorized live cutover must add both ZERO platforms to automatic Store Ops handling.'
);
website_ops_expect(
    JG_STORE_OPS_ZERO_SCOPE_BEFORE,
    jg_store_ops_zero_scope_expansion(
        '2026-07-24T05:15:24.846139Z',
        JG_STORE_OPS_ZERO_SCOPE_BEFORE
    ),
    'A different cutover timestamp must not widen the automatic Store Ops scope.'
);
website_ops_expect(
    [
        'shopee:jenang-gemi-shopee',
        'tiktok:jenang-gemi-tiktok',
        'tiktok:zfit-tiktok',
    ],
    jg_store_ops_zero_scope_expansion(
        '2026-07-24T05:15:24.846138Z',
        [
            'shopee:jenang-gemi-shopee',
            'tiktok:jenang-gemi-tiktok',
            'tiktok:zfit-tiktok',
        ]
    ),
    'The ZERO expansion must never admit or alter a scope containing ZFIT.'
);
website_ops_expect(
    ['shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok'],
    jg_store_ops_website_activation_sources(
        ['TIKTOK:jenang-gemi-tiktok', 'shopee:jenang-gemi-shopee'],
        ['shopee:zero-shopee', 'shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok']
    ),
    'Store Ops activation must freeze the requested automatic subset while leaving additional configured accounts manual.'
);
$missingActivationSourcesRejected = false;
try {
    jg_store_ops_website_activation_sources([], ['shopee:jenang-gemi-shopee']);
} catch (InvalidArgumentException) {
    $missingActivationSourcesRejected = true;
}
website_ops_expect(true, $missingActivationSourcesRejected, 'Store Ops must reject activation without a frozen source scope.');
$unconfiguredActivationSourceRejected = false;
try {
    jg_store_ops_website_activation_sources(
        ['tiktok:jenang-gemi-tiktok'],
        ['shopee:jenang-gemi-shopee']
    );
} catch (RuntimeException) {
    $unconfiguredActivationSourceRejected = true;
}
website_ops_expect(true, $unconfiguredActivationSourceRejected, 'Store Ops must reject an automatic source absent from its deployment configuration.');
$invalidActivationSourceRejected = false;
try {
    jg_store_ops_website_activation_sources(
        ['website:zero_website'],
        ['shopee:jenang-gemi-shopee']
    );
} catch (InvalidArgumentException) {
    $invalidActivationSourceRejected = true;
}
website_ops_expect(true, $invalidActivationSourceRejected, 'Store Ops must reject malformed or non-marketplace activation sources instead of silently dropping them.');
$fullAccess = jg_store_ops_big_set_api_access_response(
    ['ok' => true, 'platforms' => ['tiktok', 'shopee']],
    ['shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok']
);
website_ops_expect(true, $fullAccess['ready'], 'Store Ops readiness must prove its configured tokens work for every marketplace platform.');
$partialAccess = jg_store_ops_big_set_api_access_response(
    ['ok' => true, 'platforms' => ['shopee']],
    ['shopee:jenang-gemi-shopee', 'tiktok:jenang-gemi-tiktok']
);
website_ops_expect(false, $partialAccess['ready'], 'Missing TikTok token access must block a mixed-source Big Set activation.');
website_ops_expect(true, str_contains($partialAccess['detail'], 'tiktok'), 'Store Ops readiness must identify the inaccessible marketplace platform.');
$_ENV['JG_SHOPEE_INGEST_SETUP_TOKEN'] = 'shopee-test-token';
$_ENV['JG_TIKTOK_INGEST_SETUP_TOKEN'] = 'tiktok-test-token';
website_ops_expect('shopee-test-token', jg_store_ops_marketplace_setup_token('shopee'), 'Shopee requests must use the Shopee setup credential.');
website_ops_expect('tiktok-test-token', jg_store_ops_marketplace_setup_token('tiktok'), 'TikTok requests must use the TikTok setup credential when configured.');
website_ops_expect(['zero_website', 'jenang_gemi_website', 'whatsapp'], JG_STORE_OPS_WEBSITE_PLATFORMS, 'Store Ops must accept both website sources and Executive WhatsApp orders.');
website_ops_expect(true, jg_store_ops_fulfillment_is_terminal_status('CANCELLED'), 'A cancelled WhatsApp order must be terminal in Store Ops.');
website_ops_expect(true, jg_store_ops_fulfillment_is_terminal_status('FULFILLED'), 'A fulfilled order must remain terminal in Store Ops.');
website_ops_expect(false, jg_store_ops_fulfillment_is_terminal_status('UNCLAIMED'), 'An unclaimed order must remain available to work.');
$unclaimedCompletionRejected = false;
try {
    jg_store_ops_fulfillment_assert_can_work(['status' => 'UNCLAIMED', 'claimed_by' => ''], 'shared-admin');
} catch (RuntimeException $error) {
    $unclaimedCompletionRejected = str_contains($error->getMessage(), 'Claim this order');
}
website_ops_expect(true, $unclaimedCompletionRejected, 'A durable completion retry must not fulfill an unclaimed order, even for an admin profile.');
$websiteApi = (string) file_get_contents(dirname(__DIR__) . '/api/website-orders/index.php');
website_ops_expect(
    true,
    str_contains($websiteApi, "\$action === 'cancel'")
        && str_contains($websiteApi, 'jg_store_ops_whatsapp_cancel_unclaimed')
        && str_contains($websiteApi, "\$action === 'whatsapp_status'")
        && str_contains($websiteApi, 'jg_store_ops_whatsapp_cancellation_state')
        && str_contains($websiteApi, "\$action === 'whatsapp_statuses'")
        && str_contains($websiteApi, 'jg_store_ops_whatsapp_lifecycle_states'),
    'The authenticated website-order API must expose atomic WhatsApp cancellation and batched lifecycle reads.'
);
$websiteBootstrapSource = (string) file_get_contents(dirname(__DIR__) . '/website-orders-bootstrap.php');
website_ops_expect(
    true,
    str_contains($websiteBootstrapSource, 'function jg_store_ops_whatsapp_lifecycle_states')
        && str_contains($websiteBootstrapSource, 'count($normalized) >= 100')
        && str_contains($websiteBootstrapSource, 'jg_store_ops_whatsapp_cancellation_state($pdo, $orderId)'),
    'Batched WhatsApp lifecycle reads must be bounded and reuse the authoritative single-order state.'
);
$localStatusPosition = strpos($websiteBootstrapSource, "UPDATE store_ops_website_orders SET status = :status");
$remoteCallbackPosition = strpos($websiteBootstrapSource, "jg_store_ops_website_request('POST', \$base . \$callbackPath");
website_ops_expect(
    true,
    $localStatusPosition !== false
        && $remoteCallbackPosition !== false
        && $localStatusPosition < $remoteCallbackPosition,
    'Website completion must become durable in Store Ops before its retryable upstream callback.'
);
foreach (['api/orders/index.php', 'api/orders-v2/index.php'] as $ordersEndpoint) {
    $ordersSource = (string) file_get_contents(dirname(__DIR__) . '/' . $ordersEndpoint);
    website_ops_expect(
        true,
        preg_match('/action === \'claim_order\'[\s\S]*?source_platform\'] === \'whatsapp\'[\s\S]*?IS_BEING_FULFILLED[\s\S]*?jg_store_ops_orders_fulfillment_response/', $ordersSource) === 1,
        $ordersEndpoint . ' must report a WhatsApp claim as Processing before responding.'
    );
    website_ops_expect(
        true,
        str_contains($ordersSource, "if (\$action === 'fulfill_order')")
            && str_contains($ordersSource, 'jg_store_ops_website_callback')
            && !str_contains($ordersSource, 'Website order fulfilled callback failed'),
        $ordersEndpoint . ' must retain the browser completion retry until the upstream website callback succeeds.'
    );
}
$fulfillmentRuntime = (string) file_get_contents(dirname(__DIR__) . '/store-ops-fulfillment-runtime.php');
website_ops_expect(
    true,
    str_contains($fulfillmentRuntime, "['FULFILLED', 'CANCELLED']")
        && str_contains($fulfillmentRuntime, 'was cancelled before it could be claimed'),
    'A stale Store Ops client must not claim an order after Executive cancellation.'
);
website_ops_expect(
    hash_hmac('sha256', 'jenang-gemi-website-orders-v1', 'shared-seed'),
    jg_store_ops_website_derive_token('shared-seed'),
    'The deployed Executive Dashboard token fallback must be deterministic.'
);
website_ops_expect('', jg_store_ops_website_derive_token(''), 'An empty shared seed must not create a bearer token.');
website_ops_expect(
    ['010101000001' => 3, '020202000002' => 1],
    jg_store_ops_website_stock_lines(['items' => [
        ['sku' => '010101000001', 'quantity' => 1],
        ['sku' => '020202000002', 'quantity' => 1],
        ['sku' => '010101000001', 'quantity' => 2],
    ]]),
    'WhatsApp stock deduction must aggregate duplicate SKU quantities deterministically.'
);
$invalidStockLineRejected = false;
try {
    jg_store_ops_website_stock_lines(['items' => [['sku' => '010101000001', 'quantity' => 0]]]);
} catch (InvalidArgumentException) {
    $invalidStockLineRejected = true;
}
website_ops_expect(true, $invalidStockLineRejected, 'WhatsApp stock deduction must reject invalid quantities.');

echo "website-orders-test: ok\n";

foreach (['IS_LISTED', 'IS_BEING_FULFILLED'] as $sourceStatus) {
    $state = jg_store_ops_whatsapp_cancellation_state_from_order('released-direct', $sourceStatus, ['status' => 'UNCLAIMED', 'claimed_by' => null]);
    website_ops_expect(true, $state['can_cancel'], 'An unclaimed direct order can be cancelled even after its source entered processing.');
    website_ops_expect('IS_LISTED', $state['display_status'], 'A released order must no longer display as processing.');
    foreach ([['status' => 'CLAIMED', 'claimed_by' => 'employee'], ['status' => 'UNCLAIMED', 'claimed_by' => 'employee'], ['status' => 'FULFILLED'], ['status' => 'CANCELLED']] as $fulfillment) {
        $state = jg_store_ops_whatsapp_cancellation_state_from_order('protected-direct', $sourceStatus, $fulfillment);
        website_ops_expect(false, $state['can_cancel'], 'Claimed and terminal orders must remain protected from cancellation.');
    }
}
foreach (['FULFILLED', 'REMOVED', 'CANCELLED'] as $sourceStatus) {
    $state = jg_store_ops_whatsapp_cancellation_state_from_order('terminal-direct', $sourceStatus, ['status' => 'UNCLAIMED']);
    website_ops_expect(false, $state['can_cancel'], 'Terminal source orders must not become cancellable.');
}

$queueable = jg_store_ops_whatsapp_cancellation_state_from_order('queue-direct', 'IS_LISTED', ['status' => 'UNCLAIMED', 'claimed_by' => null, 'label_printed_at' => null]);
website_ops_expect(true, $queueable['can_queue'], 'An unclaimed, unprinted direct order can be moved back to the Executive queue.');
$printed = jg_store_ops_whatsapp_cancellation_state_from_order('queue-direct', 'IS_LISTED', ['status' => 'UNCLAIMED', 'claimed_by' => null, 'label_printed_at' => '2026-10-12 03:00:00']);
website_ops_expect(false, $printed['can_queue'], 'A released order whose label was printed must stay in Store Ops.');
website_ops_expect(true, $printed['can_cancel'], 'Printing must not change the existing cancellation rule.');
$claimedQueue = jg_store_ops_whatsapp_cancellation_state_from_order('queue-direct', 'IS_LISTED', ['status' => 'CLAIMED', 'claimed_by' => 'employee']);
website_ops_expect(false, $claimedQueue['can_queue'], 'A claimed direct order must not be moved back to the Executive queue.');
$queuedState = jg_store_ops_whatsapp_cancellation_state_from_order('queue-direct', 'QUEUED', ['status' => 'UNCLAIMED', 'claimed_by' => null]);
website_ops_expect('QUEUED', $queuedState['display_status'], 'A recalled direct order must report as queued.');
website_ops_expect(false, $queuedState['can_cancel'] || $queuedState['can_queue'], 'A recalled direct order is no longer active in Store Ops.');
website_ops_expect(
    true,
    str_contains($websiteApi, "\$action === 'recall'")
        && str_contains($websiteApi, 'jg_store_ops_whatsapp_recall_unclaimed')
        && str_contains($websiteBootstrapSource, 'status = IF(status = "QUEUED", "IS_LISTED", status)'),
    'The website-order API must recall untouched WhatsApp orders and list them again when re-sent.'
);
foreach (['store-ops-fulfillment.php', 'store-ops-fulfillment-runtime.php'] as $fulfillmentFile) {
    website_ops_expect(
        true,
        str_contains((string) file_get_contents(dirname(__DIR__) . '/' . $fulfillmentFile), 'moved back to the Executive queue'),
        $fulfillmentFile . ' must stop a stale Store Ops client from claiming a recalled order.'
    );
}

if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    // The runtime SQL is MySQL; translate only its locking and upsert syntax.
    $queuePdo = new class('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]) extends PDO {
        public function prepare(string $query, array $options = []): PDOStatement|false
        {
            $query = str_replace(' FOR UPDATE', '', $query);
            if (str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
                $query = 'INSERT OR IGNORE' . substr($query, strlen('INSERT'), strpos($query, 'ON DUPLICATE KEY UPDATE') - strlen('INSERT'));
            }
            return parent::prepare($query, $options);
        }
    };
    $queuePdo->exec('CREATE TABLE store_ops_website_orders (id INTEGER PRIMARY KEY, source_platform TEXT, order_id TEXT, payload_json TEXT, status TEXT, updated_at TEXT)');
    $queuePdo->exec('CREATE TABLE store_ops_order_fulfillment_v2 (id INTEGER PRIMARY KEY, source_platform TEXT, source_account TEXT, order_id TEXT, status TEXT, claimed_by TEXT, claimed_at TEXT, last_activity_at TEXT, label_printed_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE (source_platform, source_account, order_id))');
    $queuePdo->exec('CREATE TABLE store_ops_order_events_v2 (id INTEGER PRIMARY KEY, source_platform TEXT, source_account TEXT, order_id TEXT, event_type TEXT, employee_id TEXT, employee_name TEXT, sku TEXT, quantity REAL, progress_scanned INTEGER, progress_required INTEGER, message TEXT, payload_json TEXT, created_at TEXT)');
    $seedOrder = static function (string $orderId, string $status, ?string $claimedBy, ?string $printedAt) use ($queuePdo): void {
        $queuePdo->prepare('INSERT INTO store_ops_website_orders (source_platform, order_id, payload_json, status, updated_at) VALUES ("whatsapp", ?, "{}", "IS_LISTED", "")')->execute([$orderId]);
        $queuePdo->prepare('INSERT INTO store_ops_order_fulfillment_v2 (source_platform, source_account, order_id, status, claimed_by, label_printed_at, created_at, updated_at) VALUES ("whatsapp", "whatsapp", ?, ?, ?, ?, "", "")')->execute([$orderId, $status, $claimedBy, $printedAt]);
    };
    $sourceStatus = static fn (string $orderId): string => (string) $queuePdo->query('SELECT status FROM store_ops_website_orders WHERE order_id = ' . $queuePdo->quote($orderId))->fetchColumn();
    $seedOrder('WAEXEC-FREE', 'UNCLAIMED', null, null);
    $seedOrder('WAEXEC-CLAIMED', 'CLAIMED', 'employee', null);
    $seedOrder('WAEXEC-PRINTED', 'UNCLAIMED', null, '2026-10-12 03:00:00');

    website_ops_expect('QUEUED', jg_store_ops_whatsapp_recall_unclaimed($queuePdo, 'WAEXEC-FREE')['status'], 'Recalling an untouched order must confirm the queued state.');
    website_ops_expect('QUEUED', $sourceStatus('WAEXEC-FREE'), 'A recalled order must leave the Store Ops Listed board.');
    website_ops_expect('QUEUED', jg_store_ops_whatsapp_recall_unclaimed($queuePdo, 'WAEXEC-FREE')['status'], 'Recalling twice must be idempotent.');
    website_ops_expect(1, (int) $queuePdo->query('SELECT COUNT(*) FROM store_ops_order_events_v2 WHERE event_type = "recall_to_queue"')->fetchColumn(), 'A recall must be audited exactly once.');
    $staleClaimRejected = false;
    try {
        jg_store_ops_fulfillment_claim($queuePdo, ['source_platform' => 'whatsapp', 'source_account' => 'whatsapp', 'order_id' => 'WAEXEC-FREE'], 'employee', 'Employee');
    } catch (RuntimeException $error) {
        $staleClaimRejected = str_contains($error->getMessage(), 'Executive queue');
    }
    website_ops_expect(true, $staleClaimRejected, 'A stale board must not claim a recalled order.');
    foreach (['WAEXEC-CLAIMED' => 'claimed', 'WAEXEC-PRINTED' => 'printed', 'WAEXEC-MISSING' => 'missing'] as $protectedOrder => $reason) {
        $rejected = false;
        try {
            jg_store_ops_whatsapp_recall_unclaimed($queuePdo, $protectedOrder);
        } catch (RuntimeException $error) {
            $rejected = str_contains($error->getMessage(), $reason);
        }
        website_ops_expect(true, $rejected, 'Recall must be refused for a ' . $reason . ' order.');
    }
    website_ops_expect('IS_LISTED', $sourceStatus('WAEXEC-PRINTED'), 'A refused recall must leave the order listed.');
    echo "website-orders-queue-test: ok\n";
}
