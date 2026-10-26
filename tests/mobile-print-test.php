<?php
declare(strict_types=1);

require dirname(__DIR__) . '/mobile-scanner.php';
require dirname(__DIR__) . '/mobile-print.php';

function mobile_print_expect(mixed $expected, mixed $actual, string $message): void
{
    if ($expected === $actual) return;
    fwrite(STDERR, $message . PHP_EOL . 'Expected: ' . var_export($expected, true) . PHP_EOL . 'Actual: ' . var_export($actual, true) . PHP_EOL);
    exit(1);
}

// Same switch as mobile-scanner-test.php: JG_TEST_MYSQL_DSN runs it on MySQL/MariaDB.
$mysqlDsn = (string) getenv('JG_TEST_MYSQL_DSN');
if ($mysqlDsn !== '') {
    $pdo = new PDO($mysqlDsn, (string) getenv('JG_TEST_MYSQL_USER'), (string) getenv('JG_TEST_MYSQL_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('DROP TABLE IF EXISTS store_ops_mobile_print_jobs_v1, store_ops_mobile_print_stations_v1');
} elseif (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} else {
    echo "mobile-print-test: skipped (no pdo_sqlite)\n";
    exit(0);
}
jg_mobile_print_ensure_schema($pdo);
jg_mobile_print_ensure_schema($pdo);

$now = time();
$order = ['id' => 'WAEXEC-1', 'platform' => 'whatsapp', 'items' => [['sku' => 'A', 'quantity' => 1]]];
$key = ['order_id' => 'WAEXEC-1', 'source_platform' => 'whatsapp', 'source_account' => 'whatsapp'];

// No computer yet: the job waits and the phone is told.
$request = jg_mobile_print_request($pdo, 'hani', $order, $key, $now);
mobile_print_expect(false, $request['station_online'], 'No print station has checked in yet.');
mobile_print_expect('queued', jg_mobile_print_job_state($pdo, 'hani', $request['job'], $now)['status'], 'New jobs wait in the queue.');

// Another profile's computer never sees it.
mobile_print_expect(null, jg_mobile_print_next_job($pdo, 'budi', $now), 'Jobs are private to the profile.');
mobile_print_expect(null, jg_mobile_print_take($pdo, 'budi', $request['job'], $now), 'Another profile cannot take the job.');

// The computer finds and takes it exactly once.
$next = jg_mobile_print_next_job($pdo, 'hani', $now + 1);
mobile_print_expect($request['job'], $next['job'] ?? null, 'The computer sees the queued job.');
mobile_print_expect(true, jg_mobile_print_station_online($pdo, 'hani', $now + 1), 'Checking for jobs marks the computer online.');
$taken = jg_mobile_print_take($pdo, 'hani', $request['job'], $now + 1);
mobile_print_expect('WAEXEC-1', $taken['order']['id'] ?? null, 'Taking the job returns the order snapshot.');
mobile_print_expect($key, $taken['key'] ?? null, 'Taking the job returns the order key.');
mobile_print_expect(null, jg_mobile_print_take($pdo, 'hani', $request['job'], $now + 1), 'A second tab cannot take the same job.');
mobile_print_expect(null, jg_mobile_print_next_job($pdo, 'hani', $now + 1), 'Taken jobs leave the queue.');

// Progress reaches the phone; printed is final.
mobile_print_expect(true, jg_mobile_print_set_status($pdo, 'hani', $request['job'], 'attention', 'Out of labels', $now + 2), 'Progress can be reported.');
$state = jg_mobile_print_job_state($pdo, 'hani', $request['job'], $now + 2);
mobile_print_expect(['attention', 'Out of labels', true], [$state['status'], $state['detail'], $state['station_online']], 'The phone sees the printer problem.');
mobile_print_expect(true, jg_mobile_print_set_status($pdo, 'hani', $request['job'], 'printed', '', $now + 3), 'Printed can be reported.');
mobile_print_expect(false, jg_mobile_print_set_status($pdo, 'hani', $request['job'], 'failed', 'late', $now + 4), 'A printed job cannot be changed afterwards.');
mobile_print_expect('printed', jg_mobile_print_job_state($pdo, 'hani', $request['job'], $now + 4)['status'], 'Printed stays printed.');
try {
    jg_mobile_print_set_status($pdo, 'hani', $request['job'], 'queued', '', $now);
    fwrite(STDERR, "Unknown status accepted\n");
    exit(1);
} catch (InvalidArgumentException) {
    // Expected.
}

// Sending again replaces an unfinished job, so a label is never printed twice.
$first = jg_mobile_print_request($pdo, 'hani', $order, $key, $now + 10);
$second = jg_mobile_print_request($pdo, 'hani', $order, $key, $now + 11);
mobile_print_expect('cancelled', jg_mobile_print_job_state($pdo, 'hani', $first['job'], $now + 11)['status'], 'The earlier unfinished job is cancelled.');
mobile_print_expect($second['job'], jg_mobile_print_next_job($pdo, 'hani', $now + 11)['job'] ?? null, 'Only the new job is queued.');
mobile_print_expect(true, $second['station_online'], 'The phone is told the computer is online.');

// Old jobs expire instead of printing much later.
mobile_print_expect('expired', jg_mobile_print_job_state($pdo, 'hani', $second['job'], $now + 11 + JG_MOBILE_PRINT_JOB_TTL_SECONDS + 1)['status'], 'Stale jobs expire.');
mobile_print_expect(null, jg_mobile_print_next_job($pdo, 'hani', $now + 11 + JG_MOBILE_PRINT_JOB_TTL_SECONDS + 1), 'The computer ignores expired jobs.');
mobile_print_expect('missing', jg_mobile_print_job_state($pdo, 'budi', $second['job'], $now)['status'], 'Other profiles cannot read the job.');

// Waiting requests return as soon as a job or a change arrives.
$waitPdo = $pdo;
$fresh = jg_mobile_print_request($waitPdo, 'hani', $order, $key, time());
$started = microtime(true);
$waited = jg_mobile_print_station_wait($waitPdo, 'hani', 5);
mobile_print_expect($fresh['job'], $waited['job']['job'] ?? null, 'A waiting computer gets the job.');
mobile_print_expect(true, microtime(true) - $started < 1, 'And gets it immediately.');
$jobWait = jg_mobile_print_job_wait($waitPdo, 'hani', $fresh['job'], '', 5);
mobile_print_expect('queued', $jobWait['status'], 'A waiting phone gets the current state.');
$started = microtime(true);
$same = jg_mobile_print_job_wait($waitPdo, 'hani', $fresh['job'], $jobWait['signature'], 0.4);
mobile_print_expect(true, microtime(true) - $started >= 0.35, 'Nothing changed, so the phone wait waits.');

echo 'mobile-print-test: ok (' . $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) . ")\n";
