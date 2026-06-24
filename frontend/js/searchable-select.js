/**
 * Kadem & Zetu School Management System
 * Searchable Select Component v1.0
 *
 * Replaces large <select> dropdowns for students and teachers with a
 * live-search typeahead that queries the API as the user types.
 *
 * Usage:
 *   import { makeStudentPicker, makeTeacherPicker } from '/js/searchable-select.js';
 *
 *   // Replace a <select id="asc-student"> with a searchable picker
 *   makeStudentPicker('asc-student', { classId: '...' }, (student) => {
 *     console.log('Selected:', student.id, student.full_name);
 *   });
 *
 *   makeTeacherPicker('cl-teacher', {}, (teacher) => {
 *     console.log('Selected:', teacher.id);
 *   });
 *
 *   // To get the currently selected value:
 *   document.getElementById('asc-student').__pickerValue  // → uuid or null
 */

import { apiFetch } from '/js/api.js';

// ── Styles (injected once) ────────────────────────────────────────────────────
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.ss-wrap { position: relative; width: 100%; }
.ss-input-row { display: flex; align-items: center; gap: 6px; }
.ss-input {
  width: 100%;
  padding: 11px 38px 11px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  color: #0f172a;
  background: #fff;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
  box-sizing: border-box;
}
.ss-input:focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
.ss-input.ss-has-value { border-color: #22c55e; background: #f0fdf4; }
.ss-input.ss-error { border-color: #ef4444; }
.ss-clear {
  position: absolute;
  right: 10px; top: 50%;
  transform: translateY(-50%);
  width: 20px; height: 20px;
  display: none;
  align-items: center; justify-content: center;
  cursor: pointer;
  color: #94a3b8;
  border: none; background: none; padding: 0;
  border-radius: 50%;
  transition: color .15s, background .15s;
  flex-shrink: 0;
}
.ss-clear:hover { color: #ef4444; background: #fee2e2; }
.ss-clear svg { width: 12px; height: 12px; stroke: currentColor; stroke-width: 2.5; fill: none; stroke-linecap: round; }
.ss-has-value ~ .ss-clear, .ss-wrap.ss-open .ss-clear { display: flex; }
.ss-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.12);
  z-index: 9999;
  max-height: 260px;
  overflow-y: auto;
  display: none;
}
.ss-wrap.ss-open .ss-dropdown { display: block; }
.ss-item {
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background .1s;
  border-bottom: 1px solid #f8fafc;
}
.ss-item:last-child { border-bottom: none; }
.ss-item:hover, .ss-item.ss-active { background: #f1f5f9; }
.ss-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ss-avatar.ss-teacher { background: linear-gradient(135deg, #0ea5e9, #2563eb); }
.ss-item-info { display: flex; flex-direction: column; min-width: 0; }
.ss-item-name { font-size: 13.5px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ss-item-sub { font-size: 11.5px; color: #64748b; margin-top: 1px; }
.ss-status {
  padding: 12px 14px;
  font-size: 13px;
  color: #94a3b8;
  text-align: center;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.ss-spinner {
  width: 16px; height: 16px;
  border: 2px solid #e2e8f0;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: ss-spin .6s linear infinite;
  flex-shrink: 0;
}
@keyframes ss-spin { to { transform: rotate(360deg); } }
.ss-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; display: flex; align-items: center; gap: 4px; }
.ss-hint svg { width: 11px; height: 11px; stroke: #94a3b8; stroke-width: 2; fill: none; flex-shrink: 0; }
`;
  document.head.appendChild(s);
}

// ── Debounce ──────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Initials avatar ───────────────────────────────────────────────────────────
function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// ── Core builder ─────────────────────────────────────────────────────────────
function buildPicker(selectEl, { fetchFn, labelFn, subFn, placeholder, hint, avatarClass = '' }, onSelect) {
  injectStyles();

  // Wrap original select
  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  selectEl.parentNode.insertBefore(wrap, selectEl);
  selectEl.style.display = 'none';
  wrap.appendChild(selectEl);

  // Input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ss-input';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.setAttribute('aria-autocomplete', 'list');

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'ss-clear';
  clearBtn.type = 'button';
  clearBtn.title = 'Clear';
  clearBtn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // Input wrapper (for positioning clear btn)
  const inputWrap = document.createElement('div');
  inputWrap.style.cssText = 'position:relative;width:100%';
  inputWrap.appendChild(input);
  inputWrap.appendChild(clearBtn);
  wrap.appendChild(inputWrap);

  // Hint
  if (hint) {
    const h = document.createElement('div');
    h.className = 'ss-hint';
    h.innerHTML = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>${hint}`;
    wrap.appendChild(h);
  }

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'ss-dropdown';
  dropdown.setAttribute('role', 'listbox');
  wrap.appendChild(dropdown);

  // State
  let selectedId = null;
  let selectedLabel = '';
  let activeIdx = -1;
  let lastResults = [];

  // ── Expose value on original select element ───────────────────────────────
  Object.defineProperty(selectEl, '__pickerValue', {
    get: () => selectedId,
    configurable: true
  });
  // Also keep .value readable (some code reads .value)
  const origValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(selectEl, 'value', {
    get: () => selectedId || '',
    set: (v) => { if (!v) clearSelection(); },
    configurable: true
  });

  function setActive(idx) {
    const items = dropdown.querySelectorAll('.ss-item');
    items.forEach((el, i) => el.classList.toggle('ss-active', i === idx));
    activeIdx = idx;
  }

  function open() {
    wrap.classList.add('ss-open');
  }

  function close() {
    wrap.classList.remove('ss-open');
    activeIdx = -1;
  }

  function clearSelection() {
    selectedId = null;
    selectedLabel = '';
    input.value = '';
    input.classList.remove('ss-has-value');
    selectEl.innerHTML = '';
    if (onSelect) onSelect(null);
    dropdown.innerHTML = '';
    close();
  }

  function selectItem(item) {
    selectedId = item.id;
    selectedLabel = labelFn(item);
    input.value = selectedLabel;
    input.classList.add('ss-has-value');
    // Sync to real select (for any code using .value on the original)
    selectEl.innerHTML = `<option value="${item.id}" selected>${labelFn(item)}</option>`;
    if (onSelect) onSelect(item);
    close();
  }

  function renderResults(results, query) {
    lastResults = results;
    activeIdx = -1;
    dropdown.innerHTML = '';

    if (!results.length) {
      dropdown.innerHTML = `<div class="ss-status">No results for "<strong>${query}</strong>"</div>`;
      return;
    }

    results.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'ss-item';
      el.setAttribute('role', 'option');
      el.dataset.idx = i;
      const av = initials(labelFn(item));
      el.innerHTML = `
        <div class="ss-avatar ${avatarClass}">${av}</div>
        <div class="ss-item-info">
          <div class="ss-item-name">${labelFn(item)}</div>
          <div class="ss-item-sub">${subFn(item)}</div>
        </div>`;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      dropdown.appendChild(el);
    });
  }

  async function doSearch(q) {
    const query = q.trim();
    if (query.length < 1) {
      dropdown.innerHTML = '';
      close();
      return;
    }
    dropdown.innerHTML = `<div class="ss-status"><div class="ss-spinner"></div> Searching…</div>`;
    open();
    try {
      const res = await fetchFn(query);
      const results = res?.data || [];
      renderResults(results, query);
    } catch {
      dropdown.innerHTML = `<div class="ss-status">Search failed. Try again.</div>`;
    }
  }

  const debouncedSearch = debounce(doSearch, 280);

  // ── Events ────────────────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    input.classList.remove('ss-has-value');
    if (selectedId) {
      selectedId = null;
      if (onSelect) onSelect(null);
    }
    debouncedSearch(input.value);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 1 && !selectedId) {
      open();
    }
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.ss-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && lastResults[activeIdx]) selectItem(lastResults[activeIdx]);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  clearBtn.addEventListener('click', clearSelection);

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // Public API
  wrap.__picker = { clear: clearSelection, setValue: selectItem };
  return wrap;
}

// ── Student Picker ────────────────────────────────────────────────────────────
/**
 * @param {string} selectId  - id of the <select> element to replace
 * @param {object} opts      - { classId?: string } — filter by class if provided
 * @param {function} onSelect - callback(student | null)
 */
export function makeStudentPicker(selectId, opts = {}, onSelect) {
  const el = document.getElementById(selectId);
  if (!el) return null;

  return buildPicker(el, {
    placeholder: 'Type name or admission no…',
    hint: 'Search by name or admission number',
    avatarClass: '',
    fetchFn: async (q) => {
      const params = { search: q };
      if (opts.classId) params.class_id = opts.classId;
      return apiFetch('/students', { params });
    },
    labelFn: (s) => [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' '),
    subFn:   (s) => [s.admission_number && `Adm: ${s.admission_number}`, s.class_name || s.grade].filter(Boolean).join(' · '),
  }, onSelect);
}

// ── Teacher Picker ────────────────────────────────────────────────────────────
/**
 * @param {string} selectId  - id of the <select> element to replace
 * @param {object} opts      - { allowNone?: boolean }
 * @param {function} onSelect - callback(teacher | null)
 */
export function makeTeacherPicker(selectId, opts = {}, onSelect) {
  const el = document.getElementById(selectId);
  if (!el) return null;

  return buildPicker(el, {
    placeholder: 'Type teacher name or TSC no…',
    hint: 'Search by name, TSC number or email',
    avatarClass: 'ss-teacher',
    fetchFn: async (q) => apiFetch('/teachers', { params: { search: q, is_active: 'true' } }),
    labelFn: (t) => [t.first_name, t.last_name].filter(Boolean).join(' '),
    subFn:   (t) => [t.tsc_number && `TSC: ${t.tsc_number}`, t.department_name, t.designation].filter(Boolean).join(' · '),
  }, onSelect);
}
