<?php
declare(strict_types=1);

// Shipping labels are kept on the server for 10 minutes after the first
// download. The phone's preview, the computer that prints it and a quick
// Reprint then share one download from the marketplace instead of three.
// Files sit in the private temp folder (never the web folder), readable only
// by this account, and old ones are removed as new ones are written.

const JG_LABEL_CACHE_TTL = 600;

function jg_label_cache_dir(): string
{
    $dir = rtrim(sys_get_temp_dir(), '/') . '/jg-store-ops-labels-' . substr(hash('sha256', __DIR__), 0, 12);
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir;
}

function jg_label_cache_file(string $key): string
{
    return jg_label_cache_dir() . '/' . hash('sha256', $key) . '.label';
}

/** @return array{raw:string,content_type:string,headers:array<string,string>}|null */
function jg_label_cache_get(string $key): ?array
{
    $file = jg_label_cache_file($key);
    $modified = @filemtime($file);
    if ($modified === false || time() - $modified > JG_LABEL_CACHE_TTL) {
        return null;
    }
    $data = @unserialize((string) @file_get_contents($file), ['allowed_classes' => false]);
    if (!is_array($data) || !is_string($data['raw'] ?? null) || !str_starts_with(ltrim($data['raw']), '%PDF')) {
        return null;
    }
    return [
        'raw' => $data['raw'],
        'content_type' => (string) ($data['content_type'] ?? 'application/pdf'),
        'headers' => is_array($data['headers'] ?? null) ? $data['headers'] : [],
    ];
}

function jg_label_cache_put(string $key, string $raw, string $contentType = 'application/pdf', array $headers = []): void
{
    if (!str_starts_with(ltrim($raw), '%PDF')) {
        return;
    }
    $dir = jg_label_cache_dir();
    foreach (glob($dir . '/*.label') ?: [] as $old) {
        $modified = @filemtime($old);
        if ($modified !== false && time() - $modified > JG_LABEL_CACHE_TTL) {
            @unlink($old);
        }
    }
    $file = jg_label_cache_file($key);
    $temp = $file . '.' . bin2hex(random_bytes(4));
    if (@file_put_contents($temp, serialize(['raw' => $raw, 'content_type' => $contentType, 'headers' => $headers]), LOCK_EX) === false) {
        return;
    }
    @chmod($temp, 0600);
    @rename($temp, $file);
}
