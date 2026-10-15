<?php
declare(strict_types=1);

require_once __DIR__ . '/sku-db-bootstrap.php';

const JG_STORE_OPS_WALKINS_INVOICE_TYPES = ['walk_in', 'whatsapp'];

function jg_store_ops_walkins_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function jg_store_ops_walkins_ensure_schema(PDO $pdo): void
{
    jg_store_ops_sku_ensure_column($pdo, 'sku_skus', 'sale_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER cogs');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_walkin_invoices (
            invoice_number VARCHAR(40) NOT NULL PRIMARY KEY,
            customer_name VARCHAR(160) NOT NULL DEFAULT "",
            customer_phone VARCHAR(80) NOT NULL DEFAULT "",
            customer_email VARCHAR(160) NOT NULL DEFAULT "",
            payment_method VARCHAR(40) NOT NULL DEFAULT "Cash",
            subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            tax DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            item_count INT UNSIGNED NOT NULL DEFAULT 0,
            created_by VARCHAR(160) NOT NULL DEFAULT "",
            created_at DATETIME NOT NULL,
            KEY idx_store_ops_walkin_invoices_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_walkin_invoice_items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            invoice_number VARCHAR(40) NOT NULL,
            sku VARCHAR(12) NOT NULL,
            tag VARCHAR(50) NOT NULL DEFAULT "",
            product_name VARCHAR(220) NOT NULL DEFAULT "",
            unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            quantity INT UNSIGNED NOT NULL DEFAULT 1,
            line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
            scanned TINYINT(1) NOT NULL DEFAULT 1,
            skip_scan TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            KEY idx_store_ops_walkin_items_invoice (invoice_number),
            KEY idx_store_ops_walkin_items_sku (sku),
            CONSTRAINT fk_store_ops_walkin_items_invoice
                FOREIGN KEY (invoice_number)
                REFERENCES store_ops_walkin_invoices(invoice_number)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'discount_total', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER subtotal');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'discount_type', 'VARCHAR(24) NOT NULL DEFAULT "" AFTER discount_total');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'discount_value', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER discount_type');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'invoice_type', 'VARCHAR(24) NOT NULL DEFAULT "walk_in" AFTER invoice_number');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'sale_type', 'VARCHAR(24) NOT NULL DEFAULT "Walk In" AFTER invoice_type');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'customer_address', 'VARCHAR(255) NOT NULL DEFAULT "" AFTER customer_email');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'shipping_cost', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER tax');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoices', 'analytics_visible', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER item_count');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoice_items', 'discount_rate', 'DECIMAL(6,2) NOT NULL DEFAULT 0.00 AFTER quantity');
    jg_store_ops_sku_ensure_column($pdo, 'store_ops_walkin_invoice_items', 'discount_total', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER discount_rate');
}

function jg_store_ops_walkins_normalize_invoice_type(mixed $value): string
{
    $normalized = strtolower(trim((string) $value));
    $normalized = str_replace(['-', ' '], '_', $normalized);
    if (in_array($normalized, ['wa', 'whatsapp', 'whatsapp_order', 'whatsapp_orders'], true)) {
        return 'whatsapp';
    }

    return 'walk_in';
}

function jg_store_ops_walkins_invoice_prefix(string $invoiceType): string
{
    return $invoiceType === 'whatsapp' ? 'WA' : 'WI';
}

function jg_store_ops_walkins_invoice_number(string $invoiceType = 'walk_in'): string
{
    return jg_store_ops_walkins_invoice_prefix(jg_store_ops_walkins_normalize_invoice_type($invoiceType))
        . gmdate('ymd')
        . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
}

function jg_store_ops_walkins_normalize_invoice_number(string $value): string
{
    $normalized = strtoupper(trim($value));
    $normalized = preg_replace('/[^A-Z0-9-]+/', '', $normalized) ?? '';
    return substr($normalized, 0, 40);
}

function jg_store_ops_walkins_normalize_sale_type(string $invoiceType, mixed $value): string
{
    return $invoiceType === 'whatsapp' ? 'Whatsapp' : 'Walk In';
}

function jg_store_ops_walkins_invoice_label(string $invoiceType, string $saleType): string
{
    if ($invoiceType !== 'whatsapp') {
        return 'Walk In';
    }

    return match ($saleType) {
        'Website' => 'Whatsapp (from site)',
        'Partner' => 'Whatsapp (from partner)',
        default => 'Whatsapp',
    };
}

