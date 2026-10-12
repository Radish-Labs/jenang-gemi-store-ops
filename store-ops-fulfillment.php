<?php
declare(strict_types=1);

require_once __DIR__ . '/sku-db-bootstrap.php';

const JG_STORE_OPS_CLAIM_STALE_SECONDS = 1800;

function jg_store_ops_fulfillment_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function jg_store_ops_fulfillment_ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_employees_v2 (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            display_name VARCHAR(120) NOT NULL,
            pin_hash VARCHAR(255) NOT NULL,
            active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            KEY idx_store_ops_employees_v2_active (active, display_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_employee_preferences_v1 (
            employee_id VARCHAR(64) NOT NULL PRIMARY KEY,
            source_colors_json LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            KEY idx_store_ops_employee_preferences_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_order_fulfillment_v2 (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            source_platform VARCHAR(32) NOT NULL,
            source_account VARCHAR(96) NOT NULL DEFAULT "",
            order_id VARCHAR(96) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT "UNCLAIMED",
            claimed_by VARCHAR(64) NULL DEFAULT NULL,
            claimed_at DATETIME NULL DEFAULT NULL,
            last_activity_at DATETIME NULL DEFAULT NULL,
            scan_completed_at DATETIME NULL DEFAULT NULL,
            label_printed_at DATETIME NULL DEFAULT NULL,
            fulfilled_at DATETIME NULL DEFAULT NULL,
            scan_required INT UNSIGNED NOT NULL DEFAULT 0,
            scan_completed INT UNSIGNED NOT NULL DEFAULT 0,
            items_json LONGTEXT NULL DEFAULT NULL,
            customer_name VARCHAR(160) NOT NULL DEFAULT "",
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            UNIQUE KEY uniq_store_ops_order (source_platform, source_account, order_id),
            KEY idx_store_ops_fulfillment_status_activity (status, last_activity_at),
            KEY idx_store_ops_fulfillment_claimed_by (claimed_by, last_activity_at),
            KEY idx_store_ops_fulfillment_fulfilled_at (fulfilled_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_order_events_v2 (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            source_platform VARCHAR(32) NOT NULL,
            source_account VARCHAR(96) NOT NULL DEFAULT "",
            order_id VARCHAR(96) NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            employee_id VARCHAR(64) NULL DEFAULT NULL,
            employee_name VARCHAR(120) NOT NULL DEFAULT "",
            sku VARCHAR(64) NOT NULL DEFAULT "",
            quantity DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            progress_scanned INT UNSIGNED NOT NULL DEFAULT 0,
            progress_required INT UNSIGNED NOT NULL DEFAULT 0,
            message VARCHAR(255) NOT NULL DEFAULT "",
            payload_json LONGTEXT NULL DEFAULT NULL,
            created_at DATETIME NOT NULL,
            KEY idx_store_ops_events_created (created_at),
            KEY idx_store_ops_events_employee_created (employee_id, created_at),
            KEY idx_store_ops_events_order (source_platform, source_account, order_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_employees_v2', 'pin_hash', 'VARCHAR(255) NOT NULL DEFAULT "" AFTER display_name');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_employees_v2', 'active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER pin_hash');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_employees_v2', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER active');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_employees_v2', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at');

    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'source_account', 'VARCHAR(96) NOT NULL DEFAULT "" AFTER source_platform');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'claimed_by', 'VARCHAR(64) NULL DEFAULT NULL AFTER status');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'claimed_at', 'DATETIME NULL DEFAULT NULL AFTER claimed_by');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'last_activity_at', 'DATETIME NULL DEFAULT NULL AFTER claimed_at');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'scan_completed_at', 'DATETIME NULL DEFAULT NULL AFTER last_activity_at');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'label_printed_at', 'DATETIME NULL DEFAULT NULL AFTER scan_completed_at');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'fulfilled_at', 'DATETIME NULL DEFAULT NULL AFTER label_printed_at');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'scan_required', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER fulfilled_at');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'scan_completed', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER scan_required');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'items_json', 'LONGTEXT NULL DEFAULT NULL AFTER scan_completed');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'customer_name', 'VARCHAR(160) NOT NULL DEFAULT "" AFTER items_json');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER customer_name');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_fulfillment_v2', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_at');

    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'source_account', 'VARCHAR(96) NOT NULL DEFAULT "" AFTER source_platform');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'employee_id', 'VARCHAR(64) NULL DEFAULT NULL AFTER event_type');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'employee_name', 'VARCHAR(120) NOT NULL DEFAULT "" AFTER employee_id');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'sku', 'VARCHAR(64) NOT NULL DEFAULT "" AFTER employee_name');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'quantity', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER sku');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'progress_scanned', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER quantity');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'progress_required', 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER progress_scanned');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'message', 'VARCHAR(255) NOT NULL DEFAULT "" AFTER progress_required');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'payload_json', 'LONGTEXT NULL DEFAULT NULL AFTER message');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_order_events_v2', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER payload_json');
}

