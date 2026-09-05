'use strict';
/*
 * Runs on the registrar portal, in the page's own world.
 *
 * It learns two things about the Student Search grid, so the platform describes the
 * portal rather than a list somebody typed out once and got wrong:
 *
 *   - what the grid can be filtered by, for the filter builder;
 *   - what columns the grid has, for the table's column picker.
 *
 * Those are not the same list, which is the whole reason this reads both. A field can be
 * filterable and never shown (CAMPUS_CODE), and a column can be shown and never
 * filterable (FULL_NAME, ABSENCE_PER). A portal upgrade that adds or renames either shows
 * up here on the next visit instead of failing silently.
 *
 * It reads *definitions* — field names, labels, and the code tables the dropdowns offer.
 * No student row is read, and the harvest goes only to this extension's own service
 * worker, by way of portal-relay.js.
 *
 * Why the page's world rather than the usual isolated one: the quick filters are Serenity
 * LookupEditor widgets, and their values live in jQuery data on the element. A content
 * script in the isolated world cannot see the page's jQuery at all, so it would find the
 * nineteen fields and none of their values.
 */

const CHANNEL = 'scen-portal-fields';
const FIELD_KEY = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * Every quick filter on the grid.
 *
 * The markup is `<input class="s-LookupEditor" id="…_QuickFilter_ESTS_CODE">` wrapped in
 * `.quick-filter-item` with a `.quick-filter-label`. Several elements share that id prefix
 * — select2 adds its own container — and only one of them carries the widget, so the one
 * with the values wins.
 */
function harvest() {
  const jq = window.jQuery;
  if (!jq) return [];

  const found = new Map();
  for (const element of document.querySelectorAll('[id*="_QuickFilter_"]')) {
    const key = (element.id.split('_QuickFilter_')[1] || '').toUpperCase();
    if (!FIELD_KEY.test(key)) continue;

    const widget = jq(element).data('Serenity_LookupEditor');
    const options = ((widget && widget.items) || [])
      .map(item => ({ value: String(item.id ?? ''), label: String(item.text ?? '') }))
      .filter(option => option.value);

    const item = element.closest('.quick-filter-item');
    const label = item && item.querySelector('.quick-filter-label');
    const candidate = {
      key,
      label: (label && label.textContent.trim()) || key,
      options,
      source: 'quick-filter',
    };

    const existing = found.get(key);
    if (!existing || (!existing.options.length && options.length)) found.set(key, candidate);
  }
  return [...found.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Every column the grid knows about — the same list its Column Picker offers.
 *
 * Serenity keeps the full set on the grid widget as `allColumns`, and only the shown
 * subset in `slickGrid.getColumns()`; the Column Picker button is a view onto the former.
 * The widget is in jQuery data under its own class name, which varies by deployment, so
 * rather than guess the name this looks for the shape: any widget carrying an allColumns
 * array. Failing that, the header cells are read — those are the shown columns only, which
 * is worse than the real list but better than nothing.
 */
function harvestColumns() {
  const jq = window.jQuery;
  if (!jq) return [];

  const seen = new Map();
  const take = (column, source) => {
    const key = String(column.field ?? column.id ?? '').toUpperCase();
    if (!FIELD_KEY.test(key) || seen.has(key)) return;
    const label = String(column.name ?? column.title ?? '').replace(/<[^>]*>/g, '').trim();
    seen.set(key, { key, label: label || key, source });
  };

  for (const element of document.querySelectorAll('div, table')) {
    let data;
    try {
      data = jq(element).data();
    } catch {
      continue;
    }
    for (const value of Object.values(data || {})) {
      const all = value && typeof value === 'object' ? value.allColumns : null;
      if (Array.isArray(all) && all.length) all.forEach(column => take(column, 'column-picker'));
    }
  }

  if (!seen.size) {
    for (const cell of document.querySelectorAll('.slick-header-column')) {
      const id = cell.getAttribute('data-column-id') || '';
      const label = (cell.querySelector('.slick-column-name') || cell).textContent.trim();
      take({ field: id, name: label }, 'header');
    }
  }
  return [...seen.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Which of the extension's grids this page is, by its path.
 *
 * The service worker keeps one harvest per grid: the Courses Search page's filters are
 * departments and parts of term, the Teachers page's are statuses and types, and neither
 * must overwrite what was learned about students.
 */
function gridOfPage() {
  const path = location.pathname.toLowerCase();
  if (path.includes('/studentsearch/studentcourses')) return 'registrations';
  if (path.includes('/studentsearch/enrollment')) return 'students';
  if (path.includes('/courses/coursessearch')) return 'courses';
  if (path.includes('/staffsearch')) return 'teachers';
  return '';
}

function report() {
  const kind = gridOfPage();
  if (!kind) return;
  const fields = harvest();
  const columns = harvestColumns();
  if (!fields.length && !columns.length) return;
  window.postMessage({ channel: CHANNEL, kind, fields, columns, url: location.href }, window.location.origin);
}

// The grid renders after the page settles, and the lookups fill in after that, so look
// more than once rather than assuming the first moment is representative.
report();
setTimeout(report, 1500);
setTimeout(report, 5000);
