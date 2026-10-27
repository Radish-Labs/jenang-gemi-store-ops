<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/store-ops-fulfillment-runtime.php';

const JG_STORE_OPS_WEBSITE_PLATFORMS = ['zero_website', 'jenang_gemi_website', 'whatsapp'];
const JG_STORE_OPS_ZERO_SCOPE_CUTOVER = '2026-07-24 05:15:24.846138';
const JG_STORE_OPS_ZERO_SCOPE_BEFORE = [
    'shopee:jenang-gemi-shopee',
    'tiktok:jenang-gemi-tiktok',
];
const JG_STORE_OPS_ZERO_SCOPE_AFTER = [
    'shopee:jenang-gemi-shopee',
    'shopee:zero-shopee',
    'tiktok:jenang-gemi-tiktok',
    'tiktok:zero-tiktok',
];

function jg_store_ops_website_config(string $envKey, string $configKey, string $default = ''): string
{
    $environment = jg_store_ops_env_value($envKey);
    if ($environment !== '') return $environment;
    $config = jg_store_ops_load_local_config();
    $value = $config[$configKey] ?? null;
    return is_string($value) && trim($value) !== '' ? trim($value) : $default;
}

function jg_store_ops_website_derive_token(string $seed): string
{
    $seed = trim($seed);
    return $seed === '' ? '' : hash_hmac('sha256', 'jenang-gemi-website-orders-v1', $seed);
}

function jg_store_ops_website_token(): string
{
    $configured = jg_store_ops_website_config('JG_STORE_OPS_WEBSITE_TOKEN', 'store_ops_website_token');
    if ($configured !== '') {
        return $configured;
    }
    $seed = jg_store_ops_website_config('JG_SHOPEE_INGEST_SETUP_TOKEN', 'shopee_ingest_setup_token');
    return jg_store_ops_website_derive_token($seed);
}

function jg_store_ops_marketplace_setup_token(string $platform): string
{
    $platform = strtolower(trim($platform));
    if ($platform === 'tiktok') {
        $configured = jg_store_ops_website_config('JG_TIKTOK_INGEST_SETUP_TOKEN', 'tiktok_ingest_setup_token');
        if ($configured !== '') {
            return $configured;
        }
    }
    return jg_store_ops_website_config('JG_SHOPEE_INGEST_SETUP_TOKEN', 'shopee_ingest_setup_token');
}