function jg_store_ops_fulfillment_ensure_column(PDO $pdo, string $tableName, string $columnName, string $definition): void
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name
           AND COLUMN_NAME = :column_name'
    );
    $stmt->execute([
        ':table_name' => $tableName,
        ':column_name' => $columnName,
    ]);

    if ((int) $stmt->fetchColumn() === 0) {
        $pdo->exec(sprintf('ALTER TABLE `%s` ADD COLUMN `%s` %s', $tableName, $columnName, $definition));
    }
}

function jg_store_ops_fulfillment_db(): PDO
{
    $pdo = jg_store_ops_sku_db();
    jg_store_ops_fulfillment_ensure_schema($pdo);
    return $pdo;
}

function jg_store_ops_fulfillment_normalize_key_part(string $value, int $maxLength = 96): string
{
    $normalized = trim(strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', $value)), '.-_');
    return substr($normalized, 0, $maxLength);
}

function jg_store_ops_fulfillment_source_account_from_order(array $order): string
{
    $platform = jg_store_ops_fulfillment_normalize_key_part((string) ($order['platform'] ?? ''), 32);
    $accountKey = jg_store_ops_fulfillment_normalize_key_part((string) ($order['sourceAccountKey'] ?? $order['account_key'] ?? ''), 96);
    if ($accountKey !== '') {
        return $accountKey;
    }

    if ($platform === 'partner') {
        $partnerCode = jg_store_ops_fulfillment_normalize_key_part((string) ($order['partnerCode'] ?? $order['partner_code'] ?? $order['account'] ?? ''), 80);
        return 'partner-' . ($partnerCode !== '' ? $partnerCode : 'unknown');
    }

    $account = jg_store_ops_fulfillment_normalize_key_part((string) ($order['account'] ?? ''), 96);
    return $account !== '' ? $account : 'default';
}

/**
 * @return array{source_platform:string,source_account:string,order_id:string}
 */
function jg_store_ops_fulfillment_key_from_order(array $order): array
{
    $platform = jg_store_ops_fulfillment_normalize_key_part((string) ($order['platform'] ?? ''), 32);
    if ($platform === '') {
        $orderId = strtoupper(trim((string) ($order['id'] ?? $order['order_id'] ?? '')));
        $platform = str_starts_with($orderId, 'PARTNER-') ? 'partner' : 'shopee';
    }

    return [
        'source_platform' => $platform,
        'source_account' => jg_store_ops_fulfillment_source_account_from_order($order),
        'order_id' => trim((string) ($order['id'] ?? $order['order_id'] ?? '')),
    ];
}

/**
 * @return array{source_platform:string,source_account:string,order_id:string,package_id:string}
 */
function jg_store_ops_fulfillment_key_from_payload(array $payload): array
{
    $orderId = trim((string) ($payload['order_id'] ?? $payload['order'] ?? ''));
    $platform = jg_store_ops_fulfillment_normalize_key_part((string) ($payload['source_platform'] ?? $payload['platform'] ?? ''), 32);
    if ($platform === '') {
        $platform = str_starts_with(strtoupper($orderId), 'PARTNER-') ? 'partner' : 'shopee';
    }

    $sourceAccount = jg_store_ops_fulfillment_normalize_key_part((string) ($payload['source_account'] ?? $payload['account'] ?? ''), 96);
    if ($sourceAccount === '') {
        $sourceAccount = $platform === 'partner' ? 'partner-unknown' : 'default';
    }

    return [
        'source_platform' => $platform,
        'source_account' => $sourceAccount,
        'order_id' => $orderId,
        'package_id' => trim((string) ($payload['package_id'] ?? $payload['package'] ?? '')),
    ];
}

function jg_store_ops_fulfillment_validate_key(array $key): void
{
    if (($key['order_id'] ?? '') === '') {
        throw new RuntimeException('Order number is required.');
    }
    if (($key['source_platform'] ?? '') === '') {
        throw new RuntimeException('Order source is required.');
    }
}

function jg_store_ops_fulfillment_is_stale(?array $row): bool
{
    if (!is_array($row) || trim((string) ($row['claimed_by'] ?? '')) === '') {
        return false;
    }
    if (strtoupper((string) ($row['status'] ?? '')) === 'FULFILLED') {
        return false;
    }

    $activity = trim((string) ($row['last_activity_at'] ?? $row['claimed_at'] ?? ''));
    if ($activity === '') {
        return true;
    }

    $timestamp = strtotime($activity . ' UTC');
    return $timestamp === false || $timestamp < time() - JG_STORE_OPS_CLAIM_STALE_SECONDS;
}

function jg_store_ops_fulfillment_is_admin_employee(string $employeeId): bool
{
    return in_array(strtolower(trim($employeeId)), ['admin', 'shared-admin'], true);
}

function jg_store_ops_fulfillment_is_terminal_status(string $status): bool
{
    return in_array(strtoupper(trim($status)), ['FULFILLED', 'CANCELLED'], true);
}

function jg_store_ops_fulfillment_employee_name(PDO $pdo, string $employeeId): string
{
    $employeeId = trim($employeeId);
    if ($employeeId === '') {
        return '';
    }

    try {
        $stmt = $pdo->prepare('SELECT display_name FROM store_ops_employees_v2 WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $employeeId]);
        $name = trim((string) $stmt->fetchColumn());
        if ($name !== '') {
            return $name;
        }
    } catch (Throwable) {
        return $employeeId;
    }

    return $employeeId === 'shared-admin' ? 'Admin' : $employeeId;
}

/**
 * @return array<string, string>
 */
function jg_store_ops_fulfillment_employee_map(PDO $pdo): array
{
    try {
        $rows = $pdo->query('SELECT id, display_name FROM store_ops_employees_v2')->fetchAll();
    } catch (Throwable) {
        return [];
    }

    $employees = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $employees[$id] = trim((string) ($row['display_name'] ?? $id)) ?: $id;
    }
    $employees['shared-admin'] = $employees['shared-admin'] ?? 'Admin';
    return $employees;
}

/**
 * @return array<int, array{id:string,display_name:string,active:int}>
 */
function jg_store_ops_fulfillment_active_employees(PDO $pdo): array
{
    $stmt = $pdo->query(
        'SELECT id, display_name, active
         FROM store_ops_employees_v2
         WHERE active = 1
         ORDER BY display_name ASC'
    );

    $employees = [];
    foreach ($stmt->fetchAll() as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? ''));
        $displayName = trim((string) ($row['display_name'] ?? ''));
        if ($id === '' || $displayName === '') {
            continue;
        }
        $employees[] = [
            'id' => $id,
            'display_name' => $displayName,
            'active' => (int) ($row['active'] ?? 0),
        ];
    }

    return $employees;
}

