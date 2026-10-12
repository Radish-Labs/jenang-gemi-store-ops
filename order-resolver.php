<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/partner-orders-bootstrap.php';
require_once __DIR__ . '/website-orders-bootstrap.php';

const JG_STORE_OPS_ORDER_RESOLVER_WEBSITE_PLATFORMS = ['zero_website', 'jenang_gemi_website', 'whatsapp'];

function jg_store_ops_order_resolver_config(string $envKey, string $configKey, string $default = ''): string
{
    $envValue = jg_store_ops_env_value($envKey);
    if ($envValue !== '') {
        return $envValue;
    }

    $config = jg_store_ops_load_local_config();
    $value = $config[$configKey] ?? null;
    return is_string($value) && trim($value) !== '' ? trim($value) : $default;
}

function jg_store_ops_order_resolver_store_db(): ?PDO
{
    static $pdo = false;

    if ($pdo instanceof PDO) {
        return $pdo;
    }
    if ($pdo === null) {
        return null;
    }

    $host = jg_store_ops_order_resolver_config('JG_SKU_DB_HOST', 'sku_db_host', 'localhost');
    $port = jg_store_ops_order_resolver_config('JG_SKU_DB_PORT', 'sku_db_port', '3306');
    $name = jg_store_ops_order_resolver_config('JG_SKU_DB_NAME', 'sku_db_name');
    $user = jg_store_ops_order_resolver_config('JG_SKU_DB_USER', 'sku_db_user');
    $pass = jg_store_ops_order_resolver_config('JG_SKU_DB_PASSWORD', 'sku_db_password');
    $charset = jg_store_ops_order_resolver_config('JG_SKU_DB_CHARSET', 'sku_db_charset', 'utf8mb4');

    if ($name === '' || $user === '') {
        $pdo = null;
        return null;
    }

    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s', $host, $port, $name, $charset),
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (Throwable) {
        $pdo = null;
    }

    return $pdo instanceof PDO ? $pdo : null;
}

function jg_store_ops_order_resolver_string(mixed $value, int $maxLength = 255): string
{
    if (!is_scalar($value)) {
        return '';
    }
    $normalized = trim(preg_replace('/\s+/', ' ', (string) $value) ?? '');
    return mb_substr($normalized, 0, $maxLength);
}

function jg_store_ops_order_resolver_money(mixed $value): float
{
    if (is_numeric($value)) {
        return round((float) $value, 2);
    }
    $normalized = preg_replace('/[^0-9.\-]+/', '', (string) $value) ?? '';
    return is_numeric($normalized) ? round((float) $normalized, 2) : 0.0;
}

function jg_store_ops_order_resolver_id_key(string $value): string
{
    return strtoupper(trim($value));
}

function jg_store_ops_order_resolver_text_key(mixed $value): string
{
    $normalized = strtoupper(trim((string) $value));
    $normalized = preg_replace('/[^A-Z0-9]+/', ' ', $normalized) ?? '';
    return trim(preg_replace('/\s+/', ' ', $normalized) ?? '');
}

function jg_store_ops_order_resolver_iso_datetime(mixed $value): string
{
    if (is_numeric($value) && (int) $value > 0) {
        $timestamp = (int) $value;
        if ($timestamp > 2000000000) {
            $timestamp = (int) floor($timestamp / 1000);
        }
        return gmdate(DATE_ATOM, $timestamp);
    }

    $raw = trim((string) $value);
    if ($raw === '') {
        return '';
    }
    $timestamp = strtotime($raw);
    return $timestamp === false ? $raw : gmdate(DATE_ATOM, $timestamp);
}

function jg_store_ops_order_resolver_platform_key(string $platform): string
{
    $normalized = strtolower(trim($platform));
    $normalized = preg_replace('/[^a-z0-9]+/', '_', $normalized) ?? '';
    $normalized = trim($normalized, '_');
    return match ($normalized) {
        'shopee', 'shopee_shop' => 'shopee',
        'tiktok', 'tiktok_shop', 'tik_tok_shop' => 'tiktok',
        'walk_in', 'walkins', 'walk_ins' => 'walk_in',
        'whatsapp', 'wa' => 'whatsapp',
        'partner' => 'partner',
        'zero_website', 'zeroweb' => 'zero_website',
        'jenang_gemi_website', 'jgweb' => 'jenang_gemi_website',
        default => $normalized,
    };
}

function jg_store_ops_order_resolver_source_label(string $sourceKey, string $account = ''): string
{
    $base = match ($sourceKey) {
        'shopee' => 'Shopee',
        'tiktok' => 'TikTok Shop',
        'walk_in' => 'Walk In',
        'whatsapp' => 'WhatsApp',
        'partner' => 'Partner',
        'zero_website' => 'ZERO Website',
        'jenang_gemi_website' => 'Jenang Gemi Website',
        default => $sourceKey !== '' ? ucwords(str_replace('_', ' ', $sourceKey)) : 'Order',
    };

    $account = jg_store_ops_order_resolver_string($account, 120);
    return $account !== '' && !str_contains(strtolower($base), strtolower($account)) ? $base . ' - ' . $account : $base;
}

function jg_store_ops_order_resolver_first_string(array $source, array $keys): string
{
    foreach ($keys as $key) {
        $value = $source[$key] ?? null;
        if (is_scalar($value) && trim((string) $value) !== '') {
            return trim((string) $value);
        }
    }
    return '';
}

function jg_store_ops_order_resolver_recursive_string(mixed $value, array $keys): string
{
    if (!is_array($value)) {
        return '';
    }
    foreach ($keys as $key) {
        if (array_key_exists($key, $value) && is_scalar($value[$key]) && trim((string) $value[$key]) !== '') {
            return trim((string) $value[$key]);
        }
    }
    foreach ($value as $child) {
        $found = jg_store_ops_order_resolver_recursive_string($child, $keys);
        if ($found !== '') {
            return $found;
        }
    }
    return '';
}

