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
import { fieldsFor, gridOf } from './grids.js';

const PORTAL = 'https://reg.psuad.ac.ae/PSUADPortal/';
const ENDPOINT = PORTAL + 'Services/StudentSearch/Enrollment/List';

/*
 * A whole term in one request, because the portal cannot be paged.
 *
 * This asked a page at a time for a while, five hundred rows each, to keep a long pull
 * visibly alive. It cost a third of the answer: the portal's Skip/Take slices are not
 * stable, so the same person comes back on two pages and somebody else on none, and a
 * sort by a unique column does not steady them. Measured on 5 September 2026 — 1,486
 * active staff arrived as 1,486 rows that were 913 distinct people; 2,966 students
 * arrived as 1,193.
 *
 * So it is one request again, `Take: 0`, and the liveness problem that paging was meant
 * to solve is solved by a heartbeat instead: see fetchFilter.
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

/**
 * What the probe learned about one grid. Students live under the key they always had;
 * the other grids under their own, so a visit to the Courses page cannot overwrite what
 * was learned about students.
 */
function harvestKey(kind) {
  return kind === 'students' ? 'portalFields' : 'portalFields:' + kind;
}

async function storedFields(kind = 'students') {
  const key = harvestKey(kind);
  const held = await chrome.storage.local.get(key);
  return held[key] || null;
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
async function fetchPage(equality, sort, skip, grid, take = PAGE_SIZE) {
  const res = await fetch(PORTAL + 'Services/' + grid.path, {
    method: 'POST',
    credentials: 'include',        // the coordinator's own portal session
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ EqualityFilter: equality, Sort: sort, Skip: skip, Take: take })
  });

  // An expired session redirects to the HTML login page rather than erroring.
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (res.status === 401 || res.status === 403 || !isJson) {
    return {
      error: {
        ok: false,
        error: 'auth',
        loginUrl: PORTAL + grid.page
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

/**
 * What one grid may be asked and may answer.
 *
 * The student grid is the learned one: its fields and columns come from the portal
 * probe. The other three are declared in grids.js, borrowing the student grid's code
 * tables for the fields they share, and their columns are the list there — filtered
 * through the same NEVER_RETURNED rule, so a column banned for students is banned
 * everywhere.
 */
async function gridSchema(kind) {
  const grid = gridOf(kind);
  if (!grid) return null;
  const students = await schema();
  if (kind === 'students') return { grid, fields: students.fields, columns: students.columns.map(column => column.key), source: students.source };
  const columns = (grid.columns || []).filter(key => mayReturn(key));
  // The grid's own harvest first — its quick filters, with the values they offer — then
  // the declared fields, borrowing the student grid's code tables where they are shared.
  const learned = await storedFields(kind);
  const own = learned?.fields?.length ? learned.fields : null;
  const declared = fieldsFor(kind, students.fields);
  if (!own) return { grid, fields: declared, columns, source: 'built-in', harvestedAt: null };
  const byKey = new Map(declared.map(field => [field.key, field]));
  const fields = own.map(field => {
    const known = byKey.get(field.key);
    return field.options.length || !known ? { ...field, verified: true } : known;
  });
  for (const field of declared) if (!own.some(candidate => candidate.key === field.key)) fields.push(field);
  return { grid, fields, columns, source: 'portal', harvestedAt: learned.harvestedAt || null };
}

/** Run one composed filter, once it has been checked against the schema. */
async function fetchFilter(filter, meta = {}) {
  const cfg = await config();
  const kind = meta.kind || 'students';
  const known = await gridSchema(kind);
  if (!known) return { ok: false, error: 'unknown_grid', message: String(kind) };
  const { grid, fields, columns, source } = known;
  const refusal = checkFilter(filter, fields, { trustValues: source === 'portal' });
  if (refusal) return { ok: false, error: 'filter_refused', detail: refusal, message: refusal };

  const equality = Object.assign(grid.term ? { TERM_CODE: cfg.term.code } : {}, filter);
  const sort = meta.sort || grid.sort;

  /*
   * One request for the whole answer, never a page at a time.
   *
   * The portal's Skip/Take slices are not stable: asking for the same filter in pages of
   * 500 returns the same person on two pages and somebody else on none. Sorting by a
   * unique column does not fix it. Measured on 5 September 2026: the active staff list is
   * 1,486 people, and three paged requests collected 1,486 rows that were only 913
   * distinct — a third of the department's teachers silently absent. The students were
   * worse: 2,966 in one request, 1,193 in pages.
   *
   * `Take: 0` means no limit, and the portal answers it in full. It is slow for a big
   * grid, so a heartbeat goes out while we wait: the page's watchdog is for silence, and
   * this request is quiet for a minute or more.
   */
  const beat = setInterval(() => onProgress(meta, 0, null), 5000);
  let page;
  try {
    page = await fetchPage(equality, sort, 0, grid, 0);
  } catch (e) {
    return { ok: false, error: 'network', message: e.message };
  } finally {
    clearInterval(beat);
  }
  if (page.error) return page.error;

  let rows = trim(page.entities, columns);
  onProgress(meta, rows.length, page.total);
  // The portal said how many there are; anything else is an answer we should not trust.
  const short = page.total !== null && rows.length !== page.total;
  let truncated = false;
  if (rows.length > MAX_ROWS) {
    rows = rows.slice(0, MAX_ROWS);
    truncated = true;
  }

  return {
    ok: true,
    kind,
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
      : short
        ? 'short_answer'
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
    case 'schema': {
      const kind = msg.kind || 'students';
      if (kind === 'students') return Object.assign({ ok: true }, await schema());
      const known = await gridSchema(kind);
      if (!known) return { ok: false, error: 'unknown_grid', message: String(kind) };
      const cfg = await config();
      return {
        ok: true,
        kind,
        term: cfg.term,
        fields: known.fields,
        columns: known.columns.map(key => ({ key, label: titleOf(key) })),
        source: known.source,
        harvestedAt: known.harvestedAt,
      };
    }
    case 'fields:harvest': {
      // Sent by the portal content script. Keep the richest harvest we have seen: a page
      // where no filter panel was open knows the field names but not their values, and a
      // grid read before it finished rendering knows fewer columns than one read after.
      // One harvest per grid, so the Courses page cannot overwrite the students'.
      const kind = gridOf(msg.kind) ? msg.kind : 'students';
      const learned = await storedFields(kind);
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
          [harvestKey(kind)]: {
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
