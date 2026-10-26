<?php
declare(strict_types=1);

// Phone fulfillment prints on the packing computer. After the phone finishes
// scanning, it queues a print job under its employee profile. Any packing
// computer (the "print station"), whatever profile it is signed in to, takes
// the next job from any profile, opens the normal label page for it, and
// reports progress back so the phone can show it. Completion and stock go
// through the usual order actions, recorded under the phone's profile.

const JG_MOBILE_PRINT_STATION_STALE_SECONDS = 30;
const JG_MOBILE_PRINT_JOB_TTL_SECONDS = 600;
const JG_MOBILE_PRINT_STATUSES = ['queued', 'taken', 'printing', 'attention', 'confirm', 'printed', 'failed', 'cancelled', 'expired'];

function jg_mobile_print_ensure_schema(PDO $pdo): void
{
    $isSqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $idColumn = $isSqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $longText = $isSqlite ? 'TEXT' : 'MEDIUMTEXT';
    $tableSuffix = $isSqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_mobile_print_jobs_v1 (
            id ' . $idColumn . ',
            employee_id VARCHAR(64) NOT NULL,
            order_id VARCHAR(128) NOT NULL,
            source_platform VARCHAR(32) NOT NULL,
            source_account VARCHAR(96) NOT NULL,
            order_json ' . $longText . ' NOT NULL,
            status VARCHAR(16) NOT NULL,
            detail VARCHAR(255) NOT NULL DEFAULT \'\',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL' . ($isSqlite ? '' : ',
            KEY idx_store_ops_mobile_print_jobs_queue (employee_id, status, id)') . '
        )' . $tableSuffix
    );
    if ($isSqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_store_ops_mobile_print_jobs_queue ON store_ops_mobile_print_jobs_v1 (employee_id, status, id)');
    }
    // A tap on the phone (Printed successfully / Print again) waiting for the
    // computer that holds the job's label page.
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_mobile_print_commands_v1 (
            job_id ' . ($isSqlite ? 'INTEGER' : 'BIGINT UNSIGNED') . ' NOT NULL PRIMARY KEY,
            command VARCHAR(16) NOT NULL,
            created_at INTEGER NOT NULL
        )' . $tableSuffix
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_mobile_print_stations_v1 (
            employee_id VARCHAR(64) NOT NULL PRIMARY KEY,
            seen_at INTEGER NOT NULL DEFAULT 0
        )' . $tableSuffix
    );
}

// Stations are tracked per signed-in profile (several computers may be open),
// but a phone only needs to know that some station is listening.
function jg_mobile_print_station_online(PDO $pdo, int $now): bool
{
    $stmt = $pdo->prepare('SELECT MAX(seen_at) FROM store_ops_mobile_print_stations_v1');
    $stmt->execute();
    return (int) $stmt->fetchColumn() >= $now - JG_MOBILE_PRINT_STATION_STALE_SECONDS;
}

function jg_mobile_print_station_seen(PDO $pdo, string $employeeId, int $now): void
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $stmt = $pdo->prepare('SELECT seen_at FROM store_ops_mobile_print_stations_v1 WHERE employee_id = :employee_id LIMIT 1');
    $stmt->execute([':employee_id' => $employeeId]);
    $seenAt = $stmt->fetchColumn();
    if ($seenAt === false) {
        try {
            $pdo->prepare('INSERT INTO store_ops_mobile_print_stations_v1 (employee_id, seen_at) VALUES (:employee_id, :seen_at)')
                ->execute([':employee_id' => $employeeId, ':seen_at' => $now]);
        } catch (PDOException) {
            // A parallel request created it first.
        }
        return;
    }
    if ((int) $seenAt < $now - JG_MOBILE_SCANNER_SEEN_WRITE_SECONDS) {
        $pdo->prepare('UPDATE store_ops_mobile_print_stations_v1 SET seen_at = :seen_at WHERE employee_id = :employee_id')
            ->execute([':seen_at' => $now, ':employee_id' => $employeeId]);
    }
}

/**
 * The phone's label layout: turn clockwise (0/90/180/270) and size (50-150,
 * 100 fills the label). Same rules as label-reshape.js cleanLayout().
 *
 * @return array{rotate:int,size:int}
 */
function jg_mobile_print_clean_layout(array $layout): array
{
    $rotate = (int) (round(((float) ($layout['rotate'] ?? 0)) / 90) * 90);
    $rotate = (($rotate % 360) + 360) % 360;
    $size = (int) round((float) ($layout['size'] ?? 100));
    return ['rotate' => $rotate, 'size' => max(50, min(150, $size))];
}