function jg_store_ops_fulfillment_insert_order_if_missing(PDO $pdo, array $key): void
{
    jg_store_ops_fulfillment_validate_key($key);
    $now = jg_store_ops_fulfillment_now();
    $stmt = $pdo->prepare(
        'INSERT INTO store_ops_order_fulfillment_v2 (
            source_platform, source_account, order_id, status, created_at, updated_at
        ) VALUES (
            :source_platform, :source_account, :order_id, "UNCLAIMED", :created_at, :updated_at
        )
        ON DUPLICATE KEY UPDATE
            source_account = IF(source_account = "", VALUES(source_account), source_account),
            updated_at = updated_at'
    );
    $stmt->execute([
        ':source_platform' => $key['source_platform'],
        ':source_account' => $key['source_account'],
        ':order_id' => $key['order_id'],
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);
}

function jg_store_ops_fulfillment_fetch_order(PDO $pdo, array $key, bool $forUpdate = false): ?array
{
    $sql = 'SELECT * FROM store_ops_order_fulfillment_v2
            WHERE source_platform = :source_platform
              AND source_account = :source_account
              AND order_id = :order_id
            LIMIT 1';
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':source_platform' => $key['source_platform'],
        ':source_account' => $key['source_account'],
        ':order_id' => $key['order_id'],
    ]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

