'use strict';
/*
 * Content script — injected only into the coordinator platform's own pages.
 *
 * It is a relay and nothing else: page  <--window.postMessage-->  bridge
 *                                 bridge <--chrome.runtime------>  background
 *
 * Why a content script rather than `externally_connectable`: that approach
 * needs the page to hardcode the extension ID, and an unpacked (developer
 * mode) install gets a fresh random ID on every machine. This works the same
 * everywhere with no per-install configuration.
 */

const CHANNEL = 'scen-rosters';
const ORIGIN = window.location.origin;

window.addEventListener('message', event => {
  // Only messages this page sent to itself. Never a frame, never another origin.
  if (event.source !== window || event.origin !== ORIGIN) return;

  const req = event.data;
  if (!req || req.channel !== CHANNEL || req.dir !== 'request') return;

  const reply = payload =>
    window.postMessage({ channel: CHANNEL, dir: 'response', id: req.id, payload }, ORIGIN);

  let outgoing;
  switch (req.type) {
    case 'ping':
    case 'presets':
      outgoing = { type: req.type };
      break;
    case 'schema':
      outgoing = { type: 'schema', kind: String(req.kind || 'students') };
      break;
    case 'fetch':
      // A composed filter may cross now, but the service worker checks every field and
      // value against the schema it learned from the portal before it sends anything.
      outgoing = req.filter
        ? { type: 'fetch', filter: req.filter, meta: Object.assign({}, req.meta || {}, { kind: String(req.kind || 'students') }) }
        : { type: 'fetch', presetId: String(req.presetId || '') };
      break;
    default:
      return reply({ ok: false, error: 'unknown_message' });
  }

  try {
    chrome.runtime.sendMessage(outgoing, res => {
      if (chrome.runtime.lastError) {
        return reply({ ok: false, error: 'extension_unavailable', message: chrome.runtime.lastError.message });
      }
      reply(res);
    });
  } catch (e) {
    reply({ ok: false, error: 'extension_unavailable', message: String(e) });
  }
});

/*
 * Relay the background's progress to the page.
 *
 * A pull is now several requests rather than one, and the page has a single timer over
 * the whole thing. These let it know the pull is alive, so a slow success stops looking
 * like a hang — which is how a working sync came to be reported as a missing extension.
 */
chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== 'fetch_progress') return;
  window.postMessage(
    {
      channel: CHANNEL,
      dir: 'progress',
      fetched: message.fetched,
      total: message.total,
      name: message.name
    },
    ORIGIN
  );
});

// Announce availability for pages that are already listening. Pages that load
// later should use ping() instead of relying on catching this.
window.postMessage(
  { channel: CHANNEL, dir: 'hello', version: chrome.runtime.getManifest().version },
  ORIGIN
);