function jg_store_ops_order_resolver_customer(array $source): array
{
    $customer = is_array($source['customer'] ?? null) ? $source['customer'] : [];
    $name = jg_store_ops_order_resolver_first_string($source, ['customerName', 'customer_name', 'buyerName', 'buyer_name', 'username']);
    if ($name === '') {
        $name = jg_store_ops_order_resolver_first_string($customer, ['name', 'full_name', 'fullName', 'customer_name']);
    }
    if ($name === '') {
        $name = jg_store_ops_order_resolver_recursive_string($source, ['buyer_username', 'buyer_user_name', 'buyer_name', 'recipient_name']);
    }

    $username = jg_store_ops_order_resolver_first_string($source, ['username', 'buyer_username', 'buyerUserName']);
    $phone = jg_store_ops_order_resolver_first_string($source, ['customerPhone', 'customer_phone', 'phone']);
    if ($phone === '') {
        $phone = jg_store_ops_order_resolver_first_string($customer, ['phone', 'phone_number']);
    }
    $email = jg_store_ops_order_resolver_first_string($source, ['customerEmail', 'customer_email', 'email']);
    if ($email === '') {
        $email = jg_store_ops_order_resolver_first_string($customer, ['email']);
    }
    $address = jg_store_ops_order_resolver_first_string($source, ['customerAddress', 'customer_address', 'address']);
    if ($address === '') {
        $address = jg_store_ops_order_resolver_first_string($customer, ['address', 'shipping_address']);
    }
    if ($address === '') {
        $address = jg_store_ops_order_resolver_recursive_string($source, ['full_address', 'buyer_address']);
    }

    return [
        'name' => jg_store_ops_order_resolver_string($name, 160),
        'username' => jg_store_ops_order_resolver_string($username, 160),
        'phone' => jg_store_ops_order_resolver_string($phone, 80),
        'email' => jg_store_ops_order_resolver_string($email, 160),
        'address' => jg_store_ops_order_resolver_string($address, 255),
    ];
}

function jg_store_ops_order_resolver_item(array $item): array
{
    $sku = strtoupper(jg_store_ops_order_resolver_string($item['sku'] ?? $item['sku_code'] ?? $item['source_tag'] ?? '', 80));
    $quantity = max(0, (float) ($item['quantity'] ?? $item['qty'] ?? 1));
    if ($quantity <= 0) {
        $quantity = 1;
    }
    $unitPrice = jg_store_ops_order_resolver_money($item['unit_price'] ?? $item['unitRevenue'] ?? $item['partner_price'] ?? $item['sale_price'] ?? $item['price'] ?? 0);
    $lineTotal = jg_store_ops_order_resolver_money($item['line_total'] ?? $item['lineRevenue'] ?? 0);
    if ($lineTotal <= 0 && $unitPrice > 0) {
        $lineTotal = round($unitPrice * $quantity, 2);
    }
    $discountTotal = jg_store_ops_order_resolver_money($item['discount_total'] ?? $item['discountTotal'] ?? 0);
    $discountRate = jg_store_ops_order_resolver_money($item['discount_rate'] ?? $item['discountRate'] ?? 0);

    return [
        'sku' => $sku,
        'name' => jg_store_ops_order_resolver_string($item['name'] ?? $item['productName'] ?? $item['product_name'] ?? $item['product'] ?? $item['sku_label'] ?? $sku ?: 'Order item', 220),
        'quantity' => $quantity,
        'unit_price' => $unitPrice,
        'line_total' => $lineTotal,
        'discount_rate' => $discountRate,
        'discount_total' => $discountTotal,
        'cogs' => jg_store_ops_order_resolver_money($item['cogs'] ?? 0),
        'source_item_id' => jg_store_ops_order_resolver_string($item['sourceItemId'] ?? $item['item_key'] ?? '', 160),
    ];
}

function jg_store_ops_order_resolver_order_from_feed_order(array $order, string $fallbackSource = ''): array
{
    $orderId = jg_store_ops_order_resolver_string($order['id'] ?? $order['order_id'] ?? '', 160);
    $sourceKey = jg_store_ops_order_resolver_platform_key((string) ($order['platform'] ?? $fallbackSource));
    $account = jg_store_ops_order_resolver_string($order['sourceAccountKey'] ?? $order['account_key'] ?? $order['account'] ?? '', 120);
    $accountLabel = jg_store_ops_order_resolver_string($order['account'] ?? $account, 120);
    $items = array_map('jg_store_ops_order_resolver_item', array_values(array_filter((array) ($order['items'] ?? []), 'is_array')));
    $lineTotal = array_reduce($items, static fn (float $sum, array $item): float => $sum + (float) ($item['line_total'] ?? 0), 0.0);
    $financials = is_array($order['financials'] ?? null) ? $order['financials'] : [];
    $gross = jg_store_ops_order_resolver_money($financials['grossRevenue'] ?? $financials['gross_revenue'] ?? $order['revenueTotal'] ?? $order['total'] ?? $lineTotal);
    $net = jg_store_ops_order_resolver_money($financials['netRevenue'] ?? $financials['net_revenue'] ?? $gross);
    $fees = jg_store_ops_order_resolver_money($financials['marketplaceFees'] ?? $financials['marketplace_fees'] ?? max(0, $gross - $net));
    $subtotal = $gross;
    $discountTotal = 0.0;
    $shippingCost = 0.0;
    $total = $gross > 0 ? $gross : $net;
    if ($sourceKey === 'whatsapp') {
        $subtotal = jg_store_ops_order_resolver_money(
            $financials['merchandiseSubtotal'] ?? $financials['merchandise_subtotal']
                ?? $order['merchandise_subtotal'] ?? $gross
        );
        $net = jg_store_ops_order_resolver_money(
            $financials['merchandiseTotal'] ?? $financials['merchandise_total']
                ?? $order['merchandise_total'] ?? $lineTotal
        );
        $discountTotal = jg_store_ops_order_resolver_money(
            $financials['discountTotal'] ?? $financials['discount_total']
                ?? $order['discount_total'] ?? max(0, $subtotal - $net)
        );
        $shippingCost = jg_store_ops_order_resolver_money(
            $financials['shippingCost'] ?? $financials['shipping_cost']
                ?? $order['shipping_cost'] ?? 0
        );
        $total = jg_store_ops_order_resolver_money(
            $financials['customerTotal'] ?? $financials['customer_total']
                ?? $order['revenueTotal'] ?? $order['total'] ?? ($net + $shippingCost)
        );
        $gross = $subtotal;
        $fees = 0.0;
    }

    return [
        'order_id' => $orderId,
        'source' => [
            'key' => $sourceKey,
            'label' => jg_store_ops_order_resolver_source_label($sourceKey, $accountLabel),
            'account' => $account,
            'platform' => $sourceKey,
        ],
        'customer' => jg_store_ops_order_resolver_customer($order),
        'items' => $items,
        'revenue' => [
            'currency' => jg_store_ops_order_resolver_string($financials['currency'] ?? $order['currency'] ?? 'IDR', 12) ?: 'IDR',
            'subtotal' => $subtotal,
            'discount_total' => $discountTotal,
            'tax' => 0.0,
            'gross' => $gross,
            'net' => $net,
            'fees' => $fees,
            'shipping_cost' => $shippingCost,
            'total' => $total,
        ],
        'timestamps' => [
            'ordered_at' => jg_store_ops_order_resolver_iso_datetime($order['createdAt'] ?? $order['created_at'] ?? ''),
            'created_at' => jg_store_ops_order_resolver_iso_datetime($order['createdAt'] ?? $order['created_at'] ?? ''),
            'updated_at' => jg_store_ops_order_resolver_iso_datetime($order['updatedAt'] ?? $order['updated_at'] ?? ''),
        ],
        'status' => jg_store_ops_order_resolver_string($order['status'] ?? $order['marketplaceStatus'] ?? $order['marketplace_status'] ?? '', 80),
        'raw' => $order,
    ];
}

