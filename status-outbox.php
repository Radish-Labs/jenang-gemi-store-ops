<?php
declare(strict_types=1);

// Status updates for other systems (API Ingest for Shopee/TikTok, the
// Executive Dashboard for website and WhatsApp orders) are saved here and sent
// right after Store Ops has answered, so finishing an order never waits on
// them. Failed sends are retried with growing gaps; the board warns about
// updates that keep failing.

const JG_STATUS_OUTBOX_MAX_ATTEMPTS = 60;
const JG_STATUS_OUTBOX_WARN_AFTER = 3;

function jg_status_outbox_ensure(PDO $pdo): void
{
    static $ready = false;
    if ($ready) return;
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_status_outbox_v1 (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            target VARCHAR(16) NOT NULL,
            source_platform VARCHAR(32) NOT NULL,
            source_account VARCHAR(96) NOT NULL,
            order_id VARCHAR(128) NOT NULL,
            package_id VARCHAR(128) NOT NULL DEFAULT \'\',
            status VARCHAR(32) NOT NULL,
            attempts INT NOT NULL DEFAULT 0,
            next_attempt_at INT NOT NULL,
            last_error VARCHAR(255) NOT NULL DEFAULT \'\',
            created_at INT NOT NULL,
            done_at INT NULL,
            KEY due (done_at, next_attempt_at),
            KEY order_key (target, source_platform, source_account, order_id)
        )'
    );
    $ready = true;
}

/**
 * Queue a status update. An older update for the same order that hasn't gone
 * out yet is dropped, so a late retry can never move the order backwards.
 */
function jg_status_outbox_add(PDO $pdo, string $target, array $key, string $status): void
{
    jg_status_outbox_ensure($pdo);
    $now = time();
    $match = [
        ':target' => $target,
        ':source_platform' => (string) $key['source_platform'],
        ':source_account' => (string) $key['source_account'],
        ':order_id' => (string) $key['order_id'],
    ];
    $pdo->prepare(
        'UPDATE store_ops_status_outbox_v1 SET done_at = :now, last_error = \'replaced by a newer status\'
         WHERE done_at IS NULL AND target = :target AND source_platform = :source_platform
           AND source_account = :source_account AND order_id = :order_id'
    )->execute($match + [':now' => $now]);
    $pdo->prepare(
        'INSERT INTO store_ops_status_outbox_v1
            (target, source_platform, source_account, order_id, package_id, status, next_attempt_at, created_at)
         VALUES (:target, :source_platform, :source_account, :order_id, :package_id, :status, :now, :now2)'
    )->execute($match + [
        ':package_id' => (string) ($key['package_id'] ?? ''),
        ':status' => $status,
        ':now' => $now,
        ':now2' => $now,
    ]);
}

/**
 * Send what is due. $send(array $row) throws when the other system did not
 * accept the update. Each row is claimed first, so two requests never send
 * the same update at once.
 */
function jg_status_outbox_flush(PDO $pdo, callable $send, int $limit = 8, float $budgetSeconds = 20.0): void
{
    jg_status_outbox_ensure($pdo);
    $started = microtime(true);
    $now = time();
    $stmt = $pdo->prepare(
        'SELECT * FROM store_ops_status_outbox_v1
         WHERE done_at IS NULL AND next_attempt_at <= :now
         ORDER BY id ASC LIMIT ' . max(1, $limit)
    );
    $stmt->execute([':now' => $now]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if (microtime(true) - $started > $budgetSeconds) break;
        $claim = $pdo->prepare(
            'UPDATE store_ops_status_outbox_v1 SET next_attempt_at = :hold
             WHERE id = :id AND done_at IS NULL AND next_attempt_at = :seen'
        );
        $claim->execute([':hold' => time() + 120, ':id' => $row['id'], ':seen' => $row['next_attempt_at']]);
        if ($claim->rowCount() !== 1) continue;
        try {
            $send($row);
            $pdo->prepare('UPDATE store_ops_status_outbox_v1 SET done_at = :now, attempts = attempts + 1, last_error = \'\' WHERE id = :id')
                ->execute([':now' => time(), ':id' => $row['id']]);
        } catch (Throwable $error) {
            $attempts = (int) $row['attempts'] + 1;
            $giveUp = $attempts >= JG_STATUS_OUTBOX_MAX_ATTEMPTS;
            // 15 s, 30 s, 1 min, 2 min … at most 10 minutes apart.
            $delay = min(600, 15 * (2 ** min(6, $attempts - 1)));
            $pdo->prepare(
                'UPDATE store_ops_status_outbox_v1
                 SET attempts = :attempts, next_attempt_at = :next, last_error = :error, done_at = :done
                 WHERE id = :id'
            )->execute([
                ':attempts' => $attempts,
                ':next' => time() + $delay,
                ':error' => substr($error->getMessage(), 0, 255),
                ':done' => $giveUp ? time() : null,
                ':id' => $row['id'],
            ]);
            error_log('Store Ops status update ' . $row['target'] . ' ' . $row['order_id'] . ' ' . $row['status'] . ' failed: ' . $error->getMessage());
        }
    }
}

/** Updates that keep failing (for the board's warning). */
function jg_status_outbox_failing(PDO $pdo): array
{
    jg_status_outbox_ensure($pdo);
    $stmt = $pdo->prepare(
        'SELECT order_id, source_platform, status, attempts, last_error FROM store_ops_status_outbox_v1
         WHERE (done_at IS NULL AND attempts >= :warn)
            OR (attempts >= :max AND done_at > :recent)
         ORDER BY id ASC LIMIT 20'
    );
    $stmt->execute([':warn' => JG_STATUS_OUTBOX_WARN_AFTER, ':max' => JG_STATUS_OUTBOX_MAX_ATTEMPTS, ':recent' => time() - 2 * 86400]);
    return array_map(static fn (array $row): array => [
        'order_id' => (string) $row['order_id'],
        'platform' => (string) $row['source_platform'],
        'status' => (string) $row['status'],
        'attempts' => (int) $row['attempts'],
        'error' => (string) $row['last_error'],
    ], $stmt->fetchAll(PDO::FETCH_ASSOC));
}

/** Answer the browser now; the rest of this request keeps running. */
function jg_status_outbox_finish_response(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        @ob_end_flush();
        @flush();
    }
    ignore_user_abort(true);
}