function jg_store_ops_fulfillment_log_event(PDO $pdo, array $key, string $eventType, string $employeeId, string $employeeName, array $payload = []): void
{
    $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $stmt = $pdo->prepare(
        'INSERT INTO store_ops_order_events_v2 (
            source_platform, source_account, order_id, event_type, employee_id, employee_name,
            sku, quantity, progress_scanned, progress_required, message, payload_json, created_at
        ) VALUES (
            :source_platform, :source_account, :order_id, :event_type, :employee_id, :employee_name,
            :sku, :quantity, :progress_scanned, :progress_required, :message, :payload_json, :created_at
        )'
    );
    $stmt->execute([
        ':source_platform' => $key['source_platform'],
        ':source_account' => $key['source_account'],
        ':order_id' => $key['order_id'],
        ':event_type' => $eventType,
        ':employee_id' => $employeeId !== '' ? $employeeId : null,
        ':employee_name' => $employeeName,
        ':sku' => substr(trim((string) ($payload['sku'] ?? '')), 0, 64),
        ':quantity' => (float) ($payload['quantity'] ?? 0),
        ':progress_scanned' => max(0, (int) ($payload['progress_scanned'] ?? $payload['scanned'] ?? 0)),
        ':progress_required' => max(0, (int) ($payload['progress_required'] ?? $payload['required'] ?? 0)),
        ':message' => substr(trim((string) ($payload['message'] ?? '')), 0, 255),
        ':payload_json' => is_string($encoded) ? $encoded : null,
        ':created_at' => jg_store_ops_fulfillment_now(),
    ]);
}

/**
 * @return array<int, array{sku:string,product_name:string,quantity:float}>
 */
function jg_store_ops_fulfillment_items_snapshot(array $items): array
{
    $snapshot = [];
    foreach (array_slice($items, 0, 500) as $item) {
        if (!is_array($item)) continue;
        $sku = substr(trim((string) ($item['sku'] ?? $item['tag'] ?? $item['source_sku'] ?? '')), 0, 80);
        $name = substr(trim((string) ($item['product_name'] ?? $item['productName'] ?? $item['name'] ?? '')), 0, 240);
        $quantity = (float) ($item['quantity'] ?? $item['qty'] ?? 0);
        if ($quantity <= 0 || ($sku === '' && $name === '')) continue;
        $snapshot[] = [
            'sku' => $sku,
            'product_name' => $name !== '' ? $name : ($sku !== '' ? $sku : 'Order item'),
            'quantity' => min(9999, $quantity),
        ];
    }
    return $snapshot;
}

function jg_store_ops_fulfillment_state_from_row(?array $row, string $currentEmployeeId, array $employeeMap = []): array
{
    if (!is_array($row)) {
        return [
            'fulfillmentStatus' => 'UNCLAIMED',
            'claimedBy' => null,
            'claimedByName' => '',
            'claimedAt' => null,
            'locked' => false,
            'currentEmployeeCanWork' => true,
            'scanProgress' => ['completed' => 0, 'required' => 0, 'percent' => 0],
        ];
    }

    $claimedBy = trim((string) ($row['claimed_by'] ?? ''));
    $status = strtoupper(trim((string) ($row['status'] ?? 'UNCLAIMED'))) ?: 'UNCLAIMED';
    $isStale = jg_store_ops_fulfillment_is_stale($row);
    $isTerminal = jg_store_ops_fulfillment_is_terminal_status($status);
    $isCurrentClaim = $claimedBy !== '' && hash_equals($claimedBy, $currentEmployeeId);
    $isAdmin = jg_store_ops_fulfillment_is_admin_employee($currentEmployeeId);
    $locked = !$isTerminal && $claimedBy !== '' && !$isCurrentClaim && !$isStale && !$isAdmin;
    $required = max(0, (int) ($row['scan_required'] ?? 0));
    $completed = max(0, (int) ($row['scan_completed'] ?? 0));

    return [
        'fulfillmentStatus' => $status,
        'claimedBy' => $claimedBy !== '' ? $claimedBy : null,
        'claimedByName' => $claimedBy !== '' ? ($employeeMap[$claimedBy] ?? $claimedBy) : '',
        'claimedAt' => $row['claimed_at'] ?? null,
        'locked' => $locked,
        'currentEmployeeCanWork' => !$locked && !$isTerminal,
        'claimStale' => $isStale,
        'lastActivityAt' => $row['last_activity_at'] ?? null,
        'scanCompletedAt' => $row['scan_completed_at'] ?? null,
        'labelPrintedAt' => $row['label_printed_at'] ?? null,
        'fulfilledAt' => $row['fulfilled_at'] ?? null,
        'scanProgress' => [
            'completed' => $completed,
            'required' => $required,
            'percent' => $required > 0 ? (int) min(100, round(($completed / $required) * 100)) : 0,
        ],
    ];
}