function jg_store_ops_walkins_analytics_included(array $invoice): bool
{
    if ((int) ($invoice['analytics_visible'] ?? 1) !== 1) {
        return false;
    }

    $invoiceType = jg_store_ops_walkins_normalize_invoice_type($invoice['invoice_type'] ?? 'walk_in');
    if ($invoiceType === 'walk_in') {
        return true;
    }

    return (string) ($invoice['sale_type'] ?? '') === 'Whatsapp';
}

function jg_store_ops_walkins_string(mixed $value, int $maxLength): string
{
    $normalized = trim(preg_replace('/\s+/', ' ', (string) $value) ?? '');
    return substr($normalized, 0, $maxLength);
}

function jg_store_ops_walkins_money(mixed $value): string
{
    if ($value === '' || $value === null || !is_numeric($value)) {
        return '0.00';
    }

    return number_format(max(0, round((float) $value, 2)), 2, '.', '');
}

function jg_store_ops_walkins_shipping_cost(string $invoiceType, array $payload): string
{
    if ($invoiceType !== 'whatsapp') {
        return '0.00';
    }

    if (!array_key_exists('shipping_cost', $payload) || $payload['shipping_cost'] === '' || $payload['shipping_cost'] === null) {
        throw new InvalidArgumentException('Enter a shipping cost before completing this WhatsApp order. Use 0 when shipping is free.');
    }

    $value = $payload['shipping_cost'];
    if (!is_numeric($value) || (float) $value < 0 || (float) $value > 999999999999.99) {
        throw new InvalidArgumentException('Shipping cost must be a valid non-negative rupiah amount.');
    }

    return number_format(round((float) $value, 2), 2, '.', '');
}

function jg_store_ops_walkins_discount_rate(mixed $value): float
{
    if ($value === '' || $value === null || !is_numeric($value)) {
        return 0.0;
    }

    return max(0.0, min(100.0, round((float) $value, 2)));
}

/**
 * Discounts are per SKU now. A page loaded before that change still posts an order discount,
 * and dropping it would save a higher total than the invoice the customer was charged from.
 */
function jg_store_ops_walkins_reject_order_discount(array $payload): void
{
    $discount = is_array($payload['discount'] ?? null) ? $payload['discount'] : [];
    if (trim((string) ($discount['type'] ?? '')) !== '') {
        throw new InvalidArgumentException('Order discounts were replaced by per-product discounts. Reload this page, set the discount on each product, and print the invoice again.');
    }
}

/**
 * @return array{type:string,value:float,total:float}
 */
function jg_store_ops_walkins_order_discount(array $payload, float $eligibleTotal): array
{
    $discount = is_array($payload['discount'] ?? null) ? $payload['discount'] : [];
    $type = strtolower(trim((string) ($discount['type'] ?? '')));
    $rawValue = $discount['value'] ?? null;
    if ($type === '' || $rawValue === '' || $rawValue === null) {
        return ['type' => '', 'value' => 0.0, 'total' => 0.0];
    }
    if (!in_array($type, ['sale_price', 'percentage'], true) || !is_numeric($rawValue)) {
        throw new InvalidArgumentException('Choose a valid sale price or percentage discount.');
    }

    $value = round((float) $rawValue, 2);
    if ($value < 0) {
        throw new InvalidArgumentException('Discount value cannot be negative.');
    }
    $eligibleTotal = round(max(0, $eligibleTotal), 2);
    if ($type === 'percentage') {
        if ($value > 100) {
            throw new InvalidArgumentException('Discount percentage cannot be more than 100%.');
        }
        return ['type' => $type, 'value' => $value, 'total' => round($eligibleTotal * $value / 100, 2)];
    }
    if ($value > $eligibleTotal) {
        throw new InvalidArgumentException('Sale price cannot be more than the current merchandise total.');
    }
    return ['type' => $type, 'value' => $value, 'total' => round($eligibleTotal - $value, 2)];
}