function jg_store_ops_order_resolver_find_walkin(string $orderId): ?array
{
    $pdo = jg_store_ops_order_resolver_store_db();
    if (!$pdo instanceof PDO) {
        return null;
    }

    try {
        $stmt = $pdo->prepare(
            'SELECT * FROM store_ops_walkin_invoices
             WHERE UPPER(invoice_number) = :order_id
             LIMIT 1'
        );
        $stmt->execute([':order_id' => jg_store_ops_order_resolver_id_key($orderId)]);
        $invoice = $stmt->fetch();
    } catch (Throwable) {
        return null;
    }

    if (!is_array($invoice)) {
        return null;
    }

    try {
        $itemsStmt = $pdo->prepare(
            'SELECT sku, tag, product_name, unit_price, quantity, discount_total, line_total
             FROM store_ops_walkin_invoice_items
             WHERE invoice_number = :invoice_number
             ORDER BY id ASC'
        );
        $itemsStmt->execute([':invoice_number' => (string) $invoice['invoice_number']]);
        $itemRows = $itemsStmt->fetchAll();
    } catch (Throwable) {
        $itemRows = [];
    }

    $invoiceType = jg_store_ops_order_resolver_platform_key((string) ($invoice['invoice_type'] ?? 'walk_in'));
    $saleType = jg_store_ops_order_resolver_string($invoice['sale_type'] ?? '', 40);
    $sourceKey = $invoiceType === 'whatsapp' ? 'whatsapp' : 'walk_in';
    $sourceLabel = $sourceKey === 'whatsapp' && $saleType !== '' ? 'WhatsApp - ' . $saleType : jg_store_ops_order_resolver_source_label($sourceKey);
    $items = array_map(static function (array $item): array {
        return jg_store_ops_order_resolver_item([
            'sku' => (string) ($item['sku'] ?? ''),
            'name' => (string) ($item['product_name'] ?? ''),
            'quantity' => (int) ($item['quantity'] ?? 1),
            'unit_price' => $item['unit_price'] ?? 0,
            'discount_total' => $item['discount_total'] ?? 0,
            'line_total' => $item['line_total'] ?? 0,
        ]);
    }, $itemRows);

    return [
        'order_id' => (string) ($invoice['invoice_number'] ?? ''),
        'source' => [
            'key' => $sourceKey,
            'label' => $sourceLabel,
            'account' => 'Store Ops',
            'platform' => $sourceKey,
        ],
        'customer' => [
            'name' => (string) ($invoice['customer_name'] ?? ''),
            'username' => '',
            'phone' => (string) ($invoice['customer_phone'] ?? ''),
            'email' => (string) ($invoice['customer_email'] ?? ''),
            'address' => (string) ($invoice['customer_address'] ?? ''),
        ],
        'items' => $items,
        'revenue' => [
            'currency' => 'IDR',
            'subtotal' => jg_store_ops_order_resolver_money($invoice['subtotal'] ?? 0),
            'discount_total' => jg_store_ops_order_resolver_money($invoice['discount_total'] ?? 0),
            'tax' => jg_store_ops_order_resolver_money($invoice['tax'] ?? 0),
            'shipping_cost' => jg_store_ops_order_resolver_money($invoice['shipping_cost'] ?? 0),
            'gross' => jg_store_ops_order_resolver_money($invoice['total'] ?? 0),
            'net' => jg_store_ops_order_resolver_money($invoice['total'] ?? 0),
            'fees' => 0.0,
            'total' => jg_store_ops_order_resolver_money($invoice['total'] ?? 0),
        ],
        'timestamps' => [
            'ordered_at' => jg_store_ops_order_resolver_iso_datetime($invoice['created_at'] ?? ''),
            'created_at' => jg_store_ops_order_resolver_iso_datetime($invoice['created_at'] ?? ''),
            'updated_at' => '',
        ],
        'status' => 'PAID',
        'raw' => ['invoice' => $invoice, 'items' => $itemRows],
    ];
}

