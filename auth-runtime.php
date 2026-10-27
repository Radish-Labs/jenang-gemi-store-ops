<?php
declare(strict_types=1);

const JG_ADMIN_CODE_HASH = 'ba7e42d060466c149e331452cc58339e64b62a3b61ed953e90f3ec274495f59d';
const JG_ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// A device stays signed in for 30 days through a separate "remember" cookie,
// even after the PHP session ends. Logging out or a PIN change ends it.
const JG_ADMIN_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;
const JG_ADMIN_REMEMBER_COOKIE = 'jg_admin_remember';

require_once __DIR__ . '/store-ops-fulfillment-runtime.php';

function jg_admin_fallback_code_hash(): string
{
    if (function_exists('jg_store_ops_env_value')) {
        $envValue = jg_store_ops_env_value('JG_ADMIN_CODE_HASH');
        if (preg_match('/^[a-f0-9]{64}$/i', $envValue) === 1) {
            return strtolower($envValue);
        }
    }

    if (function_exists('jg_store_ops_load_local_config')) {
        $config = jg_store_ops_load_local_config();
        $configValue = is_string($config['admin_code_hash'] ?? null) ? trim($config['admin_code_hash']) : '';
        if (preg_match('/^[a-f0-9]{64}$/i', $configValue) === 1) {
            return strtolower($configValue);
        }
    }

    foreach (['JG_ADMIN_CODE_HASH'] as $key) {
        $value = getenv($key);
        if (!is_string($value) || trim($value) === '') {
            $value = $_SERVER[$key] ?? $_ENV[$key] ?? '';
        }

        $value = trim((string) $value);
        if (preg_match('/^[a-f0-9]{64}$/i', $value) === 1) {
            return strtolower($value);
        }
    }

    return JG_ADMIN_CODE_HASH;
}

function jg_admin_employee_profiles_load_failed(?bool $failed = null): bool
{
    static $loadFailed = false;

    if ($failed !== null) {
        $loadFailed = $failed;
    }

    return $loadFailed;
}

function jg_admin_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    ini_set('session.gc_maxlifetime', (string) JG_ADMIN_SESSION_TTL_SECONDS);
    ini_set('session.cookie_lifetime', (string) JG_ADMIN_SESSION_TTL_SECONDS);
    session_set_cookie_params([
        'lifetime' => JG_ADMIN_SESSION_TTL_SECONDS,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    session_name('jg_admin_session');
    session_start();
}

function jg_admin_remember_cookie_options(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function jg_admin_remember_table(PDO $pdo): void
{
    static $ready = false;
    if ($ready) return;
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS store_ops_login_tokens_v1 (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            employee_id VARCHAR(64) NOT NULL,
            created_at INT NOT NULL,
            expires_at INT NOT NULL,
            KEY employee_id (employee_id)
        )'
    );
    $ready = true;
}

function jg_admin_drop_remember_cookie(): void
{
    unset($_COOKIE[JG_ADMIN_REMEMBER_COOKIE]);
    if (!headers_sent()) {
        setcookie(JG_ADMIN_REMEMBER_COOKIE, '', jg_admin_remember_cookie_options(time() - 42000));
    }
}

/** After a PIN login: keep this device signed in for 30 days. */
function jg_admin_remember_login(string $employeeId): void
{
    if ($employeeId === '' || headers_sent()) return;
    try {
        $pdo = jg_store_ops_fulfillment_db();
        jg_admin_remember_table($pdo);
        $now = time();
        $pdo->prepare('DELETE FROM store_ops_login_tokens_v1 WHERE expires_at < :now')->execute([':now' => $now]);
        $token = bin2hex(random_bytes(32));
        $pdo->prepare(
            'INSERT INTO store_ops_login_tokens_v1 (token_hash, employee_id, created_at, expires_at)
             VALUES (:token_hash, :employee_id, :created_at, :expires_at)'
        )->execute([
            ':token_hash' => hash('sha256', $token),
            ':employee_id' => $employeeId,
            ':created_at' => $now,
            ':expires_at' => $now + JG_ADMIN_REMEMBER_TTL_SECONDS,
        ]);
        setcookie(JG_ADMIN_REMEMBER_COOKIE, $token, jg_admin_remember_cookie_options($now + JG_ADMIN_REMEMBER_TTL_SECONDS));
    } catch (Throwable $error) {
        // Without it the normal one-week session still works.
        error_log('Store Ops remember login failed: ' . $error->getMessage());
    }
}

/** No session, but a remembered device: sign it back in as that employee. */
function jg_admin_restore_remembered_login(): bool
{
    $token = (string) ($_COOKIE[JG_ADMIN_REMEMBER_COOKIE] ?? '');
    if ($token === '') return false;
    if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
        jg_admin_drop_remember_cookie();
        return false;
    }
    try {
        $pdo = jg_store_ops_fulfillment_db();
        jg_admin_remember_table($pdo);
        $stmt = $pdo->prepare(
            'SELECT employee_id FROM store_ops_login_tokens_v1
             WHERE token_hash = :token_hash AND expires_at > :now LIMIT 1'
        );
        $stmt->execute([':token_hash' => hash('sha256', $token), ':now' => time()]);
        $employeeId = (string) ($stmt->fetchColumn() ?: '');
    } catch (Throwable) {
        // Database briefly unavailable: keep the cookie and try again later.
        return false;
    }
    $profiles = $employeeId !== '' ? jg_admin_employee_profiles_for_login() : [];
    if ($employeeId !== '' && jg_admin_employee_profiles_load_failed()) {
        return false;
    }
    $employee = null;
    foreach ($profiles as $profile) {
        if (hash_equals((string) ($profile['id'] ?? ''), $employeeId)) {
            $employee = $profile;
            break;
        }
    }
    if ($employee === null) {
        // Expired, logged out, or the profile was turned off.
        jg_admin_drop_remember_cookie();
        return false;
    }
    if (!headers_sent()) {
        session_regenerate_id(true);
    }
    jg_admin_set_authenticated_employee($employeeId, (string) ($employee['display_name'] ?? $employeeId));
    return true;
}

