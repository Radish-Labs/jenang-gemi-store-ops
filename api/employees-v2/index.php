<?php
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/auth-runtime.php';

jg_admin_require_auth_json();
header('Content-Type: application/json; charset=utf-8');

function jg_store_ops_employees_v2_fail(string $message, int $status = 400): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

function jg_store_ops_employees_v2_request_json(): array
{
    $raw = file_get_contents('php://input');
    $payload = json_decode(is_string($raw) ? $raw : '', true);
    return is_array($payload) ? $payload : [];
}

function jg_store_ops_employees_v2_normalize_id(string $value): string
{
    $normalized = trim(strtolower((string) preg_replace('/[^a-z0-9._-]+/i', '-', $value)), '.-_');
    return substr($normalized, 0, 64);
}

function jg_store_ops_employees_v2_fetch(PDO $pdo): array
{
    $rows = $pdo->query(
        'SELECT id, display_name, active, created_at, updated_at
         FROM store_ops_employees_v2
         ORDER BY active DESC, display_name ASC'
    )->fetchAll();

    return array_values(array_filter(array_map(static function (array $row): array {
        $id = trim((string) ($row['id'] ?? ''));
        if ($id === '') {
            return [];
        }

        return [
            'id' => $id,
            'display_name' => trim((string) ($row['display_name'] ?? $id)) ?: $id,
            'active' => (int) ($row['active'] ?? 0) === 1,
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }, is_array($rows) ? $rows : [])));
}

function jg_store_ops_employees_v2_response(PDO $pdo, array $extra = []): void
{
    echo json_encode(array_merge([
        'ok' => true,
        'employees' => jg_store_ops_employees_v2_fetch($pdo),
        'current_employee' => [
            'id' => jg_admin_current_employee_id(),
            'display_name' => jg_admin_current_employee_name(),
            'can_manage_profiles' => jg_admin_can_manage_employee_profiles(),
        ],
    ], $extra), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!jg_admin_can_manage_employee_profiles()) {
    jg_store_ops_employees_v2_fail('Only an admin employee can manage Store Ops profiles.', 403);
}

try {
    $pdo = jg_store_ops_fulfillment_db();
} catch (Throwable $error) {
    error_log('Store Ops employee profile database unavailable: ' . $error->getMessage());
    jg_store_ops_employees_v2_fail('Unable to connect to the SKU database.', 500);
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'GET') {
    jg_store_ops_employees_v2_response($pdo);
}

if ($method !== 'POST') {
    jg_store_ops_employees_v2_fail('Method not allowed.', 405);
}

$payload = jg_store_ops_employees_v2_request_json();
$action = trim((string) ($payload['action'] ?? 'save_employee'));

if ($action !== 'save_employee') {
    jg_store_ops_employees_v2_fail('Unknown employee action.', 400);
}

$displayName = trim((string) ($payload['display_name'] ?? ''));
$employeeId = jg_store_ops_employees_v2_normalize_id((string) ($payload['id'] ?? ''));
$pin = trim((string) ($payload['pin'] ?? ''));
$active = !empty($payload['active']);
// "create" never touches an existing account; only "update" (Edit) does.
$mode = (string) ($payload['mode'] ?? 'create') === 'update' ? 'update' : 'create';

if ($displayName === '') {
    jg_store_ops_employees_v2_fail('Employee display name is required.');
}

if ($employeeId === '') {
    $employeeId = jg_store_ops_employees_v2_normalize_id($displayName);
}

if ($employeeId === '') {
    jg_store_ops_employees_v2_fail('Employee ID is required.');
}

try {
    $stmt = $pdo->prepare('SELECT id, active FROM store_ops_employees_v2 WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $employeeId]);
    $existing = $stmt->fetch();
    $isExisting = is_array($existing);

    if ($mode === 'create' && $isExisting) {
        jg_store_ops_employees_v2_fail(sprintf('An account with the ID "%s" already exists. Choose another ID, or use Edit on that account.', $employeeId));
    }
    if ($mode === 'update' && !$isExisting) {
        jg_store_ops_employees_v2_fail('That account no longer exists. Reload and try again.');
    }

    // Two active accounts with the same name look identical on the sign-in
    // screen. Turning one off is always allowed, so a duplicate can be retired.
    $stmt = $pdo->prepare(
        'SELECT id FROM store_ops_employees_v2
         WHERE LOWER(TRIM(display_name)) = :display_name AND id <> :id AND active = 1
         LIMIT 1'
    );
    $stmt->execute([':display_name' => strtolower($displayName), ':id' => $employeeId]);
    $sameName = $active ? $stmt->fetchColumn() : false;
    if ($sameName !== false) {
        jg_store_ops_employees_v2_fail(sprintf('Another account ("%s") is already called %s. Use a different name.', (string) $sameName, $displayName));
    }

    if (!$active && hash_equals($employeeId, jg_admin_current_employee_id())) {
        jg_store_ops_employees_v2_fail('You cannot deactivate the employee profile you are using.');
    }

    if (!$isExisting && $pin === '') {
        jg_store_ops_employees_v2_fail('PIN or password is required for a new employee.');
    }

    if ($pin !== '' && strlen($pin) < 4) {
        jg_store_ops_employees_v2_fail('PIN or password must be at least 4 characters.');
    }

    if ($pin !== '' && strlen($pin) > 128) {
        jg_store_ops_employees_v2_fail('PIN or password is too long.');
    }

    if ($isExisting) {
        if ($pin !== '') {
            $stmt = $pdo->prepare(
                'UPDATE store_ops_employees_v2
                 SET display_name = :display_name,
                     pin_hash = :pin_hash,
                     active = :active,
                     updated_at = UTC_TIMESTAMP()
                 WHERE id = :id'
            );
            $stmt->execute([
                ':display_name' => $displayName,
                ':pin_hash' => password_hash($pin, PASSWORD_DEFAULT),
                ':active' => $active ? 1 : 0,
                ':id' => $employeeId,
            ]);
            // A new PIN signs this account out of every remembered device.
            jg_admin_forget_employee_logins($pdo, $employeeId);
        } else {
            $stmt = $pdo->prepare(
                'UPDATE store_ops_employees_v2
                 SET display_name = :display_name,
                     active = :active,
                     updated_at = UTC_TIMESTAMP()
                 WHERE id = :id'
            );
            $stmt->execute([
                ':display_name' => $displayName,
                ':active' => $active ? 1 : 0,
                ':id' => $employeeId,
            ]);
        }
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO store_ops_employees_v2 (id, display_name, pin_hash, active, created_at, updated_at)
             VALUES (:id, :display_name, :pin_hash, :active, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
        );
        $stmt->execute([
            ':id' => $employeeId,
            ':display_name' => $displayName,
            ':pin_hash' => password_hash($pin, PASSWORD_DEFAULT),
            ':active' => $active ? 1 : 0,
        ]);
    }

    jg_store_ops_employees_v2_response($pdo, [
        'saved_employee_id' => $employeeId,
    ]);
} catch (RuntimeException $exception) {
    jg_store_ops_employees_v2_fail($exception->getMessage());
} catch (Throwable $error) {
    error_log('Store Ops employee profile save failed: ' . $error->getMessage());
    jg_store_ops_employees_v2_fail('Unable to save employee profile.', 500);
}