function jg_store_ops_walkins_display_name(array $row): string
{
    $pieces = array_filter([
        (string) ($row['brand_name'] ?? ''),
        (string) ($row['product_name'] ?? ''),
        (string) ($row['flavor_name'] ?? ''),
    ], static fn (string $piece): bool => trim($piece) !== '');

    $size = (float) ($row['astra'] ?? $row['volume'] ?? 0);
    $unit = trim((string) ($row['unit_name'] ?? ''));
    if ($size > 0) {
        $pieces[] = rtrim(rtrim(number_format($size, 2, '.', ''), '0'), '.') . ($unit !== '' ? ' ' . $unit : '');
    } elseif ($unit !== '') {
        $pieces[] = $unit;
    }

    $name = trim(implode(' ', $pieces));
    return $name !== '' ? $name : (string) ($row['sku'] ?? 'SKU');
}

function jg_store_ops_walkins_catalog_row(array $row): array
{
    return [
        'sku' => (string) ($row['sku'] ?? ''),
        'tag' => (string) ($row['tag'] ?? ''),
        'name' => jg_store_ops_walkins_display_name($row),
        'brand_name' => (string) ($row['brand_name'] ?? ''),
        'product_name' => (string) ($row['product_name'] ?? ''),
        'flavor_name' => (string) ($row['flavor_name'] ?? ''),
        'unit_name' => (string) ($row['unit_name'] ?? ''),
        'volume' => number_format((float) ($row['volume'] ?? 0), 1, '.', ''),
        'astra' => number_format((float) ($row['astra'] ?? $row['volume'] ?? 0), 2, '.', ''),
        'sale_price' => number_format((float) ($row['sale_price'] ?? 0), 2, '.', ''),
        'current_stock' => (int) ($row['current_stock'] ?? 0),
        'skip_scan' => (int) ($row['skip_scan'] ?? 0) === 1,
    ];
}

/**
 * @return array<int, array<string, mixed>>
 */
function jg_store_ops_walkins_fetch_catalog(PDO $pdo): array
{
    jg_store_ops_walkins_ensure_schema($pdo);

    $stmt = $pdo->query(
        'SELECT
            s.sku,
            s.tag,
            s.volume,
            s.astra,
            s.current_stock,
            s.skip_scan,
            s.sale_price,
            b.name AS brand_name,
            u.name AS unit_name,
            f.name AS flavor_name,
            p.name AS product_name
        FROM sku_skus s
        INNER JOIN sku_brands b ON b.id = s.brand_id
        INNER JOIN sku_units u ON u.id = s.unit_id
        INNER JOIN sku_flavors f ON f.id = s.flavor_id
        INNER JOIN sku_products p ON p.id = s.product_id
        ORDER BY b.name, p.name, f.name, s.astra, s.sku'
    );

    return array_map('jg_store_ops_walkins_catalog_row', $stmt->fetchAll());
}

/**
 * @return array<int, array<string, mixed>>
 */
function jg_store_ops_walkins_invoice_row(array $row): array
{
    $invoiceType = jg_store_ops_walkins_normalize_invoice_type($row['invoice_type'] ?? 'walk_in');
    $saleType = (string) ($row['sale_type'] ?? ($invoiceType === 'whatsapp' ? 'Whatsapp' : 'Walk In'));
    $invoice = [
        'invoice_number' => (string) ($row['invoice_number'] ?? ''),
        'invoice_type' => $invoiceType,
        'sale_type' => $saleType,
        'invoice_label' => jg_store_ops_walkins_invoice_label($invoiceType, $saleType),
        'customer_name' => (string) ($row['customer_name'] ?? ''),
        'customer_phone' => (string) ($row['customer_phone'] ?? ''),
        'customer_email' => (string) ($row['customer_email'] ?? ''),
        'customer_address' => (string) ($row['customer_address'] ?? ''),
        'payment_method' => (string) ($row['payment_method'] ?? ''),
        'subtotal' => number_format((float) ($row['subtotal'] ?? 0), 2, '.', ''),
        'discount_total' => number_format((float) ($row['discount_total'] ?? 0), 2, '.', ''),
        'discount_type' => (string) ($row['discount_type'] ?? ''),
        'discount_value' => number_format((float) ($row['discount_value'] ?? 0), 2, '.', ''),
        'tax' => number_format((float) ($row['tax'] ?? 0), 2, '.', ''),
        'shipping_cost' => number_format((float) ($row['shipping_cost'] ?? 0), 2, '.', ''),
        'total' => number_format((float) ($row['total'] ?? 0), 2, '.', ''),
        'item_count' => (int) ($row['item_count'] ?? 0),
        'analytics_visible' => (int) ($row['analytics_visible'] ?? 1) === 1,
        'created_by' => (string) ($row['created_by'] ?? ''),
        'created_at' => (string) ($row['created_at'] ?? ''),
    ];
    $invoice['analytics_included'] = jg_store_ops_walkins_analytics_included($invoice);

    return $invoice;
}