/** Sign every device out of this employee (after a PIN change). */
function jg_admin_forget_employee_logins(PDO $pdo, string $employeeId): void
{
    jg_admin_remember_table($pdo);
    $pdo->prepare('DELETE FROM store_ops_login_tokens_v1 WHERE employee_id = :employee_id')->execute([':employee_id' => $employeeId]);
}

function jg_admin_is_authenticated(): bool
{
    jg_admin_start_session();
    if (empty($_SESSION['jg_admin_authenticated'])) {
        return jg_admin_restore_remembered_login();
    }

    $loginAt = trim((string) ($_SESSION['jg_admin_login_at'] ?? ''));
    $loginTimestamp = $loginAt !== '' ? strtotime($loginAt) : false;
    if ($loginTimestamp === false) {
        // Preserve sessions created immediately before this rollout instead of
        // forcing an unexpected login in the middle of an order.
        $_SESSION['jg_admin_login_at'] = gmdate(DATE_ATOM);
    } elseif (time() - $loginTimestamp >= JG_ADMIN_SESSION_TTL_SECONDS) {
        jg_admin_clear_authenticated_session();
        return jg_admin_restore_remembered_login();
    }

    $employeeId = trim((string) ($_SESSION['jg_admin_employee_id'] ?? ''));
    $employeeProfiles = jg_admin_employee_profiles_for_login();
    if ($employeeProfiles === []) {
        if (jg_admin_employee_profiles_load_failed()) {
            // A temporary profile-database outage must not eject an operator
            // who already has a valid weekly server session mid-fulfillment.
            // New logins still fail closed while the directory is unavailable.
            return true;
        }
        return true;
    }

    foreach ($employeeProfiles as $employee) {
        if (hash_equals((string) ($employee['id'] ?? ''), $employeeId)) {
            return true;
        }
    }

    jg_admin_clear_authenticated_session();
    return false;
}

function jg_admin_password_matches(string $password, string $storedHash): bool
{
    $candidate = trim($password);
    $stored = trim($storedHash);

    if ($candidate === '' || $stored === '') {
        return false;
    }

    if (preg_match('/^[a-f0-9]{64}$/i', $stored) === 1) {
        return hash_equals(strtolower($stored), hash('sha256', $candidate));
    }

    $info = password_get_info($stored);
    if (($info['algo'] ?? 0) !== 0) {
        return password_verify($candidate, $stored);
    }

    return hash_equals($stored, $candidate);
}

function jg_admin_employee_can_remove_orders(string $employeeId): bool
{
    return strtolower(trim($employeeId)) === 'branch-vincent';
}

function jg_admin_verify_employee_passcode(string $employeeId, string $passcode): bool
{
    $employeeId = trim($employeeId);
    if ($employeeId === '' || trim($passcode) === '') {
        return false;
    }

    try {
        $pdo = jg_store_ops_fulfillment_db();
        $stmt = $pdo->prepare(
            'SELECT pin_hash
             FROM store_ops_employees_v2
             WHERE id = :id
               AND active = 1
             LIMIT 1'
        );
        $stmt->execute([':id' => $employeeId]);
        $storedHash = $stmt->fetchColumn();
    } catch (Throwable) {
        return false;
    }

    return is_string($storedHash) && jg_admin_password_matches($passcode, $storedHash);
}

function jg_admin_set_authenticated_employee(string $employeeId, string $employeeName): void
{
    $_SESSION['jg_admin_authenticated'] = true;
    $_SESSION['jg_admin_employee_id'] = $employeeId;
    $_SESSION['jg_admin_employee_name'] = $employeeName;
    $_SESSION['jg_admin_login_at'] = gmdate(DATE_ATOM);
}

