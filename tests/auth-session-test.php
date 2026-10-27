<?php
declare(strict_types=1);

function auth_session_expect(bool $condition, string $message): void
{
    if ($condition) return;
    throw new RuntimeException($message);
}

$auth = file_get_contents(dirname(__DIR__) . '/auth-runtime.php');
$home = file_get_contents(dirname(__DIR__) . '/store-home.js');
$login = file_get_contents(dirname(__DIR__) . '/index.php');

auth_session_expect(is_string($auth) && str_contains($auth, 'JG_ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60'), 'Store Ops sessions must last one week.');
auth_session_expect(str_contains((string) $auth, "ini_set('session.gc_maxlifetime'"), 'The server-side session lifetime must match the persistent cookie.');
auth_session_expect(str_contains((string) $auth, 'time() - $loginTimestamp >= JG_ADMIN_SESSION_TTL_SECONDS'), 'Weekly sessions must have an explicit server-side expiry.');
auth_session_expect(str_contains((string) $auth, 'A temporary profile-database outage must not eject an operator'), 'A transient employee-directory outage must preserve an already-authenticated fulfillment session.');
auth_session_expect(str_contains((string) $home, "await postOrderAction('claim_order', order)"), 'Starting an order must confirm authentication and the employee claim before opening fulfillment.');
auth_session_expect(!str_contains((string) $home, 'applyOptimisticClaim(order);'), 'Store Ops must not enter fulfillment optimistically before authentication succeeds.');
auth_session_expect(str_contains((string) $home, 'StoreOpsAuthenticationRequiredError') && str_contains((string) $home, 'redirectToStoreOpsLogin'), 'An expired start request must prompt for login before fulfillment.');
auth_session_expect(str_contains((string) $login, 'jg_admin_login_return_path') && str_contains((string) $login, "str_contains(\$path, '..')"), 'Login return paths must remain same-site and traversal-safe.');

$employeesApi = (string) file_get_contents(dirname(__DIR__) . '/api/employees-v2/index.php');
$shell = (string) file_get_contents(dirname(__DIR__) . '/store-ops-shell.php');
$dashboard = (string) file_get_contents(dirname(__DIR__) . '/dashboard/index.php');
auth_session_expect(str_contains((string) $auth, 'JG_ADMIN_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60'), 'A device must stay signed in for 30 days.');
auth_session_expect(str_contains((string) $auth, "hash('sha256', \$token)") && !str_contains((string) $auth, "':token_hash' => \$token"), 'Only a hash of the remember token may be stored.');
auth_session_expect(preg_match('/if \(empty\(\$_SESSION\[\'jg_admin_authenticated\'\]\)\) \{\s*return jg_admin_restore_remembered_login\(\);/', (string) $auth) === 1, 'A remembered device must sign back in when the session is gone.');
auth_session_expect(preg_match('/jg_admin_set_authenticated_employee\(\(string\) \$employee\[\'id\'\], \(string\) \$employee\[\'display_name\'\]\);\s*jg_admin_remember_login/', (string) $auth) === 1, 'A PIN login must remember the device.');
auth_session_expect(preg_match('/function jg_admin_logout\(\): void\s*\{[\s\S]*?DELETE FROM store_ops_login_tokens_v1[\s\S]*?jg_admin_drop_remember_cookie\(\);/', (string) $auth) === 1, 'Logging out must forget the device.');
auth_session_expect(str_contains($employeesApi, "\$mode === 'create' && \$isExisting"), 'Creating a profile must never overwrite an existing account.');
auth_session_expect(str_contains($employeesApi, 'AND id <> :id AND active = 1'), 'Two active accounts must not share a name.');
auth_session_expect(str_contains($employeesApi, 'jg_admin_forget_employee_logins($pdo, $employeeId);'), 'A new PIN must sign the account out of remembered devices.');
auth_session_expect(file_get_contents(dirname(__DIR__) . '/api/employees/index.php') === $employeesApi, 'Both employee APIs must stay identical.');
foreach (['store-shell.js', 'store-home.js'] as $script) {
    auth_session_expect(str_contains((string) file_get_contents(dirname(__DIR__) . '/' . $script), "mode: fields.id instanceof HTMLInputElement && fields.id.readOnly ? 'update' : 'create'"), $script . ' must say whether it creates or edits a profile.');
}
foreach (['store-ops-shell.php' => $shell, 'dashboard/index.php' => $dashboard] as $file => $markup) {
    auth_session_expect(substr_count($markup, 'data-open-account-menu') === 2 && preg_match('/class="admin-store-(sidebar|header)-profile" data-open-employee-profiles/', $markup) !== 1, $file . ': tapping your name must open the account menu, not the profile editor.');
    auth_session_expect(str_contains($markup, 'jg_store_ops_account_menu('), $file . ' must include the account menu.');
    auth_session_expect(preg_match('/name="id"[^>]*autocomplete="off"/', $markup) === 1, $file . ': Chrome must not fill a saved login into the new-profile ID.');
}

echo "auth-session-test: ok\n";
