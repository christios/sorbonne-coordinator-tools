'use strict';
/*
 * Content script on the registrar portal, in the usual isolated world.
 *
 * portal-probe.js runs in the page's world so it can read the filter widgets' values, but
 * a page-world script cannot talk to the extension. This relays what it found, and
 * nothing else: only messages this page sent to itself, only on the expected channel, and
 * only a list of field definitions.
 */

const CHANNEL = 'scen-portal-fields';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL || !Array.isArray(message.fields)) return;

  try {
    chrome.runtime.sendMessage({ type: 'fields:harvest', fields: message.fields, url: message.url });
  } catch {
    // The service worker may be asleep or the extension reloading; the next visit retries.
  }
});
