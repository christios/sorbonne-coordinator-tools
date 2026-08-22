'use strict';

const ENDPOINT = 'https://reg.psuad.ac.ae/PSUADPortal/Services/StudentSearch/Enrollment/List';
const LOGIN    = 'https://reg.psuad.ac.ae/PSUADPortal/StudentSearch/Enrollment';

const $ = id => document.getElementById(id);
let config = null;
let last = null;   // { preset, rows }

function say(msg, kind) {
  const el = $('status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = msg;
}

function loginPrompt() {
  say('Not signed in to the portal. Opening the login page — sign in, then click the preset again.', 'warn');
  chrome.tabs.create({ url: LOGIN });
}

async function run(preset, button) {
  $('actions').classList.add('hide');
  say('Fetching ' + preset.name + '…');
  document.querySelectorAll('button.preset').forEach(b => b.disabled = true);

  // All fetching lives in background.js, so the popup and the platform bridge
  // share one implementation and cannot drift apart.
  const r = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'fetch', presetId: preset.id }, resolve));

  document.querySelectorAll('button.preset').forEach(b => b.disabled = false);

  if (!r || !r.ok) {
    if (r && r.error === 'auth') return loginPrompt();
    if (r && r.error === 'network')
      return say('Could not reach the portal. Are you on the university network?', 'err');
    return say('Fetch failed: ' + ((r && r.error) || 'unknown')
      + (r && r.status ? ' (HTTP ' + r.status + ')' : ''), 'err');
  }

  const rows = r.rows;
  last = { preset, rows };

  if (!rows.length) {
    say('0 students matched "' + preset.name + '". The filter codes may be stale — '
      + 'check them against the portal before trusting this.', 'warn');
    return;
  }

  let msg = rows.length + ' students · ' + config.term.label;
  let kind = null;
  if (preset.expect && preset.expect !== rows.length) {
    msg += '\n(expected ~' + preset.expect + ' — roll changes are normal, a big gap is not)';
    kind = 'warn';
  }
  say(msg, kind);
  $('actions').classList.remove('hide');
  chrome.storage.local.set({ ['last_' + preset.id]: { n: rows.length, at: Date.now() } });
}

function toCsv(rows) {
  const present = Object.keys(rows[0]).filter(k => k !== '__id');
  const cols = config.columns.filter(c => present.includes(c));
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(',')]
    .concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\r\n');
}

function trim(rows) {
  return rows.map(r => {
    const o = {};
    config.columns.forEach(c => { if (c in r) o[c] = r[c]; });
    return o;
  });
}

$('csv').addEventListener('click', () => {
  if (!last) return;
  // '﻿' = BOM, so Excel reads UTF-8 names correctly.
  const blob = new Blob(['﻿' + toCsv(last.rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: last.preset.id + '-' + new Date().toISOString().slice(0, 10) + '.csv',
    saveAs: true
  }, () => setTimeout(() => URL.revokeObjectURL(url), 10000));
});

$('copy').addEventListener('click', async () => {
  if (!last) return;
  await navigator.clipboard.writeText(JSON.stringify(trim(last.rows), null, 1));
  say(last.rows.length + ' students copied to the clipboard as JSON.');
});

(async () => {
  config = await (await fetch(chrome.runtime.getURL('presets.json'))).json();
  $('term').textContent = config.term.label;
  const stored = await chrome.storage.local.get(null);
  config.presets.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset';
    const seen = stored['last_' + p.id];
    b.textContent = p.name + (seen ? '  · ' + seen.n + ' last time' : '');
    b.addEventListener('click', () => run(p, b));
    $('list').appendChild(b);
  });
})();
