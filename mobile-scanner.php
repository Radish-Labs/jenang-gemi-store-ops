<?php
declare(strict_types=1);

// Mobile scanner relay. A phone signed in to the same employee profile acts as
// a wireless barcode scanner for that profile's desktop scan page:
// - the desktop scan page opens a short-lived relay session for its order,
// - the phone sees the session, opens its camera and posts each barcode,
// - the desktop polls the barcodes and checks them exactly like USB scans.
// The relay only carries raw barcodes. All order checks stay on the desktop.

const JG_MOBILE_SCANNER_DESKTOP_STALE_SECONDS = 25;
const JG_MOBILE_SCANNER_PHONE_STALE_SECONDS = 30;
const JG_MOBILE_SCANNER_SEEN_WRITE_SECONDS = 5;
const JG_MOBILE_SCANNER_MAX_EVENTS = 200;

function jg_mobile_scanner_ensure_schema(PDO $pdo): void
{
    $isSqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $idColumn = $isSqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $tableSuffix = $isSqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_mobile_scanner_v1 (
            employee_id VARCHAR(64) NOT NULL PRIMARY KEY,
            session_token VARCHAR(64) NOT NULL DEFAULT \'\',
            order_id VARCHAR(128) NOT NULL DEFAULT \'\',
            summary_json TEXT NULL,
            desktop_seen_at INTEGER NOT NULL DEFAULT 0,
            phone_seen_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        )' . $tableSuffix
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_mobile_scanner_events_v1 (
            id ' . $idColumn . ',
            employee_id VARCHAR(64) NOT NULL,
            session_token VARCHAR(64) NOT NULL,
            code VARCHAR(128) NOT NULL,
            created_at INTEGER NOT NULL' . ($isSqlite ? '' : ',
            KEY idx_store_ops_mobile_scanner_events_session (session_token, id)') . '
        )' . $tableSuffix
    );
    if ($isSqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_store_ops_mobile_scanner_events_session ON store_ops_mobile_scanner_events_v1 (session_token, id)');
    }
}