/** @return array<int,string> */
function jg_store_ops_normalize_marketplace_sources(mixed $value): array
{
    $candidates = is_array($value) ? $value : explode(',', (string) $value);
    $sources = [];
    foreach ($candidates as $source) {
        if (!is_scalar($source)) {
            continue;
        }
        $parts = array_map(
            static fn (string $part): string => trim(strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', $part)), '.-_'),
            explode(':', trim((string) $source), 2)
        );
        if (in_array($parts[0] ?? '', ['shopee', 'tiktok'], true) && ($parts[1] ?? '') !== '') {
            $normalized = ($parts[0] ?? '') . ':' . ($parts[1] ?? '');
            $sources[$normalized] = $normalized;
        }
    }
    $sources = array_values($sources);
    sort($sources);
    return $sources;
}

/**
 * Expand only the explicitly authorized live Big Set cutover. The original
 * timestamp remains the eligibility boundary, so older ZERO orders stay
 * manual-era and ZFIT can never be admitted by this migration.
 *
 * @return array<int,string>
 */
function jg_store_ops_zero_scope_expansion(mixed $activatedAt, mixed $currentSources): array
{
    $currentSources = jg_store_ops_normalize_marketplace_sources($currentSources);
    if ($currentSources !== JG_STORE_OPS_ZERO_SCOPE_BEFORE) {
        return $currentSources;
    }
    try {
        if (!jg_store_ops_website_cutover_matches($activatedAt, JG_STORE_OPS_ZERO_SCOPE_CUTOVER)) {
            return $currentSources;
        }
    } catch (Throwable) {
        return $currentSources;
    }
    return JG_STORE_OPS_ZERO_SCOPE_AFTER;
}

/** @return array<int,string> */
function jg_store_ops_website_activation_sources(mixed $value, array $configuredSources): array
{
    if (!is_array($value)) {
        throw new InvalidArgumentException('The automatic source scope must be a list.');
    }
    $requested = [];
    foreach ($value as $candidate) {
        if (!is_scalar($candidate)) {
            throw new InvalidArgumentException('The automatic source scope contains an invalid entry.');
        }
        $normalized = jg_store_ops_normalize_marketplace_sources([(string) $candidate]);
        if (count($normalized) !== 1) {
            throw new InvalidArgumentException('The automatic source scope contains an invalid marketplace account.');
        }
        $requested[$normalized[0]] = $normalized[0];
    }
    $requested = array_values($requested);
    sort($requested);
    if ($requested === []) {
        throw new InvalidArgumentException('The API Ingest frozen automatic source scope is required.');
    }

    $configuredSources = jg_store_ops_normalize_marketplace_sources($configuredSources);
    $missingSources = array_values(array_diff($requested, $configuredSources));
    if ($missingSources !== []) {
        throw new RuntimeException('Store Ops is not configured for automatic sources: ' . implode(', ', $missingSources));
    }
    return $requested;
}

/** @return array<int,string> */
function jg_store_ops_big_set_sources_from_values(
    string $marketplaceSources,
    string $shopeeAccounts,
    string $shopeeAccount,
    string $tiktokAccounts
): array {
    if (trim($marketplaceSources) !== '') {
        return jg_store_ops_normalize_marketplace_sources($marketplaceSources);
    }

    $sources = [];
    $shopeeValue = trim($shopeeAccounts) !== '' ? $shopeeAccounts : $shopeeAccount;
    foreach (explode(',', $shopeeValue) as $account) {
        $account = trim(strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', $account)), '.-_');
        if ($account !== '') {
            $sources['shopee:' . $account] = 'shopee:' . $account;
        }
    }
    foreach (explode(',', $tiktokAccounts) as $account) {
        $account = trim(strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', $account)), '.-_');
        if ($account !== '') {
            $sources['tiktok:' . $account] = 'tiktok:' . $account;
        }
    }
    return jg_store_ops_normalize_marketplace_sources(array_values($sources));
}

/** @return array<int,string> */
function jg_store_ops_big_set_sources(): array
{
    return jg_store_ops_big_set_sources_from_values(
        jg_store_ops_website_config('JG_MARKETPLACE_SOURCES', 'marketplace_sources'),
        jg_store_ops_website_config('JG_SHOPEE_ACCOUNTS', 'shopee_accounts'),
        jg_store_ops_website_config('JG_SHOPEE_ACCOUNT', 'shopee_account', 'jenang-gemi-shopee'),
        jg_store_ops_website_config('JG_TIKTOK_ACCOUNTS', 'tiktok_accounts')
    );
}

/** @return array{ready:bool,detail:string,platforms:array<int,string>} */
function jg_store_ops_big_set_api_access_response(array $decoded, array $sources): array
{
    $required = [];
    foreach ($sources as $source) {
        $platform = strtolower(trim((string) explode(':', (string) $source, 2)[0]));
        if (in_array($platform, ['shopee', 'tiktok'], true)) {
            $required[$platform] = $platform;
        }
    }
    $allowed = [];
    foreach (is_array($decoded['platforms'] ?? null) ? $decoded['platforms'] : [] as $platform) {
        $platform = strtolower(trim((string) $platform));
        if (in_array($platform, ['shopee', 'tiktok'], true)) {
            $allowed[$platform] = $platform;
        }
    }
    $missing = array_values(array_diff(array_values($required), array_values($allowed)));
    $ready = !empty($decoded['ok']) && $required !== [] && $missing === [];
    return [
        'ready' => $ready,
        'detail' => $ready
            ? 'Authenticated API Ingest access for ' . implode(', ', array_values($required))
            : ($missing !== []
                ? 'Configured setup token is not accepted for: ' . implode(', ', $missing)
                : 'API Ingest fulfillment access endpoint did not authenticate or respond'),
        'platforms' => array_values($allowed),
    ];
}

/** @return array{ready:bool,checks:array<int,array{key:string,label:string,ready:bool,detail:string}>,sources:array<int,string>} */
function jg_store_ops_big_set_readiness(PDO $pdo): array
{
    $checks = [];
    $add = static function (string $key, string $label, bool $ready, string $detail) use (&$checks): void {
        $checks[] = compact('key', 'label', 'ready', 'detail');
    };
    try {
        jg_store_ops_website_ensure_schema($pdo);
        $pdo->query('SELECT id FROM store_ops_order_fulfillment_v2 LIMIT 1');
        $add('fulfillment_db', 'Store Ops fulfillment database', true, 'Fulfillment and website-ingestion tables are readable');
    } catch (Throwable $error) {
        $add('fulfillment_db', 'Store Ops fulfillment database', false, $error->getMessage());
    }
    $explicitSources = jg_store_ops_website_config('JG_MARKETPLACE_SOURCES', 'marketplace_sources');
    $sources = jg_store_ops_big_set_sources();
    $sourceScopeReady = trim($explicitSources) !== '' && $sources !== [];
    $add(
        'marketplace_sources',
        'Explicit Store Ops marketplace sources',
        $sourceScopeReady,
        $sourceScopeReady
            ? implode(', ', $sources)
            : 'JG_MARKETPLACE_SOURCES / marketplace_sources must explicitly include every API Ingest automatic shipment source'
    );
    try {
        $state = jg_store_ops_website_state($pdo);
        if (!empty($state['enabled'])) {
            $frozenSources = (array) ($state['automatic_sources'] ?? []);
            $missingFrozenSources = array_values(array_diff($frozenSources, $sources));
            $frozenReady = $frozenSources !== [] && $missingFrozenSources === [];
            $add(
                'frozen_automatic_sources',
                'Frozen automatic shipment sources',
                $frozenReady,
                $frozenReady
                    ? implode(', ', $frozenSources)
                    : ($frozenSources === []
                        ? 'The active Store Ops cutover has no frozen automatic source scope.'
                        : 'Store Ops configuration is missing frozen sources: ' . implode(', ', $missingFrozenSources))
            );
        }
    } catch (Throwable $error) {
        $add('frozen_automatic_sources', 'Frozen automatic shipment sources', false, $error->getMessage());
    }
    $baseUrl = rtrim(jg_store_ops_website_config('JG_SHOPEE_INGEST_BASE_URL', 'shopee_ingest_base_url', 'https://api.jenanggemi.com'), '/');
    $access = ['ready' => false, 'detail' => 'API Ingest base URL or setup token is missing', 'platforms' => []];
    if ($baseUrl !== '' && $sources !== []) {
        $requiredPlatforms = [];
        foreach ($sources as $source) {
            $platform = (string) (explode(':', $source, 2)[0] ?? '');
            if (in_array($platform, ['shopee', 'tiktok'], true)) {
                $requiredPlatforms[$platform] = $platform;
            }
        }
        $allowedPlatforms = [];
        $responsesByToken = [];
        foreach (array_values($requiredPlatforms) as $platform) {
            $setupToken = jg_store_ops_marketplace_setup_token($platform);
            if ($setupToken === '') {
                continue;
            }
            $tokenKey = hash('sha256', $setupToken);
            if (!array_key_exists($tokenKey, $responsesByToken)) {
                $context = stream_context_create(['http' => [
                    'method' => 'GET',
                    'header' => "Accept: application/json\r\nAuthorization: Bearer {$setupToken}\r\n",
                    'timeout' => 3,
                    'ignore_errors' => true,
                ]]);
                $raw = @file_get_contents($baseUrl . '/fulfillment/access', false, $context);
                $decoded = is_string($raw) ? json_decode($raw, true) : null;
                $responsesByToken[$tokenKey] = is_array($decoded) ? $decoded : [];
            }
            $response = $responsesByToken[$tokenKey];
            if (!empty($response['ok']) && in_array($platform, (array) ($response['platforms'] ?? []), true)) {
                $allowedPlatforms[] = $platform;
            }
        }
        $access = jg_store_ops_big_set_api_access_response(['ok' => true, 'platforms' => $allowedPlatforms], $sources);
    }
    $add('api_ingest_callback', 'API Ingest order and callback access', $access['ready'], $access['detail']);
    return [
        'ready' => !in_array(false, array_column($checks, 'ready'), true),
        'checks' => $checks,
        'sources' => $sources,
    ];
}

function jg_store_ops_website_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function jg_store_ops_website_ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_website_ingestion (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            enabled TINYINT(1) NOT NULL DEFAULT 0,
            activated_at DATETIME(6) NULL DEFAULT NULL,
            activated_by VARCHAR(160) NOT NULL DEFAULT "",
            automatic_sources_json LONGTEXT NULL DEFAULT NULL,
            automation_paused TINYINT(1) NOT NULL DEFAULT 1,
            automation_paused_at DATETIME NULL DEFAULT NULL,
            automation_paused_by VARCHAR(160) NOT NULL DEFAULT "",
            updated_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    jg_store_ops_fulfillment_ensure_column(
        $pdo,
        'store_ops_website_ingestion',
        'automatic_sources_json',
        'LONGTEXT NULL DEFAULT NULL AFTER activated_by'
    );
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_website_ingestion', 'automation_paused', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER automatic_sources_json');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_website_ingestion', 'automation_paused_at', 'DATETIME NULL DEFAULT NULL AFTER automation_paused');
    jg_store_ops_fulfillment_ensure_column($pdo, 'store_ops_website_ingestion', 'automation_paused_by', 'VARCHAR(160) NOT NULL DEFAULT "" AFTER automation_paused_at');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_website_orders (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            source_platform VARCHAR(40) NOT NULL,
            order_id VARCHAR(40) NOT NULL,
            payload_json LONGTEXT NOT NULL,
            status VARCHAR(48) NOT NULL DEFAULT "IS_LISTED",
            stock_deducted_at DATETIME NULL DEFAULT NULL,
            source_created_at DATETIME(6) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            UNIQUE KEY uniq_store_ops_website_order (source_platform, order_id),
            KEY idx_store_ops_website_status (status, source_created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    jg_store_ops_fulfillment_ensure_column(
        $pdo,
        'store_ops_website_orders',
        'stock_deducted_at',
        'DATETIME NULL DEFAULT NULL AFTER status'
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_order_stock_deductions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            source_platform VARCHAR(40) NOT NULL,
            order_id VARCHAR(40) NOT NULL,
            sku VARCHAR(24) NOT NULL,
            quantity INT UNSIGNED NOT NULL,
            stock_before INT NOT NULL,
            stock_after INT NOT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE KEY uniq_store_ops_order_stock_sku (source_platform, order_id, sku),
            KEY idx_store_ops_order_stock_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $pdo->prepare(
        'INSERT INTO store_ops_website_ingestion (id, enabled, activated_at, activated_by, updated_at)
         VALUES (1, 0, NULL, "", :updated_at)
         ON DUPLICATE KEY UPDATE id = id'
    )->execute([':updated_at' => jg_store_ops_website_now()]);

    $row = $pdo->query(
        'SELECT enabled, activated_at, automatic_sources_json
         FROM store_ops_website_ingestion WHERE id = 1'
    )->fetch();
    if ((bool) (int) ($row['enabled'] ?? 0)) {
        $storedSources = json_decode((string) ($row['automatic_sources_json'] ?? ''), true);
        $storedSources = jg_store_ops_normalize_marketplace_sources(is_array($storedSources) ? $storedSources : []);
        $expandedSources = jg_store_ops_zero_scope_expansion($row['activated_at'] ?? '', $storedSources);
        if ($expandedSources !== $storedSources) {
            $encoded = json_encode($expandedSources, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($encoded)) {
                throw new RuntimeException('Unable to encode the authorized ZERO automatic source expansion.');
            }
            $pdo->prepare(
                'UPDATE store_ops_website_ingestion
                 SET automatic_sources_json = :automatic_sources_json, updated_at = :updated_at
                 WHERE id = 1 AND enabled = 1'
            )->execute([
                ':automatic_sources_json' => $encoded,
                ':updated_at' => jg_store_ops_website_now(),
            ]);
        }
    }
}

function jg_store_ops_website_state(PDO $pdo, bool $forUpdate = false): array
{
    if (!$pdo->inTransaction()) {
        jg_store_ops_website_ensure_schema($pdo);
    }
    $row = $pdo->query(
        'SELECT enabled, activated_at, activated_by, automatic_sources_json,
                automation_paused, automation_paused_at, automation_paused_by, updated_at
         FROM store_ops_website_ingestion WHERE id = 1' . ($forUpdate ? ' FOR UPDATE' : '')
    )->fetch();
    $automaticSources = json_decode((string) ($row['automatic_sources_json'] ?? ''), true);
    return [
        'enabled' => (bool) (int) ($row['enabled'] ?? 0),
        'activated_at' => isset($row['activated_at']) ? (string) $row['activated_at'] : null,
        'activated_by' => (string) ($row['activated_by'] ?? ''),
        'automatic_sources' => jg_store_ops_normalize_marketplace_sources(is_array($automaticSources) ? $automaticSources : []),
        'automation_paused' => (bool) (int) ($row['automation_paused'] ?? 0),
        'automation_paused_at' => !empty($row['automation_paused_at']) ? (string) $row['automation_paused_at'] : null,
        'automation_paused_by' => (string) ($row['automation_paused_by'] ?? ''),
        'updated_at' => (string) ($row['updated_at'] ?? ''),
    ];
}

function jg_store_ops_website_token_matches(): bool
{
    $expected = jg_store_ops_website_token();
    if ($expected === '') return false;
    $authorization = trim((string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
    $provided = str_starts_with($authorization, 'Bearer ') ? trim(substr($authorization, 7)) : '';
    return $provided !== '' && hash_equals($expected, $provided);
}

function jg_store_ops_website_parse_utc(mixed $value): DateTimeImmutable
{
    $value = trim((string) $value);
    if (
        $value === ''
        || preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/', $value) !== 1
    ) {
        throw new InvalidArgumentException('A UTC timestamp is required.');
    }
    $date = new DateTimeImmutable($value, new DateTimeZone('UTC'));
    $errors = DateTimeImmutable::getLastErrors();
    if (is_array($errors) && ((int) $errors['warning_count'] > 0 || (int) $errors['error_count'] > 0)) {
        throw new InvalidArgumentException('A valid UTC timestamp is required.');
    }
    return $date->setTimezone(new DateTimeZone('UTC'));
}

function jg_store_ops_website_activation_requires_readiness(array $state): bool
{
    return empty($state['enabled']);
}

function jg_store_ops_website_cutover_matches(mixed $existing, mixed $incoming): bool
{
    return jg_store_ops_website_parse_utc($existing)->format('Y-m-d H:i:s.u')
        === jg_store_ops_website_parse_utc($incoming)->format('Y-m-d H:i:s.u');
}

function jg_store_ops_website_activate(PDO $pdo, array $payload): array
{
    if (empty($payload['enabled'])) {
        throw new InvalidArgumentException('Hard Set activation must be enabled.');
    }
    $activatedAt = jg_store_ops_website_parse_utc($payload['activated_at'] ?? '');
    $actor = mb_substr(trim((string) ($payload['activated_by'] ?? 'Executive Dashboard')), 0, 160);
    $configuredSources = jg_store_ops_big_set_sources();
    $automaticSources = jg_store_ops_website_activation_sources(
        $payload['automatic_sources'] ?? [],
        $configuredSources
    );
    $sourcesJson = json_encode($automaticSources, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($sourcesJson)) {
        throw new RuntimeException('Unable to encode the frozen automatic source scope.');
    }
    jg_store_ops_website_ensure_schema($pdo);
    $pdo->beginTransaction();
    try {
        $state = jg_store_ops_website_state($pdo, true);
        if (!empty($state['enabled'])) {
            if (!jg_store_ops_website_cutover_matches((string) $state['activated_at'], $activatedAt->format('Y-m-d H:i:s.u'))) {
                throw new RuntimeException('Store Ops already has a different permanent cutover timestamp.');
            }
            if ((array) ($state['automatic_sources'] ?? []) !== $automaticSources) {
                throw new RuntimeException('Store Ops already has a different frozen automatic source scope.');
            }
            $pdo->commit();
            return $state;
        }
        $formatted = $activatedAt->format('Y-m-d H:i:s.u');
        $pdo->prepare(
            'UPDATE store_ops_website_ingestion
             SET enabled = 1, activated_at = :activated_at, activated_by = :activated_by,
                 automatic_sources_json = :automatic_sources_json,
                 automation_paused = 1, automation_paused_at = :automation_paused_at,
                 automation_paused_by = :automation_paused_by,
                 updated_at = :updated_at
             WHERE id = 1 AND enabled = 0'
        )->execute([
            ':activated_at' => $formatted,
            ':activated_by' => $actor,
            ':automatic_sources_json' => $sourcesJson,
            ':automation_paused_at' => jg_store_ops_website_now(),
            ':automation_paused_by' => 'Paused on activation',
            ':updated_at' => jg_store_ops_website_now(),
        ]);
        $pdo->commit();
        return jg_store_ops_website_state($pdo);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function jg_store_ops_website_set_automation_paused(PDO $pdo, array $payload): array
{
    if (!array_key_exists('automation_paused', $payload)) {
        throw new InvalidArgumentException('The automatic shipment pause state is required.');
    }
    $paused = filter_var($payload['automation_paused'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
    if ($paused === null) {
        throw new InvalidArgumentException('The automatic shipment pause state is invalid.');
    }
    jg_store_ops_website_ensure_schema($pdo);
    $pdo->beginTransaction();
    try {
        $state = jg_store_ops_website_state($pdo, true);
        if (empty($state['enabled']) || empty($state['activated_at'])) {
            throw new RuntimeException('Big Set must be activated before automatic shipment arrangement can be paused or resumed.');
        }
        if (!jg_store_ops_website_cutover_matches(
            (string) $state['activated_at'],
            (string) ($payload['activated_at'] ?? $payload['activated_at_iso'] ?? '')
        )) {
            throw new RuntimeException('The automation update does not match the permanent Store Ops cutover timestamp.');
        }
        $requestedSources = jg_store_ops_website_activation_sources(
            $payload['automatic_sources'] ?? [],
            jg_store_ops_big_set_sources()
        );
        if ($requestedSources !== (array) ($state['automatic_sources'] ?? [])) {
            throw new RuntimeException('The automation update does not match the frozen automatic source scope.');
        }
        if ((bool) ($state['automation_paused'] ?? false) === $paused) {
            $pdo->commit();
            return $state;
        }
        $actor = mb_substr(trim((string) ($payload['automation_changed_by'] ?? $payload['activated_by'] ?? 'Executive Dashboard')), 0, 160);
        $now = jg_store_ops_website_now();
        $pdo->prepare(
            'UPDATE store_ops_website_ingestion
             SET automation_paused = :automation_paused,
                 automation_paused_at = :automation_paused_at,
                 automation_paused_by = :automation_paused_by,
                 updated_at = :updated_at
             WHERE id = 1 AND enabled = 1'
        )->execute([
            ':automation_paused' => $paused ? 1 : 0,
            ':automation_paused_at' => $paused ? $now : null,
            ':automation_paused_by' => $actor,
            ':updated_at' => $now,
        ]);
        $pdo->commit();
        return jg_store_ops_website_state($pdo);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function jg_store_ops_website_request(string $method, string $url, ?array $payload = null): array
{
    $token = jg_store_ops_website_token();
    $headers = "Accept: application/json\r\nAuthorization: Bearer {$token}\r\n";
    $options = ['method' => $method, 'header' => $headers, 'timeout' => 15, 'ignore_errors' => true];
    if ($payload !== null) {
        $options['header'] .= "Content-Type: application/json\r\n";
        $options['content'] = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    $raw = @file_get_contents($url, false, stream_context_create(['http' => $options]));
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($decoded) || empty($decoded['ok'])) {
        throw new RuntimeException((string) ($decoded['error'] ?? 'Executive website-order feed is unavailable.'));
    }
    return $decoded;
}

function jg_store_ops_website_feed(): array
{
    $base = rtrim(jg_store_ops_website_config('JG_EXECUTIVE_DASHBOARD_URL', 'executive_dashboard_url', 'https://admin.jenanggemi.com'), '/');
    return jg_store_ops_website_request('GET', $base . '/api/website-orders/?action=feed');
}

function jg_store_ops_whatsapp_feed(): array
{
    $base = rtrim(jg_store_ops_website_config('JG_EXECUTIVE_DASHBOARD_URL', 'executive_dashboard_url', 'https://admin.jenanggemi.com'), '/');
    return jg_store_ops_website_request('GET', $base . '/api/whatsapp-orders/?action=feed');
}

/**
 * One WhatsApp order as the Executive Dashboard holds it right now. Unlike the
 * feed, this also answers for an order still queued there.
 */
function jg_store_ops_whatsapp_executive_order(string $orderId): array
{
    $base = rtrim(jg_store_ops_website_config('JG_EXECUTIVE_DASHBOARD_URL', 'executive_dashboard_url', 'https://admin.jenanggemi.com'), '/');
    $response = jg_store_ops_website_request(
        'GET',
        $base . '/api/whatsapp-orders/?action=store_ops_order&order=' . rawurlencode(trim($orderId))
    );
    if (!is_array($response['order'] ?? null)) {
        throw new RuntimeException('Executive Dashboard did not return this WhatsApp order.');
    }
    return $response['order'];
}

function jg_store_ops_website_verified_payload(array $candidate): array
{
    $platform = strtolower(trim((string) ($candidate['platform'] ?? '')));
    $orderId = trim((string) ($candidate['order_id'] ?? $candidate['id'] ?? ''));
    if (!in_array($platform, JG_STORE_OPS_WEBSITE_PLATFORMS, true) || $orderId === '') {
        throw new InvalidArgumentException('Website order source is invalid.');
    }
    $feed = $platform === 'whatsapp' ? jg_store_ops_whatsapp_feed() : jg_store_ops_website_feed();
    if ($platform === 'whatsapp') {
        foreach ((array) ($feed['orders'] ?? []) as $order) {
            if (!is_array($order)) continue;
            if (($order['platform'] ?? '') === $platform && ($order['order_id'] ?? $order['id'] ?? '') === $orderId) {
                return $order;
            }
        }
        throw new RuntimeException('Executive feed did not confirm this WhatsApp order.');
    }
    $hardSet = is_array($feed['hard_set'] ?? null) ? $feed['hard_set'] : [];
    if (empty($hardSet['enabled']) || empty($hardSet['activated_at_iso'])) {
        throw new RuntimeException('Executive Hard Set is not active.');
    }
    foreach ((array) ($feed['orders'] ?? []) as $order) {
        if (!is_array($order)) continue;
        if (($order['platform'] ?? '') === $platform && ($order['order_id'] ?? $order['id'] ?? '') === $orderId) {
            $created = jg_store_ops_website_parse_utc($order['createdAt'] ?? '');
            $activated = jg_store_ops_website_parse_utc($hardSet['activated_at_iso']);
            if ($created <= $activated) {
                throw new RuntimeException('Website order is outside the permanent cutover boundary.');
            }
            return $order;
        }
    }
    throw new RuntimeException('Executive feed did not confirm this eligible website order.');
}

function jg_store_ops_website_ingest(PDO $pdo, array $candidate): array
{
    $candidatePlatform = strtolower(trim((string) ($candidate['platform'] ?? '')));
    $state = jg_store_ops_website_state($pdo);
    if ($candidatePlatform !== 'whatsapp' && (empty($state['enabled']) || empty($state['activated_at']))) {
        throw new RuntimeException('Website-order ingestion is disabled in Store Ops.');
    }
    $payload = jg_store_ops_website_verified_payload($candidate);
    $platform = (string) $payload['platform'];
    $orderId = (string) ($payload['order_id'] ?? $payload['id']);
    $created = jg_store_ops_website_parse_utc($payload['createdAt'] ?? '');
    $activated = $platform === 'whatsapp' ? null : jg_store_ops_website_parse_utc((string) $state['activated_at']);
    if ($activated instanceof DateTimeImmutable && $created <= $activated) {
        throw new RuntimeException('Store Ops rejected a pre-cutover website order.');
    }
    $now = jg_store_ops_website_now();
    $stmt = $pdo->prepare(
        'INSERT INTO store_ops_website_orders
            (source_platform, order_id, payload_json, status, source_created_at, created_at, updated_at)
         VALUES
            (:source_platform, :order_id, :payload_json, "IS_LISTED", :source_created_at, :created_at, :updated_at)
         ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json),
            status = IF(status = "QUEUED", "IS_LISTED", status), updated_at = VALUES(updated_at)'
    );
    $stmt->execute([
        ':source_platform' => $platform,
        ':order_id' => $orderId,
        ':payload_json' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ':source_created_at' => $created->format('Y-m-d H:i:s.u'),
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);
    return $payload;
}

function jg_store_ops_website_orders(PDO $pdo): array
{
    $state = jg_store_ops_website_state($pdo);
    if (!empty($state['enabled']) && !empty($state['activated_at'])) {
        $stmt = $pdo->prepare(
            'SELECT source_platform, order_id, payload_json, status, source_created_at
             FROM store_ops_website_orders
             WHERE status IN ("IS_LISTED", "IS_BEING_FULFILLED")
               AND (source_platform = "whatsapp" OR source_created_at > :activated_at)
             ORDER BY source_created_at'
        );
        $stmt->execute([':activated_at' => $state['activated_at']]);
    } else {
        $stmt = $pdo->query(
            'SELECT source_platform, order_id, payload_json, status, source_created_at
             FROM store_ops_website_orders
             WHERE status IN ("IS_LISTED", "IS_BEING_FULFILLED") AND source_platform = "whatsapp"
             ORDER BY source_created_at'
        );
    }
    $orders = [];
    foreach ($stmt->fetchAll() as $row) {
        $payload = json_decode((string) $row['payload_json'], true);
        if (!is_array($payload)) continue;
        $payload['status'] = (string) $row['status'];
        $orders[] = $payload;
    }
    return $orders;
}

function jg_store_ops_website_find(PDO $pdo, string $platform, string $orderId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT payload_json, status FROM store_ops_website_orders WHERE source_platform = :platform AND order_id = :order_id LIMIT 1'
    );
    $stmt->execute([':platform' => $platform, ':order_id' => $orderId]);
    $row = $stmt->fetch();
    if (!is_array($row)) return null;
    $payload = json_decode((string) $row['payload_json'], true);
    if (!is_array($payload)) return null;
    $payload['status'] = (string) $row['status'];
    return $payload;
}

function jg_store_ops_website_stock_lines(array $payload): array
{
    $lines = [];
    foreach ((array) ($payload['items'] ?? []) as $item) {
        if (!is_array($item)) continue;
        $sku = strtoupper(trim((string) ($item['sku'] ?? '')));
        $quantity = (int) ($item['quantity'] ?? 0);
        if ($sku === '' || $quantity < 1 || $quantity > 9999) {
            throw new InvalidArgumentException('Order contains an invalid stock line.');
        }
        $lines[$sku] = ($lines[$sku] ?? 0) + $quantity;
        if ($lines[$sku] > 9999) {
            throw new InvalidArgumentException('Order stock quantity is too large.');
        }
    }
    if ($lines === []) {
        throw new InvalidArgumentException('Order does not contain stock lines.');
    }
    ksort($lines, SORT_STRING);
    return $lines;
}

function jg_store_ops_website_deduct_stock(PDO $pdo, string $platform, string $orderId, array $skuOverrides = []): bool
{
    $platform = strtolower(trim($platform));
    $orderId = trim($orderId);
    if (!in_array($platform, JG_STORE_OPS_WEBSITE_PLATFORMS, true)) return false;
    if ($orderId === '') throw new InvalidArgumentException('Order ID is required for stock deduction.');
    jg_store_ops_website_ensure_schema($pdo);

    $orderStmt = $pdo->prepare(
        'SELECT payload_json, stock_deducted_at
         FROM store_ops_website_orders
         WHERE source_platform = :platform AND order_id = :order_id
         LIMIT 1'
    );
    $orderStmt->execute([':platform' => $platform, ':order_id' => $orderId]);
    $order = $orderStmt->fetch();
    if (!is_array($order)) throw new RuntimeException('Order is missing from Store Ops.');
    if (!empty($order['stock_deducted_at'])) {
        return false;
    }

    $payload = json_decode((string) $order['payload_json'], true);
    if (!is_array($payload)) throw new RuntimeException('Order payload is invalid.');
    $items = [];
    foreach (jg_store_ops_website_stock_lines($payload) as $sku => $quantity) {
        $items[] = ['source_tag' => $sku, 'sku' => $sku, 'quantity' => $quantity];
    }
    $items = jg_store_ops_order_stock_apply_sku_overrides($items, $skuOverrides);
    $result = jg_store_ops_order_stock_deduct($pdo, [
        'source_platform' => $platform,
        'source_account' => $platform,
        'order_id' => $orderId,
    ], $items);

    $now = jg_store_ops_website_now();
    $pdo->prepare(
        'UPDATE store_ops_website_orders
         SET stock_deducted_at = COALESCE(stock_deducted_at, :deducted_at), updated_at = :updated_at
         WHERE source_platform = :platform AND order_id = :order_id'
    )->execute([
        ':deducted_at' => $now,
        ':updated_at' => $now,
        ':platform' => $platform,
        ':order_id' => $orderId,
    ]);
    return !empty($result['deducted']);
}

/**
 * Include the pre-ASTRA website marker so orders completed during the earlier
 * rollout can still be audited safely. New completions are proven by the
 * account-scoped ASTRA ledger.
 *
 * @return array{deducted:bool,status:string,deducted_at:?string,deductions:array<int,array<string,mixed>>,has_shortage:bool,shortage_base_quantity:int,legacy_marker:bool}
 */
function jg_store_ops_website_stock_state(PDO $pdo, string $platform, string $orderId): array
{
    $platform = strtolower(trim($platform));
    $orderId = trim($orderId);
    if (!in_array($platform, JG_STORE_OPS_WEBSITE_PLATFORMS, true) || $orderId === '') {
        throw new InvalidArgumentException('A website or WhatsApp order is required for stock audit.');
    }
    jg_store_ops_website_ensure_schema($pdo);
    $ledger = jg_store_ops_order_stock_state($pdo, [
        'source_platform' => $platform,
        'source_account' => $platform,
        'order_id' => $orderId,
    ]);
    $stmt = $pdo->prepare(
        'SELECT stock_deducted_at
         FROM store_ops_website_orders
         WHERE source_platform = :platform AND order_id = :order_id
         LIMIT 1'
    );
    $stmt->execute([':platform' => $platform, ':order_id' => $orderId]);
    $legacyDeductedAt = $stmt->fetchColumn();
    $legacyMarker = is_string($legacyDeductedAt) && trim($legacyDeductedAt) !== '';
    if ($legacyMarker && empty($ledger['deducted'])) {
        $ledger['deducted'] = true;
        $ledger['status'] = 'legacy_deducted';
        $ledger['deducted_at'] = trim((string) $legacyDeductedAt);
    }
    $ledger['legacy_marker'] = $legacyMarker;
    return $ledger;
}

function jg_store_ops_website_callback(PDO $pdo, string $platform, string $orderId, string $status): void
{
    if (!in_array($platform, JG_STORE_OPS_WEBSITE_PLATFORMS, true)) return;
    $status = strtoupper($status);
    if (!in_array($status, ['IS_BEING_FULFILLED', 'FULFILLED'], true)) return;
    // The Store Ops source row must never remain Listed after the shared
    // fulfillment transaction is final. Persist locally before the remote
    // callback; if the callback fails, the caller keeps its durable action
    // queued and retries this idempotent operation.
    jg_store_ops_website_set_local_status($pdo, $platform, $orderId, $status);
    jg_store_ops_website_send_status($platform, $orderId, $status);
}

/** The Store Ops copy of a website/WhatsApp order (what the board lists). */
function jg_store_ops_website_set_local_status(PDO $pdo, string $platform, string $orderId, string $status): void
{
    if (!in_array($platform, JG_STORE_OPS_WEBSITE_PLATFORMS, true)) return;
    $pdo->prepare(
        'UPDATE store_ops_website_orders SET status = :status, updated_at = :updated_at WHERE source_platform = :platform AND order_id = :order_id'
    )->execute([':status' => strtoupper($status), ':updated_at' => jg_store_ops_website_now(), ':platform' => $platform, ':order_id' => $orderId]);
}

/** Tell the Executive Dashboard (sent from the status queue). */
function jg_store_ops_website_send_status(string $platform, string $orderId, string $status): void
{
    $status = strtoupper($status);
    $base = rtrim(jg_store_ops_website_config('JG_EXECUTIVE_DASHBOARD_URL', 'executive_dashboard_url', 'https://admin.jenanggemi.com'), '/');
    $callbackPath = $platform === 'whatsapp' ? '/api/whatsapp-orders/?action=status_callback' : '/api/website-orders/?action=status_callback';
    jg_store_ops_website_request('POST', $base . $callbackPath, [
        'platform' => $platform,
        'order_id' => $orderId,
        'status' => $status,
    ]);
}

function jg_store_ops_whatsapp_remove_from_listed(PDO $pdo, string $orderId): void
{
    $orderId = trim($orderId);
    if ($orderId === '') {
        throw new InvalidArgumentException('WhatsApp order ID is required for removal.');
    }

    $stmt = $pdo->prepare(
        'UPDATE store_ops_website_orders
         SET status = "REMOVED", updated_at = :updated_at
         WHERE source_platform = "whatsapp"
           AND order_id = :order_id
           AND status IN ("IS_LISTED", "IS_BEING_FULFILLED")'
    );
    $stmt->execute([
        ':updated_at' => jg_store_ops_website_now(),
        ':order_id' => $orderId,
    ]);
    if ($stmt->rowCount() > 0) {
        return;
    }

    $statusStmt = $pdo->prepare(
        'SELECT status
         FROM store_ops_website_orders
         WHERE source_platform = "whatsapp" AND order_id = :order_id
         LIMIT 1'
    );
    $statusStmt->execute([':order_id' => $orderId]);
    $status = strtoupper(trim((string) $statusStmt->fetchColumn()));
    if ($status === 'REMOVED') {
        return;
    }
    if ($status === '') {
        throw new RuntimeException('WhatsApp order is missing from Store Ops.');
    }
    throw new RuntimeException('This WhatsApp order is no longer listed and cannot be removed.');
}

function jg_store_ops_whatsapp_has_removal_event(PDO $pdo, string $orderId): bool
{
    $stmt = $pdo->prepare(
        'SELECT 1
         FROM store_ops_order_events_v2
         WHERE source_platform = "whatsapp"
           AND source_account = "whatsapp"
           AND order_id = :order_id
           AND event_type = "remove_from_listed"
         LIMIT 1'
    );
    $stmt->execute([':order_id' => $orderId]);
    return $stmt->fetchColumn() !== false;
}

/** @return array{order_id:string,status:string} */
function jg_store_ops_whatsapp_cancel_unclaimed(
    PDO $pdo,
    string $orderId,
    array $auditPayload = [],
    string $employeeId = 'executive-dashboard',
    string $employeeName = 'Executive Dashboard'
): array
{
    $orderId = trim($orderId);
    if ($orderId === '') {
        throw new InvalidArgumentException('WhatsApp order ID is required for cancellation.');
    }

    $key = [
        'source_platform' => 'whatsapp',
        'source_account' => 'whatsapp',
        'order_id' => $orderId,
    ];
    $pdo->beginTransaction();
    try {
        jg_store_ops_fulfillment_insert_order_if_missing($pdo, $key);
        $fulfillment = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!is_array($fulfillment)) {
            throw new RuntimeException('Unable to check whether this WhatsApp order has been claimed.');
        }

        $fulfillmentStatus = strtoupper(trim((string) ($fulfillment['status'] ?? 'UNCLAIMED'))) ?: 'UNCLAIMED';
        $claimedBy = trim((string) ($fulfillment['claimed_by'] ?? ''));
        $sourceStmt = $pdo->prepare(
            'SELECT status
             FROM store_ops_website_orders
             WHERE source_platform = "whatsapp" AND order_id = :order_id
             LIMIT 1 FOR UPDATE'
        );
        $sourceStmt->execute([':order_id' => $orderId]);
        $sourceStatus = strtoupper(trim((string) $sourceStmt->fetchColumn()));
        $legacyRemoval = $sourceStatus === 'REMOVED'
            && $fulfillmentStatus === 'FULFILLED'
            && $claimedBy === ''
            && jg_store_ops_whatsapp_has_removal_event($pdo, $orderId);
        $alreadyCancelled = $sourceStatus === 'CANCELLED' || $fulfillmentStatus === 'CANCELLED';
        if (!$alreadyCancelled && !$legacyRemoval && ($claimedBy !== '' || $fulfillmentStatus !== 'UNCLAIMED')) {
            throw new RuntimeException('This WhatsApp order has already been claimed or processed in Store Ops and cannot be cancelled.');
        }
        if (!$alreadyCancelled && !$legacyRemoval && !in_array($sourceStatus, ['IS_LISTED', 'IS_BEING_FULFILLED'], true)) {
            throw new RuntimeException($sourceStatus === ''
                ? 'WhatsApp order is missing from Store Ops.'
                : 'Only an active, unclaimed WhatsApp order can be cancelled.');
        }

        $now = jg_store_ops_website_now();
        $pdo->prepare(
            'UPDATE store_ops_order_fulfillment_v2
             SET status = "CANCELLED", claimed_by = NULL, claimed_at = NULL,
                 last_activity_at = :last_activity_at, updated_at = :updated_at
             WHERE id = :id'
        )->execute([
            ':last_activity_at' => $now,
            ':updated_at' => $now,
            ':id' => (int) $fulfillment['id'],
        ]);
        $pdo->prepare(
            'UPDATE store_ops_website_orders
             SET status = "CANCELLED", updated_at = :updated_at
             WHERE source_platform = "whatsapp" AND order_id = :order_id'
        )->execute([':updated_at' => $now, ':order_id' => $orderId]);
        jg_store_ops_fulfillment_log_event(
            $pdo,
            $key,
            'cancel',
            $employeeId,
            $employeeName,
            array_merge(['message' => 'Cancelled before the order was claimed.'], $auditPayload)
        );
        $pdo->commit();
        return ['order_id' => $orderId, 'status' => 'CANCELLED'];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

/**
 * Pull an untouched WhatsApp order back to the Executive queue. The source row
 * is kept as QUEUED so the same order can be listed again when it is re-sent.
 *
 * @return array{order_id:string,status:string}
 */
function jg_store_ops_whatsapp_recall_unclaimed(PDO $pdo, string $orderId): array
{
    $orderId = trim($orderId);
    if ($orderId === '') {
        throw new InvalidArgumentException('WhatsApp order ID is required to queue it.');
    }

    $key = [
        'source_platform' => 'whatsapp',
        'source_account' => 'whatsapp',
        'order_id' => $orderId,
    ];
    $pdo->beginTransaction();
    try {
        jg_store_ops_fulfillment_insert_order_if_missing($pdo, $key);
        $fulfillment = jg_store_ops_fulfillment_fetch_order($pdo, $key, true);
        if (!is_array($fulfillment)) {
            throw new RuntimeException('Unable to check whether this WhatsApp order has been claimed.');
        }
        $sourceStmt = $pdo->prepare(
            'SELECT status
             FROM store_ops_website_orders
             WHERE source_platform = "whatsapp" AND order_id = :order_id
             LIMIT 1 FOR UPDATE'
        );
        $sourceStmt->execute([':order_id' => $orderId]);
        $sourceStatus = strtoupper(trim((string) $sourceStmt->fetchColumn()));
        if ($sourceStatus === '') {
            throw new RuntimeException('WhatsApp order is missing from Store Ops.');
        }
        if ($sourceStatus !== 'QUEUED') {
            $state = jg_store_ops_whatsapp_cancellation_state_from_order($orderId, $sourceStatus, $fulfillment);
            if (!$state['can_queue']) {
                throw new RuntimeException(!empty($state['label_printed']) && $state['can_cancel']
                    ? 'Store Ops already printed the label for this WhatsApp order, so it cannot be moved back to the queue.'
                    : 'This WhatsApp order has already been claimed or processed in Store Ops and cannot be moved back to the queue.');
            }
            $pdo->prepare(
                'UPDATE store_ops_website_orders
                 SET status = "QUEUED", updated_at = :updated_at
                 WHERE source_platform = "whatsapp" AND order_id = :order_id'
            )->execute([':updated_at' => jg_store_ops_website_now(), ':order_id' => $orderId]);
            jg_store_ops_fulfillment_log_event(
                $pdo,
                $key,
                'recall_to_queue',
                'executive-dashboard',
                'Executive Dashboard',
                ['message' => 'Moved back to the Executive queue before the order was claimed.']
            );
        }
        $pdo->commit();
        return ['order_id' => $orderId, 'status' => 'QUEUED'];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

/** @return array{order_id:string,source_status:string,fulfillment_status:string,claimed:bool,processed:bool,cancelled:bool,can_cancel:bool,label_printed:bool,can_queue:bool,display_status:string} */
function jg_store_ops_whatsapp_cancellation_state(PDO $pdo, string $orderId): array
{
    $orderId = trim($orderId);
    if ($orderId === '') {
        throw new InvalidArgumentException('WhatsApp order ID is required.');
    }
    $sourceStmt = $pdo->prepare(
        'SELECT status
         FROM store_ops_website_orders
         WHERE source_platform = "whatsapp" AND order_id = :order_id
         LIMIT 1'
    );
    $sourceStmt->execute([':order_id' => $orderId]);
    $sourceStatus = strtoupper(trim((string) $sourceStmt->fetchColumn()));
    if ($sourceStatus === '') {
        throw new RuntimeException('WhatsApp order is missing from Store Ops.');
    }

    $key = ['source_platform' => 'whatsapp', 'source_account' => 'whatsapp', 'order_id' => $orderId];
    $fulfillment = jg_store_ops_fulfillment_fetch_order($pdo, $key, false);
    return jg_store_ops_whatsapp_cancellation_state_from_order($orderId, $sourceStatus, $fulfillment,
        $sourceStatus === 'REMOVED' && jg_store_ops_whatsapp_has_removal_event($pdo, $orderId));
}

function jg_store_ops_whatsapp_cancellation_state_from_order(string $orderId, string $sourceStatus, ?array $fulfillment, bool $hasRemovalEvent = false): array
{
    $fulfillmentStatus = strtoupper(trim((string) ($fulfillment['status'] ?? 'UNCLAIMED'))) ?: 'UNCLAIMED';
    $claimedBy = trim((string) ($fulfillment['claimed_by'] ?? ''));
    $legacyRemoval = $sourceStatus === 'REMOVED'
        && $fulfillmentStatus === 'FULFILLED'
        && $claimedBy === ''
        && $hasRemovalEvent;
    $cancelled = $legacyRemoval || $sourceStatus === 'CANCELLED' || $fulfillmentStatus === 'CANCELLED';
    $processed = !$legacyRemoval && $fulfillmentStatus === 'FULFILLED';
    $claimed = !$cancelled && !$processed && ($claimedBy !== '' || $fulfillmentStatus !== 'UNCLAIMED');
    $canCancel = !$cancelled && !$claimed && !$processed && in_array($sourceStatus, ['IS_LISTED', 'IS_BEING_FULFILLED'], true);
    $labelPrinted = trim((string) ($fulfillment['label_printed_at'] ?? '')) !== '';
    $displayStatus = $cancelled
        ? 'CANCELLED'
        : ($processed ? 'FULFILLED' : ($claimed ? 'IS_BEING_FULFILLED' : ($canCancel ? 'IS_LISTED' : $sourceStatus)));
    return [
        'order_id' => $orderId,
        'source_status' => $sourceStatus,
        'fulfillment_status' => $fulfillmentStatus,
        'claimed' => $claimed,
        'processed' => $processed,
        'cancelled' => $cancelled,
        'can_cancel' => $canCancel,
        'label_printed' => $labelPrinted,
        'can_queue' => $canCancel && !$labelPrinted,
        'display_status' => $displayStatus,
    ];
}

/** @return array<int,array<string,mixed>> */
function jg_store_ops_whatsapp_lifecycle_states(PDO $pdo, array $orderIds): array
{
    $normalized = [];
    foreach ($orderIds as $orderId) {
        $orderId = trim((string) $orderId);
        if ($orderId === '' || isset($normalized[$orderId])) continue;
        $normalized[$orderId] = true;
        if (count($normalized) >= 100) break;
    }

    $states = [];
    foreach (array_keys($normalized) as $orderId) {
        try {
            $states[] = jg_store_ops_whatsapp_cancellation_state($pdo, $orderId);
        } catch (RuntimeException $error) {
            if (!str_contains($error->getMessage(), 'missing from Store Ops')) throw $error;
        }
    }
    return $states;
}

function jg_store_ops_website_proxy_label(array $order): never
{
    $url = trim((string) ($order['label_url'] ?? ''));
    if ($url === '') throw new RuntimeException('Website order label URL is missing.');
    $cacheKey = 'website|' . $url;
    $cached = function_exists('jg_label_cache_get') ? jg_label_cache_get($cacheKey) : null;
    if ($cached !== null) {
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="website-label-' . preg_replace('/[^A-Za-z0-9_-]+/', '-', (string) ($order['order_id'] ?? $order['id'] ?? 'order')) . '.pdf"');
        header('Cache-Control: private, no-store');
        header('X-Label-Cache: hit');
        echo $cached['raw'];
        exit;
    }
    $token = jg_store_ops_website_token();
    $context = stream_context_create(['http' => [
        'method' => 'GET',
        'header' => "Accept: application/pdf\r\nAuthorization: Bearer {$token}\r\n",
        'timeout' => 30,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $context);
    if (!is_string($raw) || !str_starts_with($raw, '%PDF-')) {
        throw new RuntimeException('Unable to load executive-uploaded website label.');
    }
    if (function_exists('jg_label_cache_put')) jg_label_cache_put($cacheKey, $raw);
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="website-label-' . preg_replace('/[^A-Za-z0-9_-]+/', '-', (string) ($order['order_id'] ?? $order['id'] ?? 'order')) . '.pdf"');
    header('Cache-Control: private, no-store');
    echo $raw;
    exit;
}