/**
 * @return array<int, array<string, mixed>>
 */
function jg_store_ops_walkins_recent(PDO $pdo, int $limit = 12, string $invoiceType = ''): array
{
    jg_store_ops_walkins_ensure_schema($pdo);
    $limit = max(1, min(50, $limit));
    $invoiceType = $invoiceType !== '' ? jg_store_ops_walkins_normalize_invoice_type($invoiceType) : '';
    $where = $invoiceType !== '' ? 'WHERE invoice_type = :invoice_type' : '';
    $stmt = $pdo->prepare(
        sprintf(
            'SELECT invoice_number, invoice_type, sale_type, customer_name, customer_phone, customer_email,
                customer_address, payment_method, subtotal, discount_total, discount_type, discount_value, tax, shipping_cost, total, item_count,
                analytics_visible, created_by, created_at
             FROM store_ops_walkin_invoices
             %s
             ORDER BY created_at DESC, invoice_number DESC
             LIMIT %d',
            $where,
            $limit
        )
    );
    $stmt->execute($invoiceType !== '' ? [':invoice_type' => $invoiceType] : []);

    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        $rows[] = jg_store_ops_walkins_invoice_row($row);
    }

    return $rows;
}

/**
 * @return array<int, array<string, mixed>>
 */
function jg_store_ops_walkins_records(PDO $pdo, int $limit = 500): array
{
    jg_store_ops_walkins_ensure_schema($pdo);
    $limit = max(1, min(1000, $limit));
    $stmt = $pdo->query(
        'SELECT invoice_number, invoice_type, sale_type, customer_name, customer_phone, customer_email,
            customer_address, payment_method, subtotal, discount_total, discount_type, discount_value, tax, shipping_cost, total, item_count,
            analytics_visible, created_by, created_at
         FROM store_ops_walkin_invoices
         ORDER BY created_at DESC, invoice_number DESC
         LIMIT ' . $limit
    );

    return array_map('jg_store_ops_walkins_invoice_row', $stmt->fetchAll());
}

/**
 * @return array{invoice:array<string,mixed>,items:array<int,array<string,mixed>>}|null
 */