function jg_store_ops_order_resolver_find_website(string $orderId): ?array
{
    $pdo = jg_store_ops_order_resolver_store_db();
    if (!$pdo instanceof PDO) {
        return null;
    }

    try {
        $stmt = $pdo->prepare(
            'SELECT source_platform, order_id, payload_json, status, source_created_at, created_at, updated_at
             FROM store_ops_website_orders
             WHERE UPPER(order_id) = :order_id
             LIMIT 1'
        );
        $stmt->execute([':order_id' => jg_store_ops_order_resolver_id_key($orderId)]);
        $row = $stmt->fetch();
    } catch (Throwable) {
        return null;
    }

    if (!is_array($row)) {
        // A direct order still queued in the Executive Dashboard was never sent
        // here, but its invoice can already be printed.
        if (!str_starts_with(jg_store_ops_order_resolver_id_key($orderId), 'WAEXEC-')) {
            return null;
        }
        try {
            return jg_store_ops_order_resolver_order_from_feed_order(jg_store_ops_whatsapp_executive_order($orderId), 'whatsapp');
        } catch (Throwable) {
            return null;
        }
    }
    $payload = json_decode((string) ($row['payload_json'] ?? ''), true);
    if (!is_array($payload)) {
        $payload = [];
    }
    if (($row['source_platform'] ?? '') === 'whatsapp' && strtoupper((string) ($row['status'] ?? '')) === 'QUEUED') {
        // A recalled order can change in the Executive queue, so the copy saved
        // when it was first sent may be out of date.
        try {
            $payload = jg_store_ops_whatsapp_executive_order((string) $row['order_id']);
        } catch (Throwable) {
            // Preserve the locally saved order when the Executive Dashboard is temporarily unavailable.
        }
    } elseif (($row['source_platform'] ?? '') === 'whatsapp') {
        $savedTotal = jg_store_ops_order_resolver_money(
            $payload['revenueTotal'] ?? $payload['merchandise_total'] ?? $payload['total'] ?? 0
        );
        if ($savedTotal <= 0) {
            try {
                $feed = jg_store_ops_whatsapp_feed();
                $target = jg_store_ops_order_resolver_id_key($orderId);
                foreach ((array) ($feed['orders'] ?? []) as $freshOrder) {
                    if (!is_array($freshOrder)) continue;
                    $freshId = jg_store_ops_order_resolver_id_key((string) ($freshOrder['order_id'] ?? $freshOrder['id'] ?? ''));
                    if ($freshId === $target) {
                        $payload = $freshOrder;
                        break;
                    }
                }
            } catch (Throwable) {
                // Preserve the locally saved order when the Executive feed is temporarily unavailable.
            }
        }
    }
    $payload['id'] = (string) ($row['order_id'] ?? ($payload['id'] ?? ''));
    $payload['platform'] = (string) ($row['source_platform'] ?? ($payload['platform'] ?? ''));
    $payload['status'] = (string) ($row['status'] ?? ($payload['status'] ?? ''));
    $payload['createdAt'] = $payload['createdAt'] ?? (string) ($row['source_created_at'] ?? $row['created_at'] ?? '');
    $payload['updatedAt'] = $payload['updatedAt'] ?? (string) ($row['updated_at'] ?? '');

    return jg_store_ops_order_resolver_order_from_feed_order($payload, (string) ($row['source_platform'] ?? ''));
}

function jg_store_ops_order_resolver_partner_orders(): array
{
    $feed = jg_store_ops_partner_orders_fetch_feed();
    if (is_array($feed)) {
        return array_values(array_filter((array) ($feed['orders'] ?? []), static function ($order): bool {
            return is_array($order) && jg_store_ops_partner_orders_has_labels($order);
        }));
    }

    $pdo = jg_store_ops_partner_orders_db();
    if (!$pdo instanceof PDO) {
        return [];
    }

    try {
        $columns = jg_store_ops_partner_orders_table_columns($pdo);
        $select = [
            'id',
            'partner_code',
            'customer_name',
            'brand_name',
            'product_name',
            'sku_code',
            'sku_label',
            'quantity',
            'notes',
            'status',
            'order_timestamp',
            jg_store_ops_partner_orders_select_column($columns, 'marketplace_platform', "''"),
            jg_store_ops_partner_orders_select_column($columns, 'deadline_hours', '24'),
            jg_store_ops_partner_orders_select_column($columns, 'deadline_at', 'NULL'),
            jg_store_ops_partner_orders_select_column($columns, 'revenue_total', '0'),
            'items_json',
            'created_at',
            'updated_at',
        ];
        $rows = $pdo->query('SELECT ' . implode(', ', $select) . ' FROM partner_orders ORDER BY COALESCE(order_timestamp, created_at) DESC, id DESC')->fetchAll();
        $labelsByOrder = jg_store_ops_partner_orders_fetch_labels($pdo, array_map(
            static fn (array $row): string => (string) ($row['id'] ?? ''),
            $rows
        ));
        $orders = array_map(
            static fn (array $row): array => jg_store_ops_partner_orders_normalize($row, $labelsByOrder[(string) ($row['id'] ?? '')] ?? []),
            $rows
        );
        return array_values(array_filter($orders, 'jg_store_ops_partner_orders_has_labels'));
    } catch (Throwable) {
        return [];
    }
}

function jg_store_ops_order_resolver_find_partner(string $orderId): ?array
{
    $historicalOrder = jg_store_ops_partner_orders_find_any($orderId);
    if (is_array($historicalOrder)) {
        return jg_store_ops_order_resolver_order_from_feed_order($historicalOrder, 'partner');
    }

    $target = jg_store_ops_order_resolver_id_key($orderId);
    foreach (jg_store_ops_order_resolver_partner_orders() as $order) {
        $id = jg_store_ops_order_resolver_id_key((string) ($order['id'] ?? ''));
        $sourceId = jg_store_ops_order_resolver_id_key((string) ($order['sourceOrderId'] ?? ''));
        if ($id === $target || $sourceId === $target || ('PARTNER-' . $sourceId) === $target) {
            return jg_store_ops_order_resolver_order_from_feed_order($order, 'partner');
        }
    }
    return null;
}