function jg_admin_clear_authenticated_session(): void
{
    unset(
        $_SESSION['jg_admin_authenticated'],
        $_SESSION['jg_admin_employee_id'],
        $_SESSION['jg_admin_employee_name'],
        $_SESSION['jg_admin_login_at']
    );
}

function jg_admin_current_employee_id(): string
{
    jg_admin_start_session();
    $employeeId = trim((string) ($_SESSION['jg_admin_employee_id'] ?? ''));
    return $employeeId !== '' ? $employeeId : 'shared-admin';
}

function jg_admin_current_employee_name(): string
{
    jg_admin_start_session();
    $employeeName = trim((string) ($_SESSION['jg_admin_employee_name'] ?? ''));
    return $employeeName !== '' ? $employeeName : 'Admin';
}

function jg_admin_current_employee_is_admin(): bool
{
    return jg_store_ops_fulfillment_is_admin_employee(jg_admin_current_employee_id());
}

function jg_admin_has_active_admin_employee(): bool
{
    try {
        $pdo = jg_store_ops_fulfillment_db();
        $stmt = $pdo->query(
            "SELECT COUNT(*)
             FROM store_ops_employees_v2
             WHERE active = 1
               AND LOWER(id) IN ('admin', 'shared-admin')"
        );
        return (int) $stmt->fetchColumn() > 0;
    } catch (Throwable) {
        return false;
    }
}

function jg_admin_can_manage_employee_profiles(): bool
{
    if (jg_admin_current_employee_is_admin()) {
        return true;
    }

    return !jg_admin_has_active_admin_employee();
}

/**
 * @return array<int, array{id:string,display_name:string,active:int}>
 */
function jg_admin_employee_profiles_for_login(): array
{
    static $profiles = null;

    if (is_array($profiles)) {
        return $profiles;
    }

    try {
        $pdo = jg_store_ops_fulfillment_db();
        $employees = jg_store_ops_fulfillment_active_employees($pdo);
        jg_admin_employee_profiles_load_failed(false);
        if ($employees !== []) {
            $profiles = $employees;
            return $profiles;
        }
    } catch (Throwable) {
        jg_admin_employee_profiles_load_failed(true);
        $profiles = [];
        return $profiles;
    }

    jg_admin_employee_profiles_load_failed(false);
    $profiles = [];
    return $profiles;
}

function jg_admin_attempt_employee_login(string $employeeId, string $pin): bool
{
    jg_admin_start_session();

    $employeeId = trim($employeeId);
    if ($employeeId === '' || trim($pin) === '') {
        jg_admin_clear_authenticated_session();
        return false;
    }

    try {
        $pdo = jg_store_ops_fulfillment_db();
        $stmt = $pdo->prepare(
            'SELECT id, display_name, pin_hash
             FROM store_ops_employees_v2
             WHERE id = :id
               AND active = 1
             LIMIT 1'
        );
        $stmt->execute([':id' => $employeeId]);
        $employee = $stmt->fetch();
    } catch (Throwable) {
        $employee = false;
    }

    if (!is_array($employee) || !jg_admin_password_matches($pin, (string) ($employee['pin_hash'] ?? ''))) {
        jg_admin_clear_authenticated_session();
        return false;
    }

    session_regenerate_id(true);
    jg_admin_set_authenticated_employee((string) $employee['id'], (string) $employee['display_name']);
    jg_admin_remember_login((string) $employee['id']);
    return true;
}

function jg_admin_attempt_login(string $code): bool
{
    jg_admin_start_session();

    if (jg_admin_employee_profiles_for_login() !== [] || jg_admin_employee_profiles_load_failed()) {
        jg_admin_clear_authenticated_session();
        return false;
    }

    $normalized = trim($code);
    $candidateHash = hash('sha256', $normalized);

    if (!hash_equals(jg_admin_fallback_code_hash(), $candidateHash)) {
        jg_admin_clear_authenticated_session();
        return false;
    }

    session_regenerate_id(true);
    jg_admin_set_authenticated_employee('shared-admin', 'Admin');
    return true;
}

function jg_admin_logout(): void
{
    jg_admin_start_session();
    $token = (string) ($_COOKIE[JG_ADMIN_REMEMBER_COOKIE] ?? '');
    if ($token !== '') {
        try {
            $pdo = jg_store_ops_fulfillment_db();
            jg_admin_remember_table($pdo);
            $pdo->prepare('DELETE FROM store_ops_login_tokens_v1 WHERE token_hash = :token_hash')->execute([':token_hash' => hash('sha256', $token)]);
        } catch (Throwable) {
            // The cookie is still removed below.
        }
    }
    jg_admin_drop_remember_cookie();
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', $params['secure'], $params['httponly']);
    }

    session_destroy();
}

function jg_admin_require_auth_json(): void
{
    if (jg_admin_is_authenticated()) {
        return;
    }

    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Unauthorized'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

function jg_admin_require_auth_page(): void
{
    if (jg_admin_is_authenticated()) {
        return;
    }

    header('Location: ./dashboard');
    exit;
}