function jg_store_ops_fulfillment_assert_can_work(?array $row, string $employeeId): void
{
    if (!is_array($row)) {
        throw new RuntimeException('Claim this order before working on it.');
    }

    $status = strtoupper((string) ($row['status'] ?? ''));
    if (jg_store_ops_fulfillment_is_terminal_status($status)) {
        throw new RuntimeException($status === 'CANCELLED'
            ? 'This order was cancelled before fulfillment.'
            : 'This order is already fulfilled.');
    }

    $claimedBy = trim((string) ($row['claimed_by'] ?? ''));
    if ($claimedBy === '') {
        throw new RuntimeException('Claim this order before working on it.');
    }
    if (hash_equals($claimedBy, $employeeId) || jg_store_ops_fulfillment_is_admin_employee($employeeId)) {
        return;
    }

    if (jg_store_ops_fulfillment_is_stale($row)) {
        throw new RuntimeException('This claim is stale. Reclaim the order from the board first.');
    }

    throw new RuntimeException('This order is claimed by another employee.');
}

function jg_store_ops_fulfillment_claim(PDO $pdo, array $key, string $employeeId, string $employeeName): array
{
    $pdo->beginTransaction();
    try {
        jg_store_ops_fulfillment_insert_order_if_missing($pdo, $key);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!is_array($row)) {
            throw new RuntimeException('Unable to claim order.');
        }

        $claimedBy = trim((string) ($row['claimed_by'] ?? ''));
        $status = strtoupper((string) ($row['status'] ?? ''));
        if (
            $claimedBy !== ''
            && !hash_equals($claimedBy, $employeeId)
            && !jg_store_ops_fulfillment_is_admin_employee($employeeId)
            && !jg_store_ops_fulfillment_is_stale($row)
            && $status !== 'FULFILLED'
        ) {
            throw new RuntimeException('This order is already claimed.');
        }

        if (jg_store_ops_fulfillment_is_terminal_status($status)) {
            throw new RuntimeException($status === 'CANCELLED'
                ? 'This order was cancelled before it could be claimed.'
                : 'This order is already fulfilled.');
        }
        if ($key['source_platform'] === 'whatsapp') {
            $sourceStmt = $pdo->prepare(
                'SELECT status FROM store_ops_website_orders
                 WHERE source_platform = "whatsapp" AND order_id = :order_id LIMIT 1'
            );
            $sourceStmt->execute([':order_id' => $key['order_id']]);
            if (strtoupper(trim((string) $sourceStmt->fetchColumn())) === 'QUEUED') {
                throw new RuntimeException('This order was moved back to the Executive queue. Refresh the board.');
            }
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = CASE
                    WHEN status IN ("SCAN_COMPLETED", "LABEL_PRINTED") THEN status
                    ELSE "CLAIMED"
                 END,
                 claimed_by = :claimed_by,
                 claimed_at = CASE WHEN claimed_by IS NULL OR claimed_by <> :claimed_by_again THEN :claimed_at ELSE claimed_at END,
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':claimed_by' => $employeeId,
            ':claimed_by_again' => $employeeId,
            ':claimed_at' => $now,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);

        jg_store_ops_fulfillment_log_event($pdo, $key, $claimedBy !== '' && $claimedBy !== $employeeId ? 'reclaim' : 'claim', $employeeId, $employeeName);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_release(PDO $pdo, array $key, string $employeeId, string $employeeName): array
{
    $pdo->beginTransaction();
    try {
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!is_array($row)) {
            throw new RuntimeException('Order claim was not found.');
        }

        $claimedBy = trim((string) ($row['claimed_by'] ?? ''));
        $status = strtoupper(trim((string) ($row['status'] ?? '')));
        if (jg_store_ops_fulfillment_is_terminal_status($status)) {
            throw new RuntimeException($status === 'CANCELLED'
                ? 'This order was cancelled and cannot be released.'
                : 'This order is already fulfilled.');
        }
        if ($claimedBy !== '' && !hash_equals($claimedBy, $employeeId) && !jg_store_ops_fulfillment_is_admin_employee($employeeId)) {
            throw new RuntimeException('Only the claimant or admin can release this order.');
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = "UNCLAIMED",
                 claimed_by = NULL,
                 claimed_at = NULL,
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id
               AND status NOT IN ("FULFILLED", "CANCELLED")'
        );
        $stmt->execute([
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);
        if ($key['source_platform'] === 'whatsapp') {
            $pdo->prepare(
                'UPDATE store_ops_website_orders SET status = "IS_LISTED", updated_at = :updated_at
                 WHERE source_platform = "whatsapp" AND order_id = :order_id
                   AND status = "IS_BEING_FULFILLED"'
            )->execute([':updated_at' => $now, ':order_id' => $key['order_id']]);
        }
        jg_store_ops_fulfillment_log_event($pdo, $key, 'release', $employeeId, $employeeName);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_record_scan_batch(PDO $pdo, array $key, string $employeeId, string $employeeName, array $events, array $progress = []): array
{
    if ($events === []) {
        return jg_store_ops_fulfillment_fetch_order($pdo, $key, false) ?? [];
    }

    $pdo->beginTransaction();
    try {
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        jg_store_ops_fulfillment_assert_can_work($row, $employeeId);

        $maxScanned = max(0, (int) ($progress['completed'] ?? $progress['scanned'] ?? 0));
        $maxRequired = max(0, (int) ($progress['required'] ?? 0));
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $type = trim((string) ($event['type'] ?? $event['event_type'] ?? 'scan'));
            $type = in_array($type, ['scan', 'scan_error', 'error'], true) ? $type : 'scan';
            $eventPayload = $event;
            $eventPayload['progress_scanned'] = max(0, (int) ($event['progress_scanned'] ?? $event['completed'] ?? $maxScanned));
            $eventPayload['progress_required'] = max(0, (int) ($event['progress_required'] ?? $event['required'] ?? $maxRequired));
            $maxScanned = max($maxScanned, (int) $eventPayload['progress_scanned']);
            $maxRequired = max($maxRequired, (int) $eventPayload['progress_required']);
            jg_store_ops_fulfillment_log_event($pdo, $key, $type, $employeeId, $employeeName, $eventPayload);
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = CASE
                    WHEN status IN ("SCAN_COMPLETED", "LABEL_PRINTED") THEN status
                    ELSE "SCAN_IN_PROGRESS"
                 END,
                 scan_completed = GREATEST(scan_completed, :scan_completed),
                 scan_required = GREATEST(scan_required, :scan_required),
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':scan_completed' => $maxScanned,
            ':scan_required' => $maxRequired,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);

        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_complete_scan(PDO $pdo, array $key, string $employeeId, string $employeeName, array $progress = []): array
{
    $pdo->beginTransaction();
    try {
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        jg_store_ops_fulfillment_assert_can_work($row, $employeeId);
        $completed = max(0, (int) ($progress['completed'] ?? $progress['scanned'] ?? $row['scan_completed'] ?? 0));
        $required = max(0, (int) ($progress['required'] ?? $row['scan_required'] ?? 0));
        if ($required > 0 && $completed < $required) {
            throw new RuntimeException('Scan is not complete yet.');
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = "SCAN_COMPLETED",
                 scan_completed = GREATEST(scan_completed, :scan_completed),
                 scan_required = GREATEST(scan_required, :scan_required),
                 scan_completed_at = COALESCE(scan_completed_at, :scan_completed_at),
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':scan_completed' => $completed,
            ':scan_required' => $required,
            ':scan_completed_at' => $now,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);
        jg_store_ops_fulfillment_log_event($pdo, $key, 'scan_complete', $employeeId, $employeeName, [
            'progress_scanned' => $completed,
            'progress_required' => $required,
        ]);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_mark_label_printed(PDO $pdo, array $key, string $employeeId, string $employeeName, bool $isReprint = false): array
{
    $pdo->beginTransaction();
    try {
        jg_store_ops_fulfillment_insert_order_if_missing($pdo, $key);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!$isReprint && strtoupper((string) ($row['status'] ?? '')) === 'FULFILLED') {
            $pdo->commit();
            return $row;
        }
        if (!$isReprint) {
            jg_store_ops_fulfillment_assert_can_work($row, $employeeId);
            $required = max(0, (int) ($row['scan_required'] ?? 0));
            $completed = max(0, (int) ($row['scan_completed'] ?? 0));
            if ($required > 0 && $completed < $required) {
                throw new RuntimeException('Scan activity must be synced before printing this label.');
            }
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = CASE WHEN :is_reprint = 1 THEN status ELSE "LABEL_PRINTED" END,
                 label_printed_at = CASE WHEN :is_reprint_again = 1 THEN label_printed_at ELSE COALESCE(label_printed_at, :label_printed_at) END,
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':is_reprint' => $isReprint ? 1 : 0,
            ':is_reprint_again' => $isReprint ? 1 : 0,
            ':label_printed_at' => $now,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);
        jg_store_ops_fulfillment_log_event($pdo, $key, $isReprint ? 'reprint' : 'label_print', $employeeId, $employeeName);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_mark_fulfilled(PDO $pdo, array $key, string $employeeId, string $employeeName, array $items = [], string $customerName = ''): array
{
    $pdo->beginTransaction();
    try {
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        $snapshot = jg_store_ops_fulfillment_items_snapshot($items);
        $itemsJson = $snapshot !== [] ? json_encode($snapshot, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null;
        $customerName = mb_substr(trim((string) preg_replace('/\s+/', ' ', $customerName)), 0, 160);
        if (is_array($row) && strtoupper((string) ($row['status'] ?? '')) === 'FULFILLED') {
            $needsItems = is_string($itemsJson) && trim((string) ($row['items_json'] ?? '')) === '';
            $needsCustomer = $customerName !== '' && trim((string) ($row['customer_name'] ?? '')) === '';
            if ($needsItems || $needsCustomer) {
                $stmt = $pdo->prepare(
                    'UPDATE store_ops_order_fulfillment_v2
                     SET items_json = CASE WHEN :items_json_present = 1 THEN :items_json ELSE items_json END,
                         customer_name = CASE WHEN :customer_name_present = 1 THEN :customer_name ELSE customer_name END,
                         updated_at = :updated_at
                     WHERE id = :id'
                );
                $stmt->execute([
                    ':items_json_present' => $needsItems ? 1 : 0,
                    ':items_json' => $itemsJson,
                    ':customer_name_present' => $needsCustomer ? 1 : 0,
                    ':customer_name' => $customerName,
                    ':updated_at' => jg_store_ops_fulfillment_now(),
                    ':id' => (int) $row['id'],
                ]);
                $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
            }
            $pdo->commit();
            return $row;
        }
        jg_store_ops_fulfillment_assert_can_work($row, $employeeId);
        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = "FULFILLED",
                 fulfilled_at = COALESCE(fulfilled_at, :fulfilled_at),
                 items_json = CASE WHEN :items_json_present = 1 THEN :items_json ELSE items_json END,
                 customer_name = CASE WHEN :customer_name_present = 1 THEN :customer_name ELSE customer_name END,
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':fulfilled_at' => $now,
            ':items_json_present' => is_string($itemsJson) ? 1 : 0,
            ':items_json' => $itemsJson,
            ':customer_name_present' => $customerName !== '' ? 1 : 0,
            ':customer_name' => $customerName,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);
        jg_store_ops_fulfillment_log_event($pdo, $key, 'fulfill', $employeeId, $employeeName, [
            'items' => $snapshot,
        ]);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

function jg_store_ops_fulfillment_remove_from_listed(
    PDO $pdo,
    array $key,
    string $employeeId,
    string $employeeName,
    string $stockAction = 'keep',
    bool $stockDeductedNow = false,
    array $skuMappings = []
): array
{
    $pdo->beginTransaction();
    try {
        jg_store_ops_fulfillment_insert_order_if_missing($pdo, $key);
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!is_array($row)) {
            throw new RuntimeException('Unable to remove order from listed orders.');
        }
        if (strtoupper((string) ($row['status'] ?? '')) === 'FULFILLED') {
            $pdo->commit();
            return $row;
        }

        $now = jg_store_ops_fulfillment_now();
        $stmt = $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = "FULFILLED",
                 claimed_by = NULL,
                 claimed_at = NULL,
                 fulfilled_at = COALESCE(fulfilled_at, :fulfilled_at),
                 last_activity_at = :last_activity_at,
                 updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            ':fulfilled_at' => $now,
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $row['id'],
        ]);
        $stockMessage = $stockAction === 'deduct'
            ? ($stockDeductedNow
                ? ' Shared inventory was deducted for the manually completed order.'
                : ' Shared inventory was already deducted, so no second deduction was made.')
            : ' Shared inventory was left unchanged.';
        jg_store_ops_fulfillment_log_event(
            $pdo,
            $key,
            'remove_from_listed',
            $employeeId,
            $employeeName,
            [
                'message' => 'Removed from listed orders after Branch Login confirmation.' . $stockMessage,
                'stock_action' => $stockAction,
                'stock_deducted_now' => $stockDeductedNow,
                'sku_mappings' => $skuMappings,
            ]
        );
        $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        $pdo->commit();
        return is_array($row) ? $row : [];
    } catch (Throwable $throwable) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $throwable;
    }
}

/**
 * @param array<int, array<string, mixed>> $orders
 * @return array<int, array<string, mixed>>
 */
function jg_store_ops_fulfillment_merge_orders(PDO $pdo, array $orders, string $currentEmployeeId): array
{
    if ($orders === []) {
        return [];
    }

    $keys = [];
    foreach ($orders as $index => $order) {
        if (!is_array($order)) {
            continue;
        }
        $key = jg_store_ops_fulfillment_key_from_order($order);
        if ($key['order_id'] === '') {
            continue;
        }
        $keys[$index] = $key;
    }

    if ($keys === []) {
        return $orders;
    }

    $where = [];
    $params = [];
    $paramIndex = 0;
    foreach ($keys as $key) {
        $where[] = '(source_platform = ? AND source_account = ? AND order_id = ?)';
        $params[] = $key['source_platform'];
        $params[] = $key['source_account'];
        $params[] = $key['order_id'];
        $paramIndex++;
        if ($paramIndex >= 500) {
            break;
        }
    }

    $rowsByKey = [];
    if ($where !== []) {
        $stmt = $pdo->prepare('SELECT * FROM store_ops_order_fulfillment_v2 WHERE ' . implode(' OR ', $where));
        $stmt->execute($params);
        foreach ($stmt->fetchAll() as $row) {
            if (!is_array($row)) {
                continue;
            }
            $rowKey = (string) $row['source_platform'] . "\0" . (string) $row['source_account'] . "\0" . (string) $row['order_id'];
            $rowsByKey[$rowKey] = $row;
        }
    }

    $employeeMap = jg_store_ops_fulfillment_employee_map($pdo);
    foreach ($orders as $index => &$order) {
        if (!is_array($order) || !isset($keys[$index])) {
            continue;
        }
        $key = $keys[$index];
        $rowKey = $key['source_platform'] . "\0" . $key['source_account'] . "\0" . $key['order_id'];
        $row = $rowsByKey[$rowKey] ?? null;
        $reopenedValue = trim((string) ($order['authorizedRecoveryReopenedAt'] ?? ''));
        $fulfilledValue = is_array($row) ? trim((string) ($row['fulfilled_at'] ?? '')) : '';
        $reopenedAt = $reopenedValue !== '' ? strtotime($reopenedValue) : false;
        $fulfilledAt = $fulfilledValue !== '' ? strtotime($fulfilledValue . ' UTC') : false;
        $authorizedRecovery = $key['source_platform'] === 'shopee'
            && $key['source_account'] === 'jenang-gemi-shopee'
            && $key['order_id'] === '260807QAWE3UNJ';
        if (
            $authorizedRecovery
            && is_int($reopenedAt)
            && $reopenedAt > 0
            && is_array($row)
            && strtoupper((string) ($row['status'] ?? '')) === 'FULFILLED'
            && (!is_int($fulfilledAt) || $fulfilledAt < $reopenedAt)
        ) {
            $reset = $pdo->prepare(
                'UPDATE store_ops_order_fulfillment_v2
                 SET status = "UNCLAIMED", claimed_by = NULL, claimed_at = NULL,
                     last_activity_at = NULL, scan_completed_at = NULL,
                     label_printed_at = NULL, fulfilled_at = NULL,
                     scan_required = 0, scan_completed = 0, items_json = NULL,
                     updated_at = :updated_at
                 WHERE id = :id AND status = "FULFILLED"'
            );
            $reset->execute([
                ':updated_at' => jg_store_ops_fulfillment_now(),
                ':id' => (int) $row['id'],
            ]);
            $row = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
        }
        $state = jg_store_ops_fulfillment_state_from_row($row, $currentEmployeeId, $employeeMap);
        $order = array_merge($order, $state);
    }
    unset($order);

    return $orders;
}
