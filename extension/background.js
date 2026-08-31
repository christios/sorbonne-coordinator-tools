'use strict';
/*
 * Service worker — the only place with permission to talk to the portal.
 *
 * It accepts either a preset name or a composed filter. A composed filter is checked
 * field by field and value by value against the schema before anything is sent: any
 * script running on the coordinator platform can reach this bridge, so what is allowed
 * is decided here rather than by the caller. The schema is learned from the portal by
 * portal-fields.js, and falls back to the verified codes in presets.json.
 *
 * The endpoint and `Take: 0` are fixed here too, and so is what may come back: the caller
 * chooses *which* students to ask about, never *what* is returned about them. The columns
 * are the portal's own, learned from the grid the same way the filters are, minus the
 * identity and contact fields that no cohort table has a use for (see NEVER_RETURNED).
 */

import { checkFilter, mayReturn } from './filter-schema.js';

const ENDPOINT = 'https://reg.psuad.ac.ae/PSUADPortal/Services/StudentSearch/Enrollment/List';

/*
 * A whole term, a page at a time.
 *
 * This used to ask for everything at once — `Take: 0`, no limit — and the first term is
 * 2876 students. One request that large is a single point of failure with nothing to show
 * for itself while it runs: the page could not tell a slow success from a hang, and gave
 * up on it.
 *
 * Five hundred is small enough that a page returns promptly and large enough that a term
 * is six of them rather than sixty.
 */
const PAGE_SIZE = 500;

/* A stop, so a portal that never returns a short page cannot spin here for ever. */
const MAX_ROWS = 20000;

let configCache = null;
async function config() {
  if (!configCache) {
    const res = await fetch(chrome.runtime.getURL('presets.json'));
    configCache = await res.json();
  }
  return configCache;
}

function trim(rows, columns) {
  return rows.map(r => {
    const o = {};
    columns.forEach(c => { if (c in r) o[c] = r[c]; });
    return o;
  });
}

async function storedFields() {
  const { portalFields } = await chrome.storage.local.get('portalFields');
  return portalFields || null;
}

/** FIRST_NAME -> "First name": a readable label for a column nobody has labelled. */
function titleOf(key) {
  const words = String(key).toLowerCase().replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every column a pull may return.
 *
 * The portal's own column picker, *and* the columns the service has always been known to
 * answer with. The two are not the same and neither contains the other: the grid shows
 * CURRENT_AVERAGE, which the service does not return, and the service returns FIRST_NAME
 * and LAST_NAME, which the grid folds into one FULL_NAME column. Offering only what the
 * grid displays would lose columns that have been arriving all along.
 *
 * NEVER_RETURNED still decides what may leave, and the student id is always kept: every
 * answer is keyed by it.
 */
async function offeredColumns() {
  const cfg = await config();
  const learned = await storedFields();
  const columns = [];
  const seen = new Set();
  const add = (key, label) => {
    const name = String(key || '').toUpperCase();
    if (seen.has(name) || !mayReturn(name, label)) return;
    seen.add(name);
    columns.push({ key: name, label: label || titleOf(name) });
  };

  add('SPRIDEN_ID', 'Id');
  // The harvest leads: those labels are the portal's own words for its columns.
  for (const column of learned?.columns || []) add(column.key, column.label);
  for (const key of cfg.columns || []) add(key);
  return columns;
}

async function allowedColumns() {
  return (await offeredColumns()).map(column => column.key);
}

async function schema() {
  const cfg = await config();
  const learned = await storedFields();
  const columns = await offeredColumns();
  // An empty list is not an answer: a page that showed the grid but no filter panel
  // teaches us columns and no fields, and falling back beats offering nothing. (`[]` is
  // truthy, so this cannot be an `||`.)
  const learnedFields = learned?.fields?.length ? learned.fields : null;
  return {
    term: cfg.term,
    fields: learnedFields || cfg.fields || [],
    // What the table may show. Empty until somebody visits the portal, and the platform
    // falls back to the columns a pull has always carried.
    columns,
    source: learned ? 'portal' : 'built-in',
    harvestedAt: learned?.harvestedAt || null,
  };
}

async function fetchPreset(presetId) {
  const cfg = await config();
  const preset = cfg.presets.find(p => p.id === presetId);
  if (!preset) return { ok: false, error: 'unknown_preset', presetId };
  return fetchFilter(preset.filter, {
    name: preset.name,
    expect: preset.expect || null,
    sort: preset.sort,
    presetId,
  });
}

/**
 * One page of the portal's answer.
 *
 * Errors are returned rather than thrown, in the shape the caller already sends back, so
 * an expired session on page four says the same thing it would have said on page one.
 */
async function fetchPage(equality, sort, skip) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'include',        // the coordinator's own portal session
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ EqualityFilter: equality, Sort: sort, Skip: skip, Take: PAGE_SIZE })
  });

  // An expired session redirects to the HTML login page rather than erroring.
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (res.status === 401 || res.status === 403 || !isJson) {
    return {
      error: {
        ok: false,
        error: 'auth',
        loginUrl: ENDPOINT.replace(/\/Services\/.*$/, '/StudentSearch/Enrollment')
      }
    };
  }
  if (!res.ok) {
    return { error: { ok: false, error: 'http', status: res.status, message: String(res.status) } };
  }

  const data = await res.json();
  return { entities: data.Entities || [], total: Number(data.TotalCount ?? 0) || null };
}

