<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/store-ops-fulfillment-runtime.php';
require_once dirname(__DIR__) . '/scan-handoff.php';

function expect_handoff(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$order = ['id' => 'ORDER-1', 'platform' => 'shopee', 'sourceAccountKey' => 'shop-a',
    'packageNumber' => 'PACKAGE-1', 'customerName' => 'Buyer',
    'items' => [['sku' => 'BUBUR-30', 'scanSku' => 'BUBUR-15', 'quantity' => 2,
        'scanQuantity' => 4, 'skipScan' => false, 'sourceSkus' => ['BUBUR-30']]]];
$key = jg_store_ops_fulfillment_key_from_payload(['order_id' => 'ORDER-1',
    'source_platform' => 'shopee', 'source_account' => 'shop-a', 'package_id' => 'PACKAGE-1']);
$_SESSION = [];
$prepared = jg_store_ops_scan_handoff_prepare($order, $key);
$token = jg_store_ops_scan_handoff_save($prepared, $key, 'packer-a');
$entry = jg_store_ops_scan_handoff_read($token, 'ORDER-1', 'packer-a');
expect_handoff($entry['order'] === $order, 'Handoff must preserve exact ASTRA quantities, customer and package.');
expect_handoff(jg_store_ops_scan_handoff_save($prepared, $key, 'packer-a') === $token, 'Retry must preserve existing scan URLs.');
expect_handoff(jg_store_ops_scan_handoff_read($token, 'ORDER-1', 'packer-b') === null, 'Another employee must not read this handoff.');
expect_handoff(jg_store_ops_scan_handoff_read($token, 'ORDER-2', 'packer-a') === null, 'URL order must match the saved order.');
foreach (['id' => 'ORDER-2', 'platform' => 'tiktok', 'sourceAccountKey' => 'shop-b', 'items' => []] as $field => $value) {
    $rejected = false;
    try { jg_store_ops_scan_handoff_prepare(array_replace($order, [$field => $value]), $key); }
    catch (InvalidArgumentException) { $rejected = true; }
    expect_handoff($rejected, 'Reject mismatched or missing ' . $field);
}
$_SESSION['jg_scan_handoffs'][$token]['expires_at'] = time() - 1;
expect_handoff(jg_store_ops_scan_handoff_read($token, 'ORDER-1', 'packer-a') === null, 'Expired handoffs must not be served.');
for ($i = 0; $i < 40; $i++) {
    $nextKey = array_replace($key, ['order_id' => 'ORDER-' . $i]);
    jg_store_ops_scan_handoff_save(array_replace($order, ['id' => 'ORDER-' . $i]), $nextKey, 'packer-a');
}
expect_handoff(count($_SESSION['jg_scan_handoffs']) === 32, 'Session snapshots must be bounded.');
expect_handoff(!isset($_SESSION['jg_scan_handoffs'][$token]), 'Expired snapshots must be pruned.');
echo "scan-handoff-test: ok\n";
