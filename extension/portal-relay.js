'use strict';
/*
 * Content script on the registrar portal, in the usual isolated world.
 *
 * portal-probe.js runs in the page's world so it can read the filter widgets' values, but
 * a page-world script cannot talk to the extension. This relays what it found, and
 * nothing else: only messages this page sent to itself, only on the expected channel, and
 * only definitions — the filters the grid offers and the columns it has. No student row
 * passes through here.
 */

const CHANNEL = 'scen-portal-fields';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL) return;
  if (!Array.isArray(message.fields) && !Array.isArray(message.columns)) return;

  try {
    chrome.runtime.sendMessage({
      type: 'fields:harvest',
      fields: Array.isArray(message.fields) ? message.fields : [],
      columns: Array.isArray(message.columns) ? message.columns : [],
      url: message.url,
    });
  } catch {
    // The service worker may be asleep or the extension reloading; the next visit retries.
  }
});