/**
 * Phone: queue the scanned order for printing on the computer. Replaces any
 * unfinished job for the same order so a retry never prints twice.
 *
 * @param array{source_platform:string,source_account:string,order_id:string} $key
 */
function jg_mobile_print_request(PDO $pdo, string $employeeId, array $order, array $key, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $encoded = json_encode($order, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($encoded) || strlen($encoded) > 262144) {
        throw new InvalidArgumentException('Order details are too large to print from the phone.');
    }
    $pdo->prepare(
        'UPDATE store_ops_mobile_print_jobs_v1 SET status = \'cancelled\', updated_at = :updated_at
         WHERE employee_id = :employee_id AND order_id = :order_id AND source_platform = :source_platform
           AND source_account = :source_account AND status IN (\'queued\', \'taken\', \'printing\', \'attention\', \'confirm\', \'failed\')'
    )->execute([
        ':updated_at' => $now,
        ':employee_id' => $employeeId,
        ':order_id' => $key['order_id'],
        ':source_platform' => $key['source_platform'],
        ':source_account' => $key['source_account'],
    ]);
    $pdo->prepare('DELETE FROM store_ops_mobile_print_jobs_v1 WHERE created_at < :old')->execute([':old' => $now - 7 * 86400]);
    $pdo->prepare(
        'INSERT INTO store_ops_mobile_print_jobs_v1
            (employee_id, order_id, source_platform, source_account, order_json, status, detail, created_at, updated_at)
         VALUES (:employee_id, :order_id, :source_platform, :source_account, :order_json, \'queued\', \'\', :created_at, :updated_at)'
    )->execute([
        ':employee_id' => $employeeId,
        ':order_id' => $key['order_id'],
        ':source_platform' => $key['source_platform'],
        ':source_account' => $key['source_account'],
        ':order_json' => $encoded,
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);

    return [
        'job' => (int) $pdo->lastInsertId(),
        'station_online' => jg_mobile_print_station_online($pdo, $now),
    ];
}

function jg_mobile_print_job_row(PDO $pdo, string $employeeId, int $jobId): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM store_ops_mobile_print_jobs_v1 WHERE id = :id AND employee_id = :employee_id LIMIT 1');
    $stmt->execute([':id' => $jobId, ':employee_id' => $employeeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * Phone: the job's progress as reported by the computer.
 */
function jg_mobile_print_job_state(PDO $pdo, string $employeeId, int $jobId, int $now): array
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    $row = jg_mobile_print_job_row($pdo, $employeeId, $jobId);
    if ($row === null) {
        return ['status' => 'missing', 'detail' => '', 'station_online' => false];
    }
    $status = (string) $row['status'];
    if ($status === 'queued' && (int) $row['created_at'] < $now - JG_MOBILE_PRINT_JOB_TTL_SECONDS) {
        $status = 'expired';
    }
    return [
        'status' => $status,
        'detail' => (string) $row['detail'],
        'station_online' => jg_mobile_print_station_online($pdo, $now),
    ];
}

/**
 * Computer: the oldest waiting job from any profile, if any.
 */
function jg_mobile_print_next_job(PDO $pdo, string $stationEmployeeId, int $now): ?array
{
    jg_mobile_print_station_seen($pdo, $stationEmployeeId, $now);
    $stmt = $pdo->prepare(
        'SELECT id, order_id FROM store_ops_mobile_print_jobs_v1
         WHERE status = \'queued\' AND created_at >= :fresh
         ORDER BY id ASC LIMIT 1'
    );
    $stmt->execute([':fresh' => $now - JG_MOBILE_PRINT_JOB_TTL_SECONDS]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? ['job' => (int) $row['id'], 'order_id' => (string) $row['order_id']] : null;
}

/**
 * Computer: claim a waiting job from any profile. Only one computer tab can
 * take it. Returns the phone's profile, which the order is completed as.
 */
function jg_mobile_print_take(PDO $pdo, int $jobId, int $now): ?array
{
    $stmt = $pdo->prepare(
        'UPDATE store_ops_mobile_print_jobs_v1 SET status = \'taken\', detail = \'\', updated_at = :updated_at
         WHERE id = :id AND status = \'queued\''
    );
    $stmt->execute([':updated_at' => $now, ':id' => $jobId]);
    if ($stmt->rowCount() !== 1) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT * FROM store_ops_mobile_print_jobs_v1 WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $jobId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $order = is_array($row) ? json_decode((string) ($row['order_json'] ?? ''), true) : null;
    if (!is_array($order)) {
        jg_mobile_print_set_status($pdo, $jobId, 'failed', 'Order details were unreadable. Start the order again.', $now);
        return null;
    }
    return [
        'job' => $jobId,
        'employee_id' => (string) $row['employee_id'],
        'order' => $order,
        'key' => [
            'order_id' => (string) $row['order_id'],
            'source_platform' => (string) $row['source_platform'],
            'source_account' => (string) $row['source_account'],
        ],
    ];
}

/**
 * Computer: report progress (printing, printer problem, waiting for the
 * operator to confirm, printed, failed).
 */
function jg_mobile_print_set_status(PDO $pdo, int $jobId, string $status, string $detail, int $now): bool
{
    if (!in_array($status, ['printing', 'attention', 'confirm', 'printed', 'failed'], true)) {
        throw new InvalidArgumentException('Unknown print status.');
    }
    $stmt = $pdo->prepare(
        'UPDATE store_ops_mobile_print_jobs_v1 SET status = :status, detail = :detail, updated_at = :updated_at
         WHERE id = :id AND status IN (\'taken\', \'printing\', \'attention\', \'confirm\', \'failed\')'
    );
    $stmt->execute([
        ':status' => $status,
        ':detail' => mb_substr(trim($detail), 0, 250),
        ':updated_at' => $now,
        ':id' => $jobId,
    ]);
    return $stmt->rowCount() === 1;
}

function jg_mobile_print_station_wait(PDO $pdo, string $stationEmployeeId, float $waitSeconds): array
{
    return jg_mobile_scanner_wait(static function (int $now) use ($pdo, $stationEmployeeId): array {
        $job = jg_mobile_print_next_job($pdo, $stationEmployeeId, $now);
        return [$job !== null, ['job' => $job]];
    }, $waitSeconds);
}

function jg_mobile_print_job_wait(PDO $pdo, string $employeeId, int $jobId, string $known, float $waitSeconds): array
{
    return jg_mobile_scanner_wait(static function (int $now) use ($pdo, $employeeId, $jobId, $known): array {
        $state = jg_mobile_print_job_state($pdo, $employeeId, $jobId, $now);
        $state['signature'] = implode('|', [$state['status'], $state['detail'], $state['station_online'] ? '1' : '0']);
        return [$state['signature'] !== $known, $state];
    }, $waitSeconds);
}

/**
 * Phone: "confirm" (Printed successfully) or "reprint" (Print again) for its
 * own job while the computer still has the label open.
 */
function jg_mobile_print_command(PDO $pdo, string $employeeId, int $jobId, string $command, int $now): bool
{
    $employeeId = jg_mobile_scanner_require_employee($employeeId);
    if (!in_array($command, ['confirm', 'reprint'], true)) {
        throw new InvalidArgumentException('Unknown print command.');
    }
    $row = jg_mobile_print_job_row($pdo, $employeeId, $jobId);
    if ($row === null || !in_array((string) $row['status'], ['taken', 'printing', 'attention', 'confirm'], true)) {
        return false;
    }
    $pdo->prepare('DELETE FROM store_ops_mobile_print_commands_v1 WHERE job_id = :job_id OR created_at < :old')
        ->execute([':job_id' => $jobId, ':old' => $now - JG_MOBILE_PRINT_JOB_TTL_SECONDS]);
    $pdo->prepare('INSERT INTO store_ops_mobile_print_commands_v1 (job_id, command, created_at) VALUES (:job_id, :command, :created_at)')
        ->execute([':job_id' => $jobId, ':command' => $command, ':created_at' => $now]);
    return true;
}

/**
 * Computer: the phone's latest tap for this job, removed once read.
 */
function jg_mobile_print_command_take(PDO $pdo, int $jobId): string
{
    $stmt = $pdo->prepare('SELECT command FROM store_ops_mobile_print_commands_v1 WHERE job_id = :job_id LIMIT 1');
    $stmt->execute([':job_id' => $jobId]);
    $command = $stmt->fetchColumn();
    if ($command === false) {
        return '';
    }
    $delete = $pdo->prepare('DELETE FROM store_ops_mobile_print_commands_v1 WHERE job_id = :job_id AND command = :command');
    $delete->execute([':job_id' => $jobId, ':command' => $command]);
    // Another tab read it first.
    return $delete->rowCount() === 1 ? (string) $command : '';
}

function jg_mobile_print_command_wait(PDO $pdo, int $jobId, float $waitSeconds): array
{
    return jg_mobile_scanner_wait(static function (int $now) use ($pdo, $jobId): array {
        $command = jg_mobile_print_command_take($pdo, $jobId);
        return [$command !== '', ['command' => $command]];
    }, $waitSeconds);
}
