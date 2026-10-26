<?php
declare(strict_types=1);

if (!function_exists('jg_store_ops_public_root_prefix')) {
    function jg_store_ops_public_root_prefix(): string
    {
        $scriptName = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        $directory = trim(str_replace('\\', '/', dirname($scriptName)), '/');
        if ($directory === '' || $directory === '.') {
            return './';
        }

        return str_repeat('../', substr_count($directory, '/') + 1);
    }
}

if (!function_exists('jg_store_ops_favicon_href')) {
    function jg_store_ops_favicon_href(string $filename): string
    {
        $mtime = @filemtime(__DIR__ . '/assets/' . $filename);
        $version = $mtime ? (string) $mtime : '1';

        return jg_store_ops_public_root_prefix() . 'assets/' . rawurlencode($filename) . '?v=' . rawurlencode($version);
    }
}
?>
<link rel="icon" type="image/svg+xml" href="<?php echo htmlspecialchars(jg_store_ops_favicon_href('store-ops-favicon-light.svg'), ENT_QUOTES, 'UTF-8'); ?>" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/svg+xml" href="<?php echo htmlspecialchars(jg_store_ops_favicon_href('store-ops-favicon-dark.svg'), ENT_QUOTES, 'UTF-8'); ?>" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="<?php echo htmlspecialchars(jg_store_ops_public_root_prefix() . 'store-ops.webmanifest', ENT_QUOTES, 'UTF-8'); ?>">
<script>
// Phone or computer, decided before the page draws so phones never flash the
// desktop layout. Touch screen with a short side of at most 600 px; override
// with localStorage 'jg-store-device' = 'phone' or 'computer'.
(() => {
  let device = '';
  try { device = window.localStorage.getItem('jg-store-device') || ''; } catch (_error) { /* Detect below. */ }
  if (device !== 'phone' && device !== 'computer') {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const shortSide = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
    device = coarse && shortSide <= 600 ? 'phone' : 'computer';
  }
  document.documentElement.dataset.device = device;
})();
(() => {
  const themes = ['dark', 'light', 'system'];
  const legacyThemes = {
    graphite: 'dark',
    glass: 'light',
    ivory: 'light',
    prism: 'dark'
  };
  try {
    const storedTheme = window.localStorage.getItem('jg-admin-theme');
    const theme = themes.includes(storedTheme) ? storedTheme : (legacyThemes[storedTheme] || 'dark');
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
    const resolvedTheme = theme === 'system' && systemTheme.matches
      ? 'light'
      : 'dark';
    document.documentElement.dataset.adminThemePreference = theme;
    document.documentElement.dataset.adminTheme = theme === 'system' ? resolvedTheme : theme;
    if (storedTheme !== theme) window.localStorage.setItem('jg-admin-theme', theme);
    const syncSystemTheme = () => {
      if (document.documentElement.dataset.adminThemePreference === 'system') {
        document.documentElement.dataset.adminTheme = systemTheme.matches ? 'light' : 'dark';
      }
    };
    if (typeof systemTheme.addEventListener === 'function') systemTheme.addEventListener('change', syncSystemTheme);
    else if (typeof systemTheme.addListener === 'function') systemTheme.addListener(syncSystemTheme);
  } catch (_error) {
    document.documentElement.dataset.adminThemePreference = 'dark';
    document.documentElement.dataset.adminTheme = 'dark';
  }
})();
</script>
