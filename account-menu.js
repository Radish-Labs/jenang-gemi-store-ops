// Tapping your name opens the account menu (Log out / switch account, and for
// admins the employee profiles) instead of the new-profile form.
document.addEventListener('DOMContentLoaded', () => {
  const menu = document.querySelector('[data-account-menu]');
  if (!menu) return;
  const open = () => {
    // On a phone the sidebar is drawn over the page; close it first.
    const backdrop = document.querySelector('[data-store-sidebar-backdrop]');
    if (backdrop && !backdrop.hidden) backdrop.click();
    menu.hidden = false;
    menu.querySelector('.admin-account-logout')?.focus();
  };
  const close = () => { menu.hidden = true; };
  document.querySelectorAll('[data-open-account-menu]').forEach((button) => button.addEventListener('click', open));
  menu.querySelectorAll('[data-close-account-menu], [data-open-employee-profiles]').forEach((node) => node.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) close();
  });
});