function jg_store_ops_walkins_find_invoice(PDO $pdo, string $invoiceNumber): ?array
{
    jg_store_ops_walkins_ensure_schema($pdo);
    $invoiceNumber = jg_store_ops_walkins_normalize_invoice_number($invoiceNumber);
    if ($invoiceNumber === '') {
        return null;
    }

    $invoiceStmt = $pdo->prepare(
        'SELECT invoice_number, invoice_type, sale_type, customer_name, customer_phone, customer_email,
            customer_address, payment_method, subtotal, discount_total, discount_type, discount_value, tax, shipping_cost, total, item_count,
            analytics_visible, created_by, created_at
         FROM store_ops_walkin_invoices
         WHERE invoice_number = :invoice_number
         LIMIT 1'
    );
    $invoiceStmt->execute([':invoice_number' => $invoiceNumber]);
    $invoiceRow = $invoiceStmt->fetch();
    if (!is_array($invoiceRow)) {
        return null;
    }

    $itemsStmt = $pdo->prepare(
        'SELECT sku, tag, product_name, unit_price, quantity, discount_rate, discount_total,
            line_total, scanned, skip_scan, created_at
         FROM store_ops_walkin_invoice_items
         WHERE invoice_number = :invoice_number
         ORDER BY id ASC'
    );
    $itemsStmt->execute([':invoice_number' => $invoiceNumber]);
    $items = array_map(static function (array $row): array {
        return [
            'sku' => (string) ($row['sku'] ?? ''),
            'tag' => (string) ($row['tag'] ?? ''),
            'name' => (string) ($row['product_name'] ?? ''),
            'sale_price' => number_format((float) ($row['unit_price'] ?? 0), 2, '.', ''),
            'qty' => (int) ($row['quantity'] ?? 0),
            'discount_rate' => number_format((float) ($row['discount_rate'] ?? 0), 2, '.', ''),
            'discount_total' => number_format((float) ($row['discount_total'] ?? 0), 2, '.', ''),
            'line_total' => number_format((float) ($row['line_total'] ?? 0), 2, '.', ''),
            'scanned' => (int) ($row['scanned'] ?? 0) === 1,
            'skip_scan' => (int) ($row['skip_scan'] ?? 0) === 1,
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }, $itemsStmt->fetchAll());

    return [
        'invoice' => jg_store_ops_walkins_invoice_row($invoiceRow),
        'items' => $items,
    ];
}

function jg_store_ops_walkins_set_analytics_visible(PDO $pdo, string $invoiceNumber, bool $visible): array
{
    jg_store_ops_walkins_ensure_schema($pdo);
    $invoiceNumber = jg_store_ops_walkins_normalize_invoice_number($invoiceNumber);
    if ($invoiceNumber === '') {
        throw new InvalidArgumentException('Invoice number is required.');
    }

    $stmt = $pdo->prepare(
        'UPDATE store_ops_walkin_invoices
         SET analytics_visible = :analytics_visible
         WHERE invoice_number = :invoice_number'
    );
    $stmt->execute([
        ':analytics_visible' => $visible ? 1 : 0,
        ':invoice_number' => $invoiceNumber,
    ]);
    $invoice = jg_store_ops_walkins_find_invoice($pdo, $invoiceNumber);
    if ($invoice === null) {
        throw new InvalidArgumentException('Invoice was not found.');
    }

    return $invoice['invoice'];
}

function jg_store_ops_walkins_sales_summary(PDO $pdo): array
{
    jg_store_ops_walkins_ensure_schema($pdo);
    $stmt = $pdo->query(
        'SELECT invoice_number, invoice_type, sale_type, customer_name, customer_phone, customer_email,
            customer_address, payment_method, subtotal, discount_total, discount_type, discount_value, tax, shipping_cost, total, item_count,
            analytics_visible, created_by, created_at
         FROM store_ops_walkin_invoices'
    );
    $records = array_map('jg_store_ops_walkins_invoice_row', $stmt->fetchAll());
    $summary = [
        'orders' => 0,
        'revenue' => '0.00',
        'item_count' => 0,
        'hidden' => 0,
        'excluded_by_type' => 0,
    ];
    $revenue = 0.0;
    foreach ($records as $invoice) {
        if (!$invoice['analytics_visible']) {
            $summary['hidden']++;
            continue;
        }
        if (!$invoice['analytics_included']) {
            $summary['excluded_by_type']++;
            continue;
        }
        $summary['orders']++;
        $summary['item_count'] += (int) ($invoice['item_count'] ?? 0);
        $revenue += (float) ($invoice['total'] ?? 0);
    }
    $summary['revenue'] = number_format($revenue, 2, '.', '');

    return $summary;
}

/**
 * @return array{invoice:array<string,mixed>,items:array<int,array<string,mixed>>}
 */
function jg_store_ops_walkins_complete_sale(PDO $pdo, array $payload, string $createdBy): array
{
    jg_store_ops_walkins_ensure_schema($pdo);

    $items = $payload['items'] ?? [];
    if (!is_array($items) || $items === []) {
        throw new InvalidArgumentException('Add at least one product before completing the sale.');
    }

    jg_store_ops_walkins_reject_order_discount($payload);
    $invoiceType = jg_store_ops_walkins_normalize_invoice_type($payload['invoice_type'] ?? $payload['order_type'] ?? 'walk_in');
    $saleType = jg_store_ops_walkins_normalize_sale_type($invoiceType, $payload['sale_type'] ?? '');
    $shippingCost = jg_store_ops_walkins_shipping_cost($invoiceType, $payload);
    $invoiceNumber = jg_store_ops_walkins_normalize_invoice_number((string) ($payload['invoice_number'] ?? ''));
    if ($invoiceNumber === '') {
        $invoiceNumber = jg_store_ops_walkins_invoice_number($invoiceType);
    }

    $customer = is_array($payload['customer'] ?? null) ? $payload['customer'] : [];
    $customerName = jg_store_ops_walkins_string($customer['full_name'] ?? $customer['fullName'] ?? '', 160);
    $customerPhone = jg_store_ops_walkins_string($customer['phone'] ?? '', 80);
    $customerEmail = jg_store_ops_walkins_string($customer['email'] ?? '', 160);
    $customerAddress = jg_store_ops_walkins_string($customer['address'] ?? '', 255);
    $paymentMethod = jg_store_ops_walkins_string($payload['payment_method'] ?? 'Cash', 40);
    if (!in_array($paymentMethod, ['Cash', 'Card', 'Transfer', 'QRIS'], true)) {
        $paymentMethod = 'Cash';
    }

    $requestedItems = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        $sku = strtoupper(trim((string) ($item['sku'] ?? '')));
        $quantity = (int) ($item['qty'] ?? $item['quantity'] ?? 0);
        $discountRate = jg_store_ops_walkins_discount_rate($item['discount_rate'] ?? $item['discountRate'] ?? 0);
        if ($sku === '' || $quantity < 1) {
            continue;
        }
        $requestedItems[$sku] = [
            'sku' => $sku,
            'quantity' => ($requestedItems[$sku]['quantity'] ?? 0) + min($quantity, 999),
            'discount_rate' => max((float) ($requestedItems[$sku]['discount_rate'] ?? 0), $discountRate),
            'scanned' => !empty($item['scanned']),
        ];
    }

    if ($requestedItems === []) {
        throw new InvalidArgumentException('No valid products were submitted.');
    }

    $now = jg_store_ops_walkins_now();
    $savedItems = [];
    $subtotal = 0.0;
    $discountTotal = 0.0;
    $itemCount = 0;

    $pdo->beginTransaction();
    try {
        $duplicateStmt = $pdo->prepare('SELECT COUNT(*) FROM store_ops_walkin_invoices WHERE invoice_number = :invoice_number');
        $duplicateStmt->execute([':invoice_number' => $invoiceNumber]);
        if ((int) $duplicateStmt->fetchColumn() > 0) {
            throw new InvalidArgumentException('This invoice number already exists. Start a new invoice and try again.');
        }

        $selectSku = $pdo->prepare(
            'SELECT
                s.sku,
                s.tag,
                s.volume,
                s.astra,
                s.current_stock,
                s.skip_scan,
                s.sale_price,
                b.name AS brand_name,
                u.name AS unit_name,
                f.name AS flavor_name,
                p.name AS product_name
             FROM sku_skus s
             INNER JOIN sku_brands b ON b.id = s.brand_id
             INNER JOIN sku_units u ON u.id = s.unit_id
             INNER JOIN sku_flavors f ON f.id = s.flavor_id
             INNER JOIN sku_products p ON p.id = s.product_id
             WHERE s.sku = :sku
             LIMIT 1
             FOR UPDATE'
        );
        $insertItem = $pdo->prepare(
            'INSERT INTO store_ops_walkin_invoice_items (
                invoice_number, sku, tag, product_name, unit_price, quantity, discount_rate, discount_total, line_total,
                scanned, skip_scan, created_at
             ) VALUES (
                :invoice_number, :sku, :tag, :product_name, :unit_price, :quantity, :discount_rate, :discount_total, :line_total,
                :scanned, :skip_scan, :created_at
             )'
        );

        jg_store_ops_astra_apply_deduction($pdo, array_values($requestedItems), $now);

        foreach ($requestedItems as $requestedItem) {
            $selectSku->execute([':sku' => $requestedItem['sku']]);
            $row = $selectSku->fetch();
            if (!$row) {
                throw new InvalidArgumentException(sprintf('SKU %s was not found in the live SKU database.', $requestedItem['sku']));
            }

            $quantity = (int) $requestedItem['quantity'];
            $unitPrice = (float) ($row['sale_price'] ?? 0);
            $discountRate = jg_store_ops_walkins_discount_rate($requestedItem['discount_rate'] ?? 0);
            $grossLineTotal = round($unitPrice * $quantity, 2);
            $lineDiscount = round($grossLineTotal * ($discountRate / 100), 2);
            $lineTotal = round(max(0, $grossLineTotal - $lineDiscount), 2);
            $skipScan = (int) ($row['skip_scan'] ?? 0) === 1;
            $name = jg_store_ops_walkins_display_name($row);

            $subtotal += $grossLineTotal;
            $discountTotal += $lineDiscount;
            $itemCount += $quantity;
            $savedItems[] = [
                'sku' => (string) $row['sku'],
                'tag' => (string) ($row['tag'] ?? ''),
                'name' => $name,
                'sale_price' => number_format($unitPrice, 2, '.', ''),
                'qty' => $quantity,
                'discount_rate' => number_format($discountRate, 2, '.', ''),
                'discount_total' => number_format($lineDiscount, 2, '.', ''),
                'line_total' => number_format($lineTotal, 2, '.', ''),
                'scanned' => $requestedItem['scanned'],
                'skip_scan' => $skipScan,
            ];
        }
                $catalogDiscountTotal = $discountTotal;
        $manualDiscount = [
            'type' => '',
            'value' => 0.0,
            'total' => 0.0,
        ];
        $discountTotal = round($catalogDiscountTotal, 2);
        $tax = 0.0;
        $total = round($subtotal - $discountTotal + $tax + (float) $shippingCost, 2);
        $insertInvoice = $pdo->prepare(
            'INSERT INTO store_ops_walkin_invoices (
                invoice_number, invoice_type, sale_type, customer_name, customer_phone, customer_email,
                customer_address, payment_method, subtotal, discount_total, discount_type, discount_value, tax, shipping_cost, total, item_count,
                analytics_visible, created_by, created_at
             ) VALUES (
                :invoice_number, :invoice_type, :sale_type, :customer_name, :customer_phone, :customer_email,
                :customer_address, :payment_method, :subtotal, :discount_total, :discount_type, :discount_value, :tax, :shipping_cost, :total, :item_count,
                1, :created_by, :created_at
             )'
        );
        $insertInvoice->execute([
            ':invoice_number' => $invoiceNumber,
            ':invoice_type' => $invoiceType,
            ':sale_type' => $saleType,
            ':customer_name' => $customerName,
            ':customer_phone' => $customerPhone,
            ':customer_email' => $customerEmail,
            ':customer_address' => $customerAddress,
            ':payment_method' => $paymentMethod,
            ':subtotal' => number_format($subtotal, 2, '.', ''),
            ':discount_total' => number_format($discountTotal, 2, '.', ''),
            ':discount_type' => $manualDiscount['type'],
            ':discount_value' => number_format($manualDiscount['value'], 2, '.', ''),
            ':tax' => number_format($tax, 2, '.', ''),
            ':shipping_cost' => $shippingCost,
            ':total' => number_format($total, 2, '.', ''),
            ':item_count' => $itemCount,
            ':created_by' => $createdBy,
            ':created_at' => $now,
        ]);

        foreach ($savedItems as $savedItem) {
            $insertItem->execute([
                ':invoice_number' => $invoiceNumber,
                ':sku' => $savedItem['sku'],
                ':tag' => $savedItem['tag'],
                ':product_name' => $savedItem['name'],
                ':unit_price' => $savedItem['sale_price'],
                ':quantity' => $savedItem['qty'],
                ':discount_rate' => $savedItem['discount_rate'],
                ':discount_total' => $savedItem['discount_total'],
                ':line_total' => $savedItem['line_total'],
                ':scanned' => $savedItem['scanned'] ? 1 : 0,
                ':skip_scan' => $savedItem['skip_scan'] ? 1 : 0,
                ':created_at' => $now,
            ]);
        }

        $pdo->commit();

        return [
            'invoice' => [
                'invoice_number' => $invoiceNumber,
                'invoice_type' => $invoiceType,
                'sale_type' => $saleType,
                'invoice_label' => jg_store_ops_walkins_invoice_label($invoiceType, $saleType),
                'customer_name' => $customerName,
                'customer_phone' => $customerPhone,
                'customer_email' => $customerEmail,
                'customer_address' => $customerAddress,
                'payment_method' => $paymentMethod,
                'subtotal' => number_format($subtotal, 2, '.', ''),
                'discount_total' => number_format($discountTotal, 2, '.', ''),
                'discount_type' => $manualDiscount['type'],
                'discount_value' => number_format($manualDiscount['value'], 2, '.', ''),
                'tax' => number_format($tax, 2, '.', ''),
                'shipping_cost' => $shippingCost,
                'total' => number_format($total, 2, '.', ''),
                'item_count' => $itemCount,
                'analytics_visible' => true,
                'analytics_included' => $invoiceType === 'walk_in' || $saleType === 'Whatsapp',
                'created_by' => $createdBy,
                'created_at' => $now,
            ],
            'items' => $savedItems,
        ];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}