function jg_store_ops_order_resolver_fetch_json(string $url, array $headers = []): ?array
{
    $headers = array_values(array_filter($headers, static fn (string $header): bool => trim($header) !== ''));
    if (!in_array('Accept: application/json', $headers, true)) {
        array_unshift($headers, 'Accept: application/json');
    }

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            return null;
        }
        curl_setopt_array($curl, [
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 25,
        ]);
        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if (!is_string($raw) || $status >= 400) {
            return null;
        }
    } else {
        $raw = @file_get_contents($url, false, stream_context_create(['http' => [
            'method' => 'GET',
            'header' => implode("\r\n", $headers) . "\r\n",
            'timeout' => 25,
        ]]));
        if (!is_string($raw)) {
            return null;
        }
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function jg_store_ops_order_resolver_marketplace_request(string $path, array $query): ?array
{
    $baseUrl = rtrim(jg_store_ops_order_resolver_config('JG_SHOPEE_INGEST_BASE_URL', 'shopee_ingest_base_url', 'https://api.jenanggemi.com'), '/');
    $requestedPlatform = jg_store_ops_order_resolver_platform_key((string) ($query['platform'] ?? ''));
    $platform = $requestedPlatform === 'tiktok' || str_starts_with($path, '/tiktok/') ? 'tiktok' : 'shopee';
    $setupToken = $platform === 'tiktok'
        ? jg_store_ops_order_resolver_config(
            'JG_TIKTOK_INGEST_SETUP_TOKEN',
            'tiktok_ingest_setup_token',
            jg_store_ops_order_resolver_config('JG_SHOPEE_INGEST_SETUP_TOKEN', 'shopee_ingest_setup_token')
        )
        : jg_store_ops_order_resolver_config('JG_SHOPEE_INGEST_SETUP_TOKEN', 'shopee_ingest_setup_token');
    if ($baseUrl === '' || $setupToken === '') {
        return null;
    }
    $query['setup_token'] = $setupToken;
    return jg_store_ops_order_resolver_fetch_json($baseUrl . $path . '?' . http_build_query($query));
}

/** @return array<string,mixed> */
function jg_store_ops_order_resolver_shipment_lifecycle(string $platform, string $account, string $orderId): array
{
    $platform = jg_store_ops_order_resolver_platform_key($platform);
    $account = strtolower(trim($account));
    $orderId = trim($orderId);
    if (!in_array($platform, ['shopee', 'tiktok'], true) || $account === '' || $orderId === '') {
        return [];
    }
    $payload = jg_store_ops_order_resolver_marketplace_request('/fulfillment/order-lifecycle', [
        'platform' => $platform,
        'account_key' => $account,
        'order_id' => $orderId,
    ]);
    return is_array($payload['lifecycle'] ?? null) ? $payload['lifecycle'] : [];
}

function jg_store_ops_order_resolver_order_from_marketplace_rows(array $rows): ?array
{
    $rows = array_values(array_filter($rows, 'is_array'));
    if ($rows === []) {
        return null;
    }

    $first = $rows[0];
    $items = [];
    $profileValues = [];
    foreach ($rows as $row) {
        foreach ((array) ($row['profile_values'] ?? []) as $profileValue) {
            $profileValue = jg_store_ops_order_resolver_string($profileValue, 200);
            if ($profileValue !== '') {
                $profileValues[$profileValue] = true;
            }
        }
        $quantity = max(0, (float) ($row['quantity'] ?? 0));
        if ($quantity <= 0 && (int) ($row['item_row_id'] ?? 0) <= 0 && $items !== []) {
            continue;
        }
        $lineTotal = jg_store_ops_order_resolver_money($row['gross_revenue'] ?? $row['revenue'] ?? 0);
        $unitPrice = $quantity > 0 ? round($lineTotal / $quantity, 2) : $lineTotal;
        $items[] = jg_store_ops_order_resolver_item([
            'sku' => (string) ($row['sku'] ?? ''),
            'name' => trim(implode(' ', array_filter([
                (string) ($row['product_name'] ?? ''),
                (string) ($row['flavor'] ?? ''),
            ]))) ?: (string) ($row['product_type'] ?? 'Marketplace item'),
            'quantity' => $quantity > 0 ? $quantity : max(1, (int) ($row['order_item_count'] ?? 1)),
            'unit_price' => $unitPrice,
            'line_total' => $lineTotal,
            'sourceItemId' => (string) ($row['item_key'] ?? ''),
        ]);
    }

    $platform = jg_store_ops_order_resolver_platform_key((string) ($first['platform'] ?? ''));
    $account = jg_store_ops_order_resolver_string($first['company'] ?? $first['account_key'] ?? '', 120);
    $gross = jg_store_ops_order_resolver_money($first['order_gross_revenue'] ?? 0);
    $net = jg_store_ops_order_resolver_money($first['order_net_revenue'] ?? $gross);
    $fees = jg_store_ops_order_resolver_money($first['order_marketplace_fees'] ?? max(0, $gross - $net));

    return [
        'order_id' => (string) ($first['order_id'] ?? ''),
        'source' => [
            'key' => $platform,
            'label' => jg_store_ops_order_resolver_source_label($platform, $account),
            'account' => (string) ($first['account_key'] ?? ''),
            'platform' => $platform,
        ],
        'customer' => [
            'name' => jg_store_ops_order_resolver_string($first['username'] ?? '', 160),
            'username' => jg_store_ops_order_resolver_string($first['username'] ?? '', 160),
            'phone' => jg_store_ops_order_resolver_string($first['phone'] ?? '', 80),
            'email' => '',
            'address' => jg_store_ops_order_resolver_string($first['address'] ?? '', 255),
            'profile_values' => array_slice(array_keys($profileValues), 0, 40),
        ],
        'items' => $items,
        'revenue' => [
            'currency' => jg_store_ops_order_resolver_string($first['currency'] ?? 'IDR', 12) ?: 'IDR',
            'subtotal' => $gross,
            'discount_total' => 0.0,
            'tax' => 0.0,
            'gross' => $gross,
            'net' => $net,
            'fees' => $fees,
            'total' => $gross > 0 ? $gross : $net,
        ],
        'timestamps' => [
            'ordered_at' => jg_store_ops_order_resolver_iso_datetime($first['order_create_time'] ?? $first['timestamp'] ?? ''),
            'created_at' => jg_store_ops_order_resolver_iso_datetime($first['order_create_time'] ?? $first['timestamp'] ?? ''),
            'updated_at' => '',
        ],
        'status' => jg_store_ops_order_resolver_string($first['status'] ?? '', 80),
        'raw' => ['marketplace_rows' => $rows],
    ];
}

function jg_store_ops_order_resolver_find_marketplace_history(string $orderId): ?array
{
    $payload = jg_store_ops_order_resolver_marketplace_request('/sales/order', [
        'order_id' => $orderId,
    ]);
    if (!is_array($payload) || empty($payload['ok'])) {
        return null;
    }
    return jg_store_ops_order_resolver_order_from_marketplace_rows((array) ($payload['orders'] ?? []));
}

/**
 * Return an exact, read-only API Ingest completion proof for a marketplace order.
 *
 * @return array{source_platform:string,source_account:string,order_id:string,proof_source:string,processed_at:string}|null
 */
function jg_store_ops_order_resolver_marketplace_fulfillment_proof(
    string $platform,
    string $account,
    string $orderId
): ?array {
    $platform = jg_store_ops_order_resolver_platform_key($platform);
    $account = strtolower(trim($account));
    $orderId = trim($orderId);
    if (!in_array($platform, ['shopee', 'tiktok'], true) || $account === '' || $orderId === '') {
        return null;
    }

    $payload = jg_store_ops_order_resolver_marketplace_request('/fulfillment/orders', [
        'platform' => $platform,
        'limit' => 500,
    ]);
    if (!is_array($payload) || empty($payload['ok'])) {
        return null;
    }

    foreach ((array) ($payload['orders'] ?? []) as $row) {
        if (!is_array($row)) continue;
        if (jg_store_ops_order_resolver_platform_key((string) ($row['platform'] ?? '')) !== $platform) continue;
        if (strtolower(trim((string) ($row['account_key'] ?? ''))) !== $account) continue;
        if (trim((string) ($row['order_id'] ?? '')) !== $orderId) continue;
        if (empty($row['is_processed'])) return null;
        if (strtoupper(trim((string) ($row['workflow_status'] ?? ''))) !== 'IS_PROCESSED') return null;

        return [
            'source_platform' => $platform,
            'source_account' => $account,
            'order_id' => $orderId,
            'proof_source' => 'api_ingest_processed',
            'processed_at' => trim((string) ($row['processed_at'] ?? $row['updated_at'] ?? '')),
        ];
    }
    return null;
}

function jg_store_ops_order_resolver_configured_marketplace_sources(): array
{
    $sourcesValue = jg_store_ops_order_resolver_config('JG_MARKETPLACE_SOURCES', 'marketplace_sources');
    $sources = [];
    if ($sourcesValue !== '') {
        foreach (explode(',', $sourcesValue) as $source) {
            $parts = array_map('trim', explode(':', $source, 2));
            $platform = jg_store_ops_order_resolver_platform_key($parts[0] ?? '');
            $account = strtolower(trim((string) ($parts[1] ?? '')));
            if (in_array($platform, ['shopee', 'tiktok'], true) && $account !== '') {
                $sources[] = ['platform' => $platform, 'account' => $account];
            }
        }
    }
    if ($sources === []) {
        foreach (explode(',', jg_store_ops_order_resolver_config('JG_SHOPEE_ACCOUNTS', 'shopee_accounts', jg_store_ops_order_resolver_config('JG_SHOPEE_ACCOUNT', 'shopee_account', 'jenang-gemi-shopee'))) as $account) {
            $account = strtolower(trim($account));
            if ($account !== '') {
                $sources[] = ['platform' => 'shopee', 'account' => $account];
            }
        }
        foreach (explode(',', jg_store_ops_order_resolver_config('JG_TIKTOK_ACCOUNTS', 'tiktok_accounts')) as $account) {
            $account = strtolower(trim($account));
            if ($account !== '') {
                $sources[] = ['platform' => 'tiktok', 'account' => $account];
            }
        }
    }
    $unique = [];
    foreach ($sources as $source) {
        $unique[$source['platform'] . ':' . $source['account']] = $source;
    }
    return array_values($unique);
}

function jg_store_ops_order_resolver_find_active_marketplace(string $orderId): ?array
{
    $target = jg_store_ops_order_resolver_id_key($orderId);
    foreach (jg_store_ops_order_resolver_configured_marketplace_sources() as $source) {
        $payload = jg_store_ops_order_resolver_marketplace_request('/' . rawurlencode((string) $source['platform']) . '/orders/listed', [
            'account' => (string) $source['account'],
            'fast' => '1',
            'persist' => '0',
            'escrow' => '1',
        ]);
        foreach ((array) ($payload['orders'] ?? []) as $order) {
            if (!is_array($order)) {
                continue;
            }
            $id = jg_store_ops_order_resolver_id_key((string) ($order['id'] ?? $order['order_id'] ?? ''));
            if ($id === $target) {
                return jg_store_ops_order_resolver_order_from_feed_order($order, (string) $source['platform']);
            }
        }
    }
    return null;
}

function jg_store_ops_resolve_order_by_id(string $orderId): ?array
{
    $orderId = trim($orderId);
    if ($orderId === '') {
        return null;
    }

    foreach ([
        'jg_store_ops_order_resolver_find_walkin',
        'jg_store_ops_order_resolver_find_website',
        'jg_store_ops_order_resolver_find_partner',
        'jg_store_ops_order_resolver_find_marketplace_history',
        'jg_store_ops_order_resolver_find_active_marketplace',
    ] as $resolver) {
        $order = $resolver($orderId);
        if (is_array($order) && trim((string) ($order['order_id'] ?? '')) !== '') {
            return $order;
        }
    }

    return null;
}

function jg_store_ops_order_resolver_order_matches_query(array $order, string $query): bool
{
    $needle = jg_store_ops_order_resolver_text_key($query);
    if ($needle === '') {
        return false;
    }
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $profileValues = array_values(array_filter(array_map(
        static fn (mixed $value): string => jg_store_ops_order_resolver_string($value, 200),
        (array) ($customer['profile_values'] ?? [])
    )));
    $haystack = jg_store_ops_order_resolver_text_key(implode(' ', [
        (string) ($customer['name'] ?? ''),
        (string) ($customer['username'] ?? ''),
        (string) ($customer['phone'] ?? ''),
        (string) ($customer['email'] ?? ''),
        implode(' ', $profileValues),
    ]));
    return str_contains($haystack, $needle);
}

function jg_store_ops_order_resolver_shipping_label(array $order): array
{
    $source = is_array($order['source'] ?? null) ? $order['source'] : [];
    $platform = jg_store_ops_order_resolver_platform_key((string) ($source['platform'] ?? $source['key'] ?? ''));
    $status = (string) ($order['status'] ?? '');
    $cancelled = preg_match('/CANCEL|REFUND|RETURN|REJECT|FAILED|EXPIRED|CLOSED/i', $status) === 1;
    $supported = !$cancelled && in_array($platform, ['shopee', 'tiktok', 'partner', 'zero_website', 'jenang_gemi_website', 'whatsapp'], true);
    $raw = is_array($order['raw'] ?? null) ? $order['raw'] : [];
    $available = $supported;
    $availabilitySource = $supported ? 'source' : 'unavailable';
    $unavailableReason = '';
    if ($platform === 'whatsapp' && strtoupper($status) === 'QUEUED') {
        // Queued orders are held back from Store Ops; only their invoice is printable.
        $available = false;
        $availabilitySource = 'unavailable';
        $unavailableReason = 'This order is still queued in the Executive Dashboard and has not been sent to Store Ops.';
    }
    if (in_array($platform, ['shopee', 'tiktok'], true)) {
        $marketplaceRow = is_array($raw['marketplace_rows'][0] ?? null) ? $raw['marketplace_rows'][0] : [];
        if (array_key_exists('label_reprint_available', $marketplaceRow)) {
            $available = $supported && (bool) $marketplaceRow['label_reprint_available'];
            $availabilitySource = jg_store_ops_order_resolver_string($marketplaceRow['label_reprint_source'] ?? '', 40);
            $unavailableReason = jg_store_ops_order_resolver_string($marketplaceRow['label_reprint_reason'] ?? '', 240);
            if (!$available && preg_match('/SHIPPED|COMPLETED|DELIVERED|TO_CONFIRM_RECEIVE/i', $status) === 1) {
                $unavailableReason = 'This order has already been shipped. The shipping label no longer exists.';
            }
        }
    }
    $package = jg_store_ops_order_resolver_recursive_string($raw, [
        'packageNumber',
        'package_number',
        'package_id',
        'packageId',
        'shipment_id',
    ]);

    return [
        'supported' => $supported,
        'available' => $available,
        'availability_source' => $availabilitySource,
        'unavailable_reason' => $unavailableReason,
        'platform' => $platform,
        'account' => jg_store_ops_order_resolver_string($source['account'] ?? '', 120),
        'package' => jg_store_ops_order_resolver_string($package, 160),
    ];
}

function jg_store_ops_order_resolver_search_walkins(string $query, int $limit): array
{
    $pdo = jg_store_ops_order_resolver_store_db();
    if (!$pdo instanceof PDO) {
        return [];
    }
    try {
        $stmt = $pdo->prepare(
            'SELECT invoice_number
             FROM store_ops_walkin_invoices
             WHERE customer_name LIKE :query
                OR customer_phone LIKE :query
                OR customer_email LIKE :query
                OR customer_address LIKE :query
                OR invoice_number LIKE :query
             ORDER BY created_at DESC, invoice_number DESC
             LIMIT ' . max(1, min(200, $limit))
        );
        $stmt->execute([':query' => '%' . $query . '%']);
        $ids = array_map(static fn (array $row): string => (string) ($row['invoice_number'] ?? ''), $stmt->fetchAll());
    } catch (Throwable) {
        return [];
    }
    return array_values(array_filter(array_map('jg_store_ops_resolve_order_by_id', $ids), 'is_array'));
}

function jg_store_ops_order_resolver_search_website(string $query, int $limit): array
{
    $pdo = jg_store_ops_order_resolver_store_db();
    if (!$pdo instanceof PDO) {
        return [];
    }
    try {
        $stmt = $pdo->prepare(
            'SELECT order_id
             FROM store_ops_website_orders
             WHERE order_id LIKE :query OR payload_json LIKE :query
             ORDER BY source_created_at DESC, id DESC
             LIMIT ' . max(1, min(200, $limit))
        );
        $stmt->execute([':query' => '%' . $query . '%']);
        $ids = array_map(static fn (array $row): string => (string) ($row['order_id'] ?? ''), $stmt->fetchAll());
    } catch (Throwable) {
        return [];
    }
    return array_values(array_filter(array_map('jg_store_ops_resolve_order_by_id', $ids), 'is_array'));
}

function jg_store_ops_order_resolver_search_partner(string $query, int $limit): array
{
    $orders = [];
    foreach (jg_store_ops_order_resolver_partner_orders() as $order) {
        if (!is_array($order)) {
            continue;
        }
        $normalized = jg_store_ops_order_resolver_order_from_feed_order($order, 'partner');
        if (jg_store_ops_order_resolver_order_matches_query($normalized, $query)) {
            $orders[] = $normalized;
            if (count($orders) >= $limit) {
                break;
            }
        }
    }
    return $orders;
}

function jg_store_ops_order_resolver_search_marketplace(string $query, int $limit): array
{
    $payload = jg_store_ops_order_resolver_marketplace_request('/sales/search', [
        'query' => $query,
        'limit' => $limit,
    ]);
    if (!is_array($payload) || empty($payload['ok'])) {
        return [];
    }
    $rowsByOrder = [];
    foreach ((array) ($payload['orders'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = (string) ($row['order_id'] ?? '');
        if ($id !== '') {
            $rowsByOrder[$id][] = $row;
        }
    }

    $orders = [];
    foreach ($rowsByOrder as $rows) {
        $order = jg_store_ops_order_resolver_order_from_marketplace_rows($rows);
        if (is_array($order)) {
            $orders[] = $order;
        }
    }
    return $orders;
}

function jg_store_ops_order_resolver_customer_profile_key(array $order): string
{
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    foreach (['username', 'name', 'phone', 'email'] as $key) {
        $value = jg_store_ops_order_resolver_text_key($customer[$key] ?? '');
        if ($value !== '') {
            return $value;
        }
    }
    foreach ((array) ($customer['profile_values'] ?? []) as $profileValue) {
        $value = jg_store_ops_order_resolver_text_key($profileValue);
        if ($value !== '') {
            return $value;
        }
    }
    return jg_store_ops_order_resolver_text_key($order['order_id'] ?? '');
}

function jg_store_ops_order_resolver_customer_prefix_match(array $customer, string $query): bool
{
    $needle = jg_store_ops_order_resolver_text_key($query);
    if ($needle === '') {
        return false;
    }

    $values = [];
    foreach (['username', 'name', 'phone', 'email'] as $field) {
        $values[] = $customer[$field] ?? '';
    }
    foreach ((array) ($customer['profile_values'] ?? []) as $profileValue) {
        $values[] = $profileValue;
    }

    foreach ($values as $value) {
        $normalized = jg_store_ops_order_resolver_text_key(jg_store_ops_order_resolver_string($value, 200));
        if ($normalized !== '' && str_starts_with($normalized, $needle)) {
            return true;
        }
    }
    return false;
}

function jg_store_ops_order_resolver_sort_customer_profiles(array &$profiles, string $query): void
{
    usort($profiles, static function (array $left, array $right) use ($query): int {
        $leftCustomer = is_array($left['customer'] ?? null) ? $left['customer'] : [];
        $rightCustomer = is_array($right['customer'] ?? null) ? $right['customer'] : [];
        $prefixComparison = (int) jg_store_ops_order_resolver_customer_prefix_match($rightCustomer, $query)
            <=> (int) jg_store_ops_order_resolver_customer_prefix_match($leftCustomer, $query);
        if ($prefixComparison !== 0) {
            return $prefixComparison;
        }
        return (int) ($right['order_count'] ?? 0) <=> (int) ($left['order_count'] ?? 0);
    });
}

function jg_store_ops_search_customer_profiles(string $query, int $limit = 100, bool $labelOnly = false, string $platform = ''): array
{
    $query = trim($query);
    if ($query === '') {
        return [];
    }
    $limit = max(1, min(200, $limit));
    $platform = $platform !== '' ? jg_store_ops_order_resolver_platform_key($platform) : '';
    $orders = [];
    foreach ([
        jg_store_ops_order_resolver_search_walkins($query, $limit),
        jg_store_ops_order_resolver_search_website($query, $limit),
        jg_store_ops_order_resolver_search_partner($query, $limit),
        jg_store_ops_order_resolver_search_marketplace($query, $limit),
    ] as $sourceOrders) {
        foreach ($sourceOrders as $order) {
            if (
                is_array($order)
                && jg_store_ops_order_resolver_order_matches_query($order, $query)
                && ($platform === '' || jg_store_ops_order_resolver_platform_key((string) ($order['source']['platform'] ?? $order['source']['key'] ?? '')) === $platform)
                && (!$labelOnly || !empty(jg_store_ops_order_resolver_shipping_label($order)['supported']))
            ) {
                $orders[(string) ($order['source']['key'] ?? '') . ':' . (string) ($order['order_id'] ?? '')] = $order;
            }
        }
    }

    $profiles = [];
    foreach ($orders as $order) {
        $key = jg_store_ops_order_resolver_customer_profile_key($order);
        if ($key === '') {
            continue;
        }
        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        unset($customer['address']);
        if (!isset($profiles[$key])) {
            $profiles[$key] = [
                'profile_key' => $key,
                'customer' => $customer,
                'orders' => [],
                'order_count' => 0,
                'total_revenue' => 0.0,
            ];
        } else {
            foreach (['username', 'name', 'phone', 'email'] as $customerField) {
                if (
                    trim((string) ($profiles[$key]['customer'][$customerField] ?? '')) === ''
                    && trim((string) ($customer[$customerField] ?? '')) !== ''
                ) {
                    $profiles[$key]['customer'][$customerField] = $customer[$customerField];
                }
            }
        }
        $summary = [
            'order_id' => (string) ($order['order_id'] ?? ''),
            'source' => $order['source'] ?? [],
            'status' => (string) ($order['status'] ?? ''),
            'created_at' => (string) ($order['timestamps']['created_at'] ?? $order['timestamps']['ordered_at'] ?? ''),
            'item_count' => array_reduce((array) ($order['items'] ?? []), static fn (float $sum, array $item): float => $sum + (float) ($item['quantity'] ?? 0), 0.0),
            'total' => (float) ($order['revenue']['total'] ?? 0),
            'currency' => (string) ($order['revenue']['currency'] ?? 'IDR'),
            'shipping_label' => jg_store_ops_order_resolver_shipping_label($order),
        ];
        $profiles[$key]['orders'][] = $summary;
        $profiles[$key]['order_count']++;
        $profiles[$key]['total_revenue'] += (float) ($summary['total'] ?? 0);
    }

    $rows = array_values($profiles);
    foreach ($rows as &$profile) {
        usort($profile['orders'], static fn (array $left, array $right): int => strcmp(
            (string) ($right['created_at'] ?? ''),
            (string) ($left['created_at'] ?? '')
        ));
    }
    unset($profile);
    jg_store_ops_order_resolver_sort_customer_profiles($rows, $query);
    return $rows;
}
