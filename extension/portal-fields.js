'use strict';
/*
 * Content script — runs on the registrar portal, and only there.
 *
 * Its one job is to learn what the Student Search grid can actually be filtered by, so
 * the platform's filter builder offers the portal's own fields and the portal's own
 * values rather than a list somebody typed out once and forgot. A portal upgrade that
 * adds or renames a filter shows up here on the next visit instead of failing silently.
 *
 * It reads *definitions*, never rows: field names, labels, and the options a dropdown
 * offers. No student data is read, and nothing is sent anywhere except to this
 * extension's own service worker.
 */

const GRID_SELECTORS = ['#GridDiv', '.s-DataGrid', '[id$="Grid"]'];
const FIELD_KEY = /^[A-Z][A-Z0-9_]{1,39}$/;

/** Serenity keeps the grid's own definition on the element; shapes vary by version. */
function gridFields() {
  const jq = window.jQuery;
  if (!jq) return [];

  for (const selector of GRID_SELECTORS) {
    const element = jq(selector);
    if (!element.length) continue;
    const data = element.data();
    for (const value of Object.values(data || {})) {
      const columns = value?.getColumns?.() ?? value?.slickGrid?.getColumns?.() ?? value?.allColumns;
      if (!Array.isArray(columns)) continue;
      const fields = columns
        .map((column) => ({
          key: String(column.field ?? column.id ?? '').toUpperCase(),
          label: String(column.name ?? column.title ?? column.field ?? '').trim(),
          options: [],
          source: 'grid',
        }))
        .filter((field) => FIELD_KEY.test(field.key));
      if (fields.length) return fields;
    }
  }
  return [];
}

/**
 * The quick-filter bar, read from the DOM.
 *
 * This is the part that carries the *values*: each dropdown lists the codes the portal
 * itself accepts, which is exactly what the builder needs to offer.
 */
function filterBarFields() {
  const fields = [];
  for (const control of document.querySelectorAll('select[id], select[name], input[type="hidden"][id]')) {
    const raw = control.getAttribute('name') || control.id || '';
    // Serenity ids look like PSUADPortal_Students_EnrollmentGrid_QuickFilter_YEARLEVEL_CODE
    const key = (raw.split(/[_.]/).slice(-3).join('_').match(/[A-Z][A-Z0-9_]+$/) || [''])[0];
    if (!FIELD_KEY.test(key)) continue;

    const options = [...control.querySelectorAll('option')]
      .map((option) => ({ value: String(option.value ?? '').trim(), label: option.textContent.trim() }))
      .filter((option) => option.value);

    fields.push({ key, label: labelFor(control) || key, options, source: 'filter-bar' });
  }
  return fields;
}

function labelFor(control) {
  const described = control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
  if (described) return described.textContent.trim();
  const wrapper = control.closest('.quick-filter-item, .filter-item, .s-QuickFilterBar > *');
  return wrapper ? (wrapper.querySelector('.quick-filter-label, label')?.textContent || '').trim() : '';
}

/** One entry per field, preferring whichever source knew its values. */
function harvest() {
  const merged = new Map();
  for (const field of [...gridFields(), ...filterBarFields()]) {
    const existing = merged.get(field.key);
    if (!existing) merged.set(field.key, field);
    else if (!existing.options.length && field.options.length) merged.set(field.key, field);
  }
  return [...merged.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function report() {
  const fields = harvest();
  if (!fields.length) return;
  try {
    chrome.runtime.sendMessage({ type: 'fields:harvest', fields, url: location.href });
  } catch {
    // The service worker may be asleep or the extension reloading; the next visit retries.
  }
}

// The grid renders after the page settles, and again when a filter is opened, so look
// more than once rather than assuming the first moment is representative.
report();
setTimeout(report, 1500);
setTimeout(report, 5000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'fields:read') return;
  sendResponse({ ok: true, fields: harvest(), url: location.href });
  return true;
});