function jg_mobile_scanner_row(PDO $pdo, string $employeeId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM store_ops_mobile_scanner_v1 WHERE employee_id = :employee_id LIMIT 1');
    $stmt->execute([':employee_id' => $employeeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function jg_mobile_scanner_ensure_row(PDO $pdo, string $employeeId, int $now): array
{
    $row = jg_mobile_scanner_row($pdo, $employeeId);
    if ($row !== null) {
        return $row;
    }
    try {
        $pdo->prepare(
            'INSERT INTO store_ops_mobile_scanner_v1 (employee_id, session_token, order_id, summary_json, desktop_seen_at, phone_seen_at, updated_at)
             VALUES (:employee_id, \'\', \'\', NULL, 0, 0, :now)'
        )->execute([':employee_id' => $employeeId, ':now' => $now]);
    } catch (PDOException) {
        // A parallel request created it first.
    }
    return jg_mobile_scanner_row($pdo, $employeeId) ?? [];
}

function jg_mobile_scanner_require_employee(string $employeeId): string
{
    $employeeId = trim($employeeId);
    if ($employeeId === '' || strlen($employeeId) > 64) {
        throw new InvalidArgumentException('Sign in with an employee profile to use the mobile scanner.');
    }
    return $employeeId;
}

function jg_mobile_scanner_normalize_summary(mixed $summary): ?string
{
    if (!is_array($summary)) {
        return null;
    }
    $items = [];
    foreach (array_slice(is_array($summary['items'] ?? null) ? $summary['items'] : [], 0, 40) as $item) {
        if (!is_array($item)) continue;
        $items[] = [
            'name' => mb_substr(trim((string) ($item['name'] ?? '')), 0, 120),
            'code' => mb_substr(trim((string) ($item['code'] ?? '')), 0, 64),
            'scanned' => max(0, (int) ($item['scanned'] ?? 0)),
            'required' => max(0, (int) ($item['required'] ?? 0)),
        ];
    }
    $status = is_array($summary['status'] ?? null) ? $summary['status'] : [];
    $tone = (string) ($status['tone'] ?? '');
    $normalized = [
        'scanned' => max(0, (int) ($summary['scanned'] ?? 0)),
        'required' => max(0, (int) ($summary['required'] ?? 0)),
        'items' => $items,
        'status' => [
            'title' => mb_substr(trim((string) ($status['title'] ?? '')), 0, 120),
            'detail' => mb_substr(trim((string) ($status['detail'] ?? '')), 0, 240),
            'tone' => in_array($tone, ['ok', 'error', 'info'], true) ? $tone : 'info',
            'seq' => max(0, (int) ($status['seq'] ?? 0)),
        ],
    ];
    $encoded = json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return is_string($encoded) ? $encoded : null;
}

function jg_mobile_scanner_phone_connected(array $row, int $now): bool
{
    return (int) ($row['phone_seen_at'] ?? 0) >= $now - JG_MOBILE_SCANNER_PHONE_STALE_SECONDS;
}

/**
 * Desktop scan page opened for an order. Replaces any earlier session of the
 * same profile so the phone always follows the newest Lanjut.
 */
function jg_mobile_scanner_start(PDO $pdo, string $employeeId, string $orderId, mixed $summary, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $orderId = mb_substr(trim($orderId), 0, 128);
    if ($orderId === '') {
        throw new InvalidArgumentException('Order is required for the mobile scanner.');
    }
    $row = jg_mobile_scanner_ensure_row($pdo, $employeeId, $now);
    $token = bin2hex(random_bytes(16));
    $pdo->prepare(
        'UPDATE store_ops_mobile_scanner_v1
         SET session_token = :token, order_id = :order_id, summary_json = :summary, desktop_seen_at = :seen_at, updated_at = :updated_at
         WHERE employee_id = :employee_id'
    )->execute([
        ':token' => $token,
        ':order_id' => $orderId,
        ':summary' => jg_mobile_scanner_normalize_summary($summary),
        ':seen_at' => $now,
        ':updated_at' => $now,
        ':employee_id' => $employeeId,
    ]);
    $pdo->prepare('DELETE FROM store_ops_mobile_scanner_events_v1 WHERE employee_id = :employee_id OR created_at < :old')
        ->execute([':employee_id' => $employeeId, ':old' => $now - 86400]);

    return ['session' => $token, 'phone_connected' => jg_mobile_scanner_phone_connected($row, $now)];
}

/**
 * Desktop poll: returns barcodes posted by the phone after $afterId and
 * stores the desktop's latest progress so the phone can show it.
 */
function jg_mobile_scanner_desktop_poll(PDO $pdo, string $employeeId, string $token, int $afterId, mixed $summary, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $row = jg_mobile_scanner_row($pdo, $employeeId);
    if ($row === null || $token === '' || !hash_equals((string) $row['session_token'], $token)) {
        return ['active' => false, 'codes' => [], 'phone_connected' => $row !== null && jg_mobile_scanner_phone_connected($row, $now)];
    }

    $encodedSummary = $summary === null ? null : jg_mobile_scanner_normalize_summary($summary);
    if ($encodedSummary !== null && $encodedSummary !== (string) ($row['summary_json'] ?? '')) {
        $pdo->prepare(
            'UPDATE store_ops_mobile_scanner_v1 SET summary_json = :summary, desktop_seen_at = :seen_at, updated_at = :updated_at
             WHERE employee_id = :employee_id AND session_token = :token'
        )->execute([':summary' => $encodedSummary, ':seen_at' => $now, ':updated_at' => $now, ':employee_id' => $employeeId, ':token' => $token]);
    } elseif ((int) $row['desktop_seen_at'] < $now - JG_MOBILE_SCANNER_SEEN_WRITE_SECONDS) {
        $pdo->prepare(
            'UPDATE store_ops_mobile_scanner_v1 SET desktop_seen_at = :now
             WHERE employee_id = :employee_id AND session_token = :token'
        )->execute([':now' => $now, ':employee_id' => $employeeId, ':token' => $token]);
    }

    $stmt = $pdo->prepare(
        'SELECT id, code FROM store_ops_mobile_scanner_events_v1
         WHERE session_token = :token AND employee_id = :employee_id AND id > :after
         ORDER BY id ASC LIMIT 50'
    );
    $stmt->execute([':token' => $token, ':employee_id' => $employeeId, ':after' => max(0, $afterId)]);
    $codes = array_map(
        static fn (array $event): array => ['id' => (int) $event['id'], 'code' => (string) $event['code']],
        $stmt->fetchAll(PDO::FETCH_ASSOC)
    );

    return ['active' => true, 'codes' => $codes, 'phone_connected' => jg_mobile_scanner_phone_connected($row, $now)];
}

function jg_mobile_scanner_end(PDO $pdo, string $employeeId, string $token, int $now): void
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    if ($token === '') return;
    $pdo->prepare(
        'UPDATE store_ops_mobile_scanner_v1 SET session_token = \'\', order_id = \'\', summary_json = NULL, updated_at = :now
         WHERE employee_id = :employee_id AND session_token = :token'
    )->execute([':now' => $now, ':employee_id' => $employeeId, ':token' => $token]);
}

/**
 * Phone poll: marks the phone as connected and returns the active order, if
 * the desktop scan page is still open.
 */
function jg_mobile_scanner_phone_state(PDO $pdo, string $employeeId, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $row = jg_mobile_scanner_ensure_row($pdo, $employeeId, $now);
    if ((int) ($row['phone_seen_at'] ?? 0) < $now - JG_MOBILE_SCANNER_SEEN_WRITE_SECONDS) {
        $pdo->prepare('UPDATE store_ops_mobile_scanner_v1 SET phone_seen_at = :now WHERE employee_id = :employee_id')
            ->execute([':now' => $now, ':employee_id' => $employeeId]);
    }

    $token = (string) ($row['session_token'] ?? '');
    $desktopAlive = (int) ($row['desktop_seen_at'] ?? 0) >= $now - JG_MOBILE_SCANNER_DESKTOP_STALE_SECONDS;
    if ($token === '' || !$desktopAlive) {
        return ['active' => false];
    }
    $summary = json_decode((string) ($row['summary_json'] ?? ''), true);

    return [
        'active' => true,
        'session' => $token,
        'order_id' => (string) $row['order_id'],
        'summary' => is_array($summary) ? $summary : null,
    ];
}

function jg_mobile_scanner_normalize_code(string $code): string
{
    $code = trim($code);
    if ($code === '' || strlen($code) > 128 || preg_match('/^[\x21-\x7E]+$/', $code) !== 1) {
        throw new InvalidArgumentException('Barcode could not be read. Scan it again.');
    }
    return $code;
}

function jg_mobile_scanner_phone_scan(PDO $pdo, string $employeeId, string $token, string $code, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $code = jg_mobile_scanner_normalize_code($code);
    $state = jg_mobile_scanner_phone_state($pdo, $employeeId, $now);
    if (!($state['active'] ?? false) || $token === '' || !hash_equals((string) $state['session'], $token)) {
        return ['ok' => false, 'active' => false];
    }

    $count = $pdo->prepare('SELECT COUNT(*) FROM store_ops_mobile_scanner_events_v1 WHERE session_token = :token');
    $count->execute([':token' => $token]);
    if ((int) $count->fetchColumn() >= JG_MOBILE_SCANNER_MAX_EVENTS) {
        throw new InvalidArgumentException('Too many scans for this order. Restart the order on the computer.');
    }

    $pdo->prepare(
        'INSERT INTO store_ops_mobile_scanner_events_v1 (employee_id, session_token, code, created_at)
         VALUES (:employee_id, :token, :code, :now)'
    )->execute([':employee_id' => $employeeId, ':token' => $token, ':code' => $code, ':now' => $now]);

    return ['ok' => true, 'active' => true, 'id' => (int) $pdo->lastInsertId()];
}

/**
 * Desktop pushes its latest progress/result right away (the phone shows it).
 */
function jg_mobile_scanner_desktop_update(PDO $pdo, string $employeeId, string $token, mixed $summary, int $now): bool
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $encodedSummary = jg_mobile_scanner_normalize_summary($summary);
    if ($token === '' || $encodedSummary === null) return false;
    $stmt = $pdo->prepare(
        'UPDATE store_ops_mobile_scanner_v1 SET summary_json = :summary, desktop_seen_at = :seen_at, updated_at = :updated_at
         WHERE employee_id = :employee_id AND session_token = :token'
    );
    $stmt->execute([':summary' => $encodedSummary, ':seen_at' => $now, ':updated_at' => $now, ':employee_id' => $employeeId, ':token' => $token]);
    return $stmt->rowCount() > 0 || (jg_mobile_scanner_row($pdo, $employeeId)['session_token'] ?? '') === $token;
}

/**
 * Short signature of what the phone shows, so a waiting phone request can
 * return the moment anything changes.
 */
function jg_mobile_scanner_phone_signature(array $state): string
{
    if (!($state['active'] ?? false)) return 'idle';
    $summary = is_array($state['summary'] ?? null) ? $state['summary'] : [];
    return implode(':', [
        (string) ($state['session'] ?? ''),
        (string) ($summary['status']['seq'] ?? 0),
        (string) ($summary['scanned'] ?? 0),
        (string) ($summary['required'] ?? 0),
    ]);
}

/**
 * Hold a request open (up to $waitSeconds) until $check returns a result,
 * checking every 150 ms. Used so scans and results arrive immediately
 * instead of on the next timed refresh.
 */
function jg_mobile_scanner_wait(callable $check, float $waitSeconds): array
{
    $deadline = microtime(true) + max(0.0, min(12.0, $waitSeconds));
    while (true) {
        [$done, $result] = $check(time());
        if ($done || microtime(true) >= $deadline || connection_aborted()) {
            return $result;
        }
        usleep(150000);
    }
}

function jg_mobile_scanner_desktop_wait(PDO $pdo, string $employeeId, string $token, int $afterId, mixed $summary, float $waitSeconds): array
{
    $first = true;
    return jg_mobile_scanner_wait(static function (int $now) use ($pdo, $employeeId, $token, $afterId, $summary, &$first): array {
        $result = jg_mobile_scanner_desktop_poll($pdo, $employeeId, $token, $afterId, $first ? $summary : null, $now);
        $first = false;
        return [!$result['active'] || $result['codes'] !== [], $result];
    }, $waitSeconds);
}

function jg_mobile_scanner_phone_wait(PDO $pdo, string $employeeId, string $known, float $waitSeconds): array
{
    return jg_mobile_scanner_wait(static function (int $now) use ($pdo, $employeeId, $known): array {
        $state = jg_mobile_scanner_phone_state($pdo, $employeeId, $now);
        $state['signature'] = jg_mobile_scanner_phone_signature($state);
        return [$state['signature'] !== $known, $state];
    }, $waitSeconds);
}
