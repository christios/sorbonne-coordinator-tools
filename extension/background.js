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
 * The endpoint, the column allowlist and `Take: 0` are fixed here too, so the caller can
 * choose *which* students to ask about but never *what* is returned about them.
 */

import { checkFilter } from './filter-schema.js';

const ENDPOINT = 'https://reg.psuad.ac.ae/PSUADPortal/Services/StudentSearch/Enrollment/List';

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

async function schema() {
  const cfg = await config();
  const learned = await storedFields();
  return {
    term: cfg.term,
    fields: learned?.fields || cfg.fields || [],
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

/** Run one composed filter, once it has been checked against the schema. */
async function fetchFilter(filter, meta = {}) {
  const cfg = await config();
  const { fields, source } = await schema();
  const refusal = checkFilter(filter, fields, { trustValues: source === 'portal' });
  if (refusal) return { ok: false, error: 'filter_refused', detail: refusal };

  const body = {
    EqualityFilter: Object.assign({ TERM_CODE: cfg.term.code }, filter),
    Sort: meta.sort || ['FULL_NAME'],
    Skip: 0,
    Take: 0                        // 0 = no limit
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',      // the coordinator's own portal session
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { ok: false, error: 'network', message: e.message };
  }

  // An expired session redirects to the HTML login page rather than erroring.
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (res.status === 401 || res.status === 403 || !isJson) {
    return { ok: false, error: 'auth', loginUrl: cfg.loginUrl || ENDPOINT.replace(/\/Services\/.*$/, '/StudentSearch/Enrollment') };
  }
  if (!res.ok) return { ok: false, error: 'http', status: res.status };

  const data = await res.json();
  const rows = trim(data.Entities || [], cfg.columns);

  return {
    ok: true,
    presetId: meta.presetId || '',
    name: meta.name || 'Filtered search',
    filter,
    term: cfg.term,
    columns: cfg.columns,
    count: rows.length,
    expect: meta.expect || null,
    // Loud rather than silent: an unrecognised filter code returns 0 with HTTP 200.
    warning: rows.length === 0
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
      // where no filter panel was open knows the field names but not their values.
      const learned = await storedFields();
      const richer = !learned || withValues(msg.fields) >= withValues(learned.fields);
      if (richer) {
        await chrome.storage.local.set({
          portalFields: { fields: msg.fields, harvestedAt: Date.now() }
        });
      }
      return { ok: true, kept: richer };
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse, e => sendResponse({ ok: false, error: 'internal', message: String(e) }));
  return true;   // keep the channel open for the async reply
});