/**
 * Say how far along we are.
 *
 * Without this the page has one timer covering the whole pull and no way to tell a slow
 * success from a hang — which is exactly how a working sync came to be reported as a
 * missing extension. Sent to every listening tab; nothing depends on anyone hearing it.
 */
function onProgress(meta, fetched, total) {
  try {
    chrome.runtime.sendMessage({ type: 'fetch_progress', fetched, total, name: meta.name || '' });
  } catch (e) {
    // No listener is not a problem: progress is a courtesy, not part of the answer.
  }
}

/** Run one composed filter, once it has been checked against the schema. */
async function fetchFilter(filter, meta = {}) {
  const cfg = await config();
  const { fields, source } = await schema();
  const refusal = checkFilter(filter, fields, { trustValues: source === 'portal' });
  if (refusal) return { ok: false, error: 'filter_refused', detail: refusal, message: refusal };

  const columns = await allowedColumns();
  const equality = Object.assign({ TERM_CODE: cfg.term.code }, filter);
  const sort = meta.sort || ['FULL_NAME'];

  const rows = [];
  let truncated = false;
  for (let skip = 0; ; skip += PAGE_SIZE) {
    let page;
    try {
      page = await fetchPage(equality, sort, skip);
    } catch (e) {
      return { ok: false, error: 'network', message: e.message };
    }
    if (page.error) return page.error;

    rows.push(...trim(page.entities, columns));
    onProgress(meta, rows.length, page.total);

    // The last page is the one that comes back short. A page of exactly PAGE_SIZE with
    // nothing after it costs one extra empty request, which is the cheap way round.
    if (page.entities.length < PAGE_SIZE) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  return {
    ok: true,
    presetId: meta.presetId || '',
    name: meta.name || 'Filtered search',
    filter,
    term: cfg.term,
    columns,
    count: rows.length,
    expect: meta.expect || null,
    // Loud rather than silent: an unrecognised filter code returns 0 with HTTP 200.
    warning: truncated
      ? 'truncated'
      : rows.length === 0
        ? 'zero_rows'
        : (meta.expect && Math.abs(meta.expect - rows.length) > Math.max(10, meta.expect * 0.15)
            ? 'count_drift' : null),
    fetchedAt: Date.now(),
    rows
  };
}

async function handle(msg) {
  switch (msg && msg.type) {
    case 'ping': {
      const cfg = await config();
      return { ok: true, version: chrome.runtime.getManifest().version, term: cfg.term };
    }
    case 'presets': {
      const cfg = await config();
      return {
        ok: true,
        term: cfg.term,
        presets: cfg.presets.map(p => ({
          id: p.id, name: p.name, expect: p.expect || null, filter: p.filter
        }))
      };
    }
    case 'schema':
      return Object.assign({ ok: true }, await schema());
    case 'fields:harvest': {
      // Sent by the portal content script. Keep the richest harvest we have seen: a page
      // where no filter panel was open knows the field names but not their values, and a
      // grid read before it finished rendering knows fewer columns than one read after.
      const learned = await storedFields();
      const columns = (msg.columns || []).filter(column => mayReturn(column.key, column.label));
      const held = (learned && learned.columns) || [];
      // Fields and columns are learned from different parts of the page and arrive
      // apart, so neither may erase the other by turning up empty.
      const fields = msg.fields || [];
      const richer = fields.length > 0 && (!learned || withValues(fields) >= withValues(learned.fields));
      // Wider, or the same width but different: a grid read before it finished rendering
      // knows fewer columns, and a renamed column is news even when the count is not.
      const wider = columns.length > held.length
        || (columns.length === held.length && columns.length > 0 && keys(columns) !== keys(held));
      if (richer || wider) {
        await chrome.storage.local.set({
          portalFields: {
            fields: richer ? fields : ((learned && learned.fields) || []),
            columns: wider ? columns : held,
            harvestedAt: Date.now(),
          }
        });
      }
      return { ok: true, kept: richer || wider, columns: columns.length };
    }
    case 'fetch':
      return msg.filter ? fetchFilter(msg.filter, msg.meta || {}) : fetchPreset(msg.presetId);
    default:
      return { ok: false, error: 'unknown_message' };
  }
}

function withValues(fields) {
  return (fields || []).filter(field => (field.options || []).length).length;
}

function keys(columns) {
  return (columns || []).map(column => column.key).join(',');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, e => sendResponse({ ok: false, error: 'internal', message: String(e) }));
  return true;   // keep the channel open for the async reply
});
