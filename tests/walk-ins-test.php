<?php
declare(strict_types=1);

require dirname(__DIR__) . '/walk-ins-bootstrap.php';

function walkins_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected === $actual) return;
    fwrite(STDERR, $message . PHP_EOL);
    fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
    fwrite(STDERR, 'Actual: ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

walkins_expect('walk_in', jg_store_ops_walkins_normalize_invoice_type('walk-in'), 'Walk-in aliases should normalize.');
walkins_expect('whatsapp', jg_store_ops_walkins_normalize_invoice_type('WA'), 'WA aliases should normalize.');
walkins_expect('WI', substr(jg_store_ops_walkins_invoice_number('walk_in'), 0, 2), 'Walk-in invoices should use WI.');
walkins_expect('WA', substr(jg_store_ops_walkins_invoice_number('whatsapp'), 0, 2), 'WhatsApp invoices should use WA.');
walkins_expect('Walk In', jg_store_ops_walkins_invoice_label('walk_in', 'Walk In'), 'Walk-in labels should print correctly.');
walkins_expect('Whatsapp', jg_store_ops_walkins_invoice_label('whatsapp', 'Whatsapp'), 'Direct WhatsApp labels should print correctly.');
walkins_expect('Whatsapp (from site)', jg_store_ops_walkins_invoice_label('whatsapp', 'Website'), 'Website WhatsApp labels should print correctly.');
walkins_expect('Whatsapp (from partner)', jg_store_ops_walkins_invoice_label('whatsapp', 'Partner'), 'Partner WhatsApp labels should print correctly.');
walkins_expect(true, jg_store_ops_walkins_analytics_included(['invoice_type' => 'walk_in', 'sale_type' => 'Walk In', 'analytics_visible' => 1]), 'Visible walk-in invoices should count.');
walkins_expect(true, jg_store_ops_walkins_analytics_included(['invoice_type' => 'whatsapp', 'sale_type' => 'Whatsapp', 'analytics_visible' => 1]), 'Direct WhatsApp invoices should count.');
walkins_expect(false, jg_store_ops_walkins_analytics_included(['invoice_type' => 'whatsapp', 'sale_type' => 'Website', 'analytics_visible' => 1]), 'Website WhatsApp invoices should not double count.');
walkins_expect(false, jg_store_ops_walkins_analytics_included(['invoice_type' => 'walk_in', 'sale_type' => 'Walk In', 'analytics_visible' => 0]), 'Hidden invoices should not count.');
walkins_expect('Whatsapp', jg_store_ops_walkins_normalize_sale_type('whatsapp', ''), 'WhatsApp sales should no longer require a sale type.');
walkins_expect('Whatsapp', jg_store_ops_walkins_normalize_sale_type('whatsapp', 'Partner'), 'WhatsApp sales should always be direct WhatsApp sales.');
walkins_expect('0.00', jg_store_ops_walkins_shipping_cost('whatsapp', ['shipping_cost' => 0]), 'Zero shipping must be accepted.');
walkins_expect('25000.00', jg_store_ops_walkins_shipping_cost('whatsapp', ['shipping_cost' => 25000]), 'Shipping cost should normalize as money.');
walkins_expect('0.00', jg_store_ops_walkins_shipping_cost('walk_in', []), 'Walk-in sales should not require shipping cost.');
$percentageDiscount = jg_store_ops_walkins_order_discount(['discount' => ['type' => 'percentage', 'value' => 15]], 100000);
walkins_expect(15000.0, $percentageDiscount['total'], 'Percentage discounts must apply to merchandise.');
$salePriceDiscount = jg_store_ops_walkins_order_discount(['discount' => ['type' => 'sale_price', 'value' => 70000]], 100000);
walkins_expect(30000.0, $salePriceDiscount['total'], 'Sale-price discounts must set the final merchandise price.');
// Per-SKU discount rate validation.
walkins_expect(
    10.0,
    jg_store_ops_walkins_discount_rate(10),
    'SKU discount of 10% should be accepted.'
);

walkins_expect(
    25.5,
    jg_store_ops_walkins_discount_rate(25.5),
    'SKU discount of 25.5% should be accepted.'
);

walkins_expect(
    0.0,
    jg_store_ops_walkins_discount_rate(0),
    'SKU discount of 0% should be accepted.'
);

walkins_expect(
    100.0,
    jg_store_ops_walkins_discount_rate(100),
    'SKU discount of 100% should be accepted.'
);
try {
    jg_store_ops_walkins_shipping_cost('whatsapp', []);
    fwrite(STDERR, 'Missing WhatsApp shipping cost should fail.' . PHP_EOL);
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}

try {
    jg_store_ops_walkins_order_discount(['discount' => ['type' => 'percentage', 'value' => 101]], 100000);
    fwrite(STDERR, 'Discounts above 100 percent should fail.' . PHP_EOL);
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}

try {
    jg_store_ops_walkins_shipping_cost('whatsapp', ['shipping_cost' => -1]);
    fwrite(STDERR, 'Negative WhatsApp shipping cost should fail.' . PHP_EOL);
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}

jg_store_ops_walkins_reject_order_discount(['discount' => null]);
jg_store_ops_walkins_reject_order_discount([]);
try {
    jg_store_ops_walkins_reject_order_discount(['discount' => ['type' => 'percentage', 'value' => 10]]);
    fwrite(STDERR, 'Order discounts from a stale page must be rejected, not silently dropped.' . PHP_EOL);
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}
// Test two SKUs with different discounts.
$skuA = [
    'price' => 100000.0,
    'qty' => 1,
    'discount_rate' => 10,
];

$skuB = [
    'price' => 50000.0,
    'qty' => 1,
    'discount_rate' => 20,
];

$subtotal = 0.0;
$discountTotal = 0.0;

foreach ([$skuA, $skuB] as $item) {
    $gross = round($item['price'] * $item['qty'], 2);
    $rate = jg_store_ops_walkins_discount_rate($item['discount_rate']);
    $lineDiscount = round($gross * ($rate / 100), 2);

    $subtotal += $gross;
    $discountTotal += $lineDiscount;
}

$total = round($subtotal - $discountTotal, 2);

walkins_expect(150000.0, $subtotal, 'Two SKU subtotal should be correct.');
walkins_expect(20000.0, $discountTotal, 'Two SKU discounts should total Rp20,000.');
walkins_expect(130000.0, $total, 'Two SKU final total should be Rp130,000.');
echo "walk-ins-test: ok\n";
