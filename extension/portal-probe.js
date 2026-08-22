'use strict';
/*
 * Runs on the registrar portal, in the page's own world.
 *
 * Its one job is to learn what the Student Search grid can be filtered by, so the
 * platform's filter builder offers the portal's own fields and the portal's own values
 * rather than a list somebody typed out once and got wrong. A portal upgrade that adds or
 * renames a filter shows up here on the next visit instead of failing silently.
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

function report() {
  const fields = harvest();
  if (!fields.length) return;
  window.postMessage({ channel: CHANNEL, fields, url: location.href }, window.location.origin);
}

// The grid renders after the page settles, and the lookups fill in after that, so look
// more than once rather than assuming the first moment is representative.
report();
setTimeout(report, 1500);
setTimeout(report, 5000);
