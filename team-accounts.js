// Team accounts: everyone in one list. Tap a person to rename them, change
// their PIN, turn sign-in off or delete them. "Add person" is its own step,
// so editing never starts from a blank new-profile form.
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.querySelector('[data-team-modal]');
  if (!modal) return;

  const endpoint = modal.dataset.endpoint || '../api/employees-v2/';
  const title = modal.querySelector('[data-team-title]');
  const back = modal.querySelector('[data-team-back]');
  const listView = modal.querySelector('[data-team-list-view]');
  const list = modal.querySelector('[data-team-list]');
  const form = modal.querySelector('[data-team-form]');
  const person = modal.querySelector('[data-team-person]');
  const field = (name) => form.querySelector(`[name="${name}"]`);
  const nameInput = field('display_name');
  const idInput = field('id');
  const pinInput = field('pin');
  const activeInput = field('active');
  const idField = modal.querySelector('[data-team-id-field]');
  const pinLabel = modal.querySelector('[data-team-pin-label]');
  const pinHelp = modal.querySelector('[data-team-pin-help]');
  const errorNode = modal.querySelector('[data-team-error]');
  const saveButton = modal.querySelector('[data-team-save]');
  const danger = modal.querySelector('[data-team-danger]');
  const deleteButton = modal.querySelector('[data-team-delete]');
  const deleteNote = modal.querySelector('[data-team-delete-note]');

  let people = [];
  let me = '';
  let editing = null; // the person being edited, or null when adding
  let idTyped = false;
  let armTimer = 0;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const initial = (name) => (String(name || '').trim().charAt(0) || '?').toUpperCase();
  const toId = (value) => String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 64);
  const isAdminId = (id) => ['admin', 'shared-admin'].includes(String(id).toLowerCase());

  const request = async (body) => {
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false || payload.error) {
      throw new Error(payload.error || 'Store Ops could not be reached. Try again.');
    }
    people = Array.isArray(payload.employees) ? payload.employees : people;
    me = String(payload.current_employee?.id || me);
    return payload;
  };

  const showError = (message) => {
    errorNode.textContent = message || '';
    errorNode.hidden = !message;
  };

  const disarmDelete = () => {
    window.clearTimeout(armTimer);
    deleteButton.classList.remove('is-armed');
    deleteButton.disabled = false;
    if (editing) deleteButton.textContent = `Delete ${editing.display_name}`;
  };

  const renderList = () => {
    if (!people.length) {
      list.innerHTML = '<p class="admin-team-empty">No accounts yet.</p>';
      return;
    }
    const activeNames = {};
    people.filter((p) => p.active).forEach((p) => {
      const key = String(p.display_name).trim().toLowerCase();
      activeNames[key] = (activeNames[key] || 0) + 1;
    });
    const sorted = [...people].sort((a, b) => (b.id === me) - (a.id === me)
      || Number(b.active) - Number(a.active)
      || String(a.display_name).localeCompare(String(b.display_name)));
    list.innerHTML = sorted.map((p) => {
      const twin = p.active && activeNames[String(p.display_name).trim().toLowerCase()] > 1;
      const tags = [
        p.id === me ? '<em class="is-you">You</em>' : '',
        !p.active ? '<em class="is-off">Off</em>' : '',
        twin ? '<em class="is-warn">Same name</em>' : ''
      ].join('');
      return `
        <button type="button" class="admin-team-row${p.active ? '' : ' is-off'}" data-team-person-id-value="${escapeHtml(p.id)}">
          <span class="admin-store-profile-avatar" aria-hidden="true">${escapeHtml(initial(p.display_name))}</span>
          <span class="admin-team-row-copy">
            <strong>${escapeHtml(p.display_name)}</strong>
            <span>${escapeHtml(p.id)}</span>
          </span>
          <span class="admin-team-tags">${tags}</span>
          <svg class="admin-team-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>`;
    }).join('');
  };

  const showList = () => {
    editing = null;
    disarmDelete();
    form.hidden = true;
    listView.hidden = false;
    back.hidden = true;
    title.textContent = 'Team accounts';
    renderList();
  };

  const showForm = (target) => {
    editing = target;
    idTyped = false;
    showError('');
    disarmDelete();
    form.reset();
    listView.hidden = true;
    form.hidden = false;
    back.hidden = false;
    const isMe = Boolean(target && target.id === me);
    if (target) {
      title.textContent = isMe ? 'Your account' : 'Edit account';
      person.hidden = false;
      person.querySelector('[data-team-person-initial]').textContent = initial(target.display_name);
      person.querySelector('[data-team-person-name]').textContent = target.display_name;
      person.querySelector('[data-team-person-id]').textContent = `Signs in as ${target.id}`;
      nameInput.value = target.display_name;
      idInput.value = target.id;
      idField.hidden = true;
      idInput.required = false;
      pinLabel.textContent = 'New PIN';
      pinInput.required = false;
      pinInput.placeholder = 'Leave empty to keep the PIN';
      pinHelp.textContent = 'Only fill this in to change the PIN. It also signs them out of their other devices.';
      activeInput.checked = Boolean(target.active);
      activeInput.disabled = isMe;
      saveButton.textContent = 'Save changes';
      const canDelete = !isMe && !isAdminId(target.id);
      danger.hidden = false;
      deleteButton.hidden = !canDelete;
      deleteButton.textContent = `Delete ${target.display_name}`;
      deleteNote.textContent = isMe
        ? 'You can\'t delete or turn off the account you are signed in with.'
        : isAdminId(target.id)
          ? 'The admin account can\'t be deleted. Turn off "Can sign in" instead.'
          : 'Deleting removes the account for good. Their past orders stay in the records.';
    } else {
      title.textContent = 'Add person';
      person.hidden = true;
      idField.hidden = false;
      idInput.required = true;
      pinLabel.textContent = 'PIN';
      pinInput.required = true;
      pinInput.placeholder = 'At least 4 digits';
      pinHelp.textContent = 'They type this on the sign-in screen.';
      activeInput.checked = true;
      activeInput.disabled = false;
      saveButton.textContent = 'Add person';
      danger.hidden = true;
    }
    window.setTimeout(() => nameInput.focus(), 30);
  };

  const open = () => {
    modal.hidden = false;
    showList();
    list.innerHTML = '<p class="admin-team-empty">Loading…</p>';
    request().then(renderList).catch((error) => {
      list.innerHTML = `<p class="admin-team-empty">${escapeHtml(error.message)}</p>`;
    });
  };
  const close = () => {
    modal.hidden = true;
    disarmDelete();
  };

  document.querySelectorAll('[data-open-team]').forEach((button) => button.addEventListener('click', open));
  modal.querySelectorAll('[data-close-team]').forEach((button) => button.addEventListener('click', close));
  back.addEventListener('click', showList);
  modal.querySelector('[data-team-add]').addEventListener('click', () => showForm(null));
  list.addEventListener('click', (event) => {
    const row = event.target instanceof Element ? event.target.closest('[data-team-person-id-value]') : null;
    if (!row) return;
    const target = people.find((p) => p.id === row.dataset.teamPersonIdValue);
    if (target) showForm(target);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || modal.hidden) return;
    if (!form.hidden) showList();
    else close();
  });

  nameInput.addEventListener('input', () => {
    if (!editing && !idTyped) idInput.value = toId(nameInput.value);
  });
  idInput.addEventListener('input', () => {
    idTyped = true;
    idInput.value = toId(idInput.value);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    saveButton.disabled = true;
    try {
      await request({
        action: 'save_employee',
        mode: editing ? 'update' : 'create',
        id: editing ? editing.id : toId(idInput.value || nameInput.value),
        display_name: nameInput.value.trim(),
        pin: pinInput.value,
        active: editing && editing.id === me ? true : activeInput.checked
      });
      showList();
    } catch (error) {
      showError(error.message);
    } finally {
      saveButton.disabled = false;
    }
  });

  // Two taps to delete, without a browser pop-up.
  deleteButton.addEventListener('click', async () => {
    if (!editing) return;
    if (!deleteButton.classList.contains('is-armed')) {
      deleteButton.classList.add('is-armed');
      deleteButton.textContent = `Tap again to delete ${editing.display_name}`;
      armTimer = window.setTimeout(disarmDelete, 4000);
      return;
    }
    window.clearTimeout(armTimer);
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    try {
      await request({ action: 'delete_employee', id: editing.id });
      showList();
    } catch (error) {
      disarmDelete();
      showError(error.message);
    }
  });
});
