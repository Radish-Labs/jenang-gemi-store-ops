<?php
declare(strict_types=1);

// A browser cache is not a reliable transport between the board, scan and print
// tabs. Keep the normalized picking snapshot in the authenticated session. This
// is transport only: claim, scan and completion permissions still use the DB.
const JG_STORE_OPS_SCAN_HANDOFF_TTL = 12 * 60 * 60;
const JG_STORE_OPS_SCAN_HANDOFF_LIMIT = 32;

function jg_store_ops_scan_handoff_prepare(mixed $order, array $key): array
{
    if (!is_array($order) || !is_array($order['items'] ?? null) || $order['items'] === []) {
        throw new InvalidArgumentException('Order details are missing. Refresh the board and start the order again.');
    }
    $orderKey = jg_store_ops_fulfillment_key_from_order($order);
    foreach (['order_id', 'source_platform', 'source_account'] as $field) {
        if ($orderKey[$field] !== $key[$field]) {
            throw new InvalidArgumentException('Order details do not match the selected order. Refresh the board.');
        }
    }
    $encoded = json_encode($order);
    if (!is_string($encoded) || strlen($encoded) > 262144) {
        throw new InvalidArgumentException('Order details are too large to open for scanning.');
    }
    foreach ($order['items'] as $item) {
        if (!is_array($item)) throw new InvalidArgumentException('Order item details are invalid.');
    }
    return $order;
}

function jg_store_ops_scan_handoff_save(array $order, array $key, string $employeeId): string
{
    $entries = $_SESSION['jg_scan_handoffs'] ?? [];
    $entries = array_filter(is_array($entries) ? $entries : [], static fn ($entry): bool =>
        is_array($entry) && (int) ($entry['expires_at'] ?? 0) > time()
    );
    // Refreshing/restarting the same order should not evict other active tabs.
    foreach ($entries as $token => $entry) {
        if ($entry['key'] === $key && $entry['employee_id'] === $employeeId) {
            $entries[$token] = ['key' => $key, 'employee_id' => $employeeId, 'order' => $order,
                'expires_at' => time() + JG_STORE_OPS_SCAN_HANDOFF_TTL];
            $_SESSION['jg_scan_handoffs'] = $entries;
            return (string) $token;
        }
    }
    $token = bin2hex(random_bytes(24));
    $entries[$token] = ['key' => $key, 'employee_id' => $employeeId, 'order' => $order,
        'expires_at' => time() + JG_STORE_OPS_SCAN_HANDOFF_TTL];
    $_SESSION['jg_scan_handoffs'] = array_slice($entries, -JG_STORE_OPS_SCAN_HANDOFF_LIMIT, null, true);
    return $token;
}

function jg_store_ops_scan_handoff_read(string $token, string $orderId, string $employeeId): ?array
{
    $entry = $_SESSION['jg_scan_handoffs'][$token] ?? null;
    if (!is_array($entry) || (int) ($entry['expires_at'] ?? 0) <= time()
        || ($entry['employee_id'] ?? '') !== $employeeId
        || ($entry['key']['order_id'] ?? '') !== $orderId) {
        return null;
    }
    return $entry;
}
