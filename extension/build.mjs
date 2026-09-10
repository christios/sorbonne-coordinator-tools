#!/usr/bin/env node
/*
 * Build the two extensions: one for the deployed platform, one for a laptop.
 *
 * They have to be two rather than one with both origins in its matches, because a
 * coordinator who is also developing has both loaded at once. With one manifest listing
 * both, the same content script is injected into both pages by both installs — two
 * bridges answering one `ping`, two `hello` messages, and no way to tell from the toolbar
 * which of them just pulled three thousand students. Chrome will not tell you either: the
 * unpacked build and the packed one have different ids and identical names.
 *
 * So each build matches exactly one platform origin, is named for it, and says which it
 * is in its popup and in the hello it announces itself with. Everything else — the portal
 * host permission, the grids, the service worker — is shared, because it is the same
 * extension talking to the same registrar either way.
 *
 *     node extension/build.mjs        # writes extension/dist/prod and extension/dist/dev
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

/** The files both builds carry, verbatim. The manifest is written, not copied. */
const SHARED = [
  "background.js",
  "bridge.js",
  "filter-schema.js",
  "grids.js",
  "popup.html",
  "popup.js",
  "portal-probe.js",
  "portal-relay.js",
  "presets.json",
  "timetable.js",
];

const FLAVOURS = {
  prod: {
    name: "SCEN Rosters",
    title: "SCEN Rosters",
    platform: ["https://sorbonne-coordinator-tools.fastapicloud.dev/*"],
    where: "the deployed Coordinator Tools",
  },
  dev: {
    // The word is in the name so the extensions page, the toolbar's tooltip and any
    // screenshot of either say which one is which without being asked.
    name: "SCEN Rosters (dev)",
    title: "SCEN Rosters — development build, talks to localhost",
    platform: ["http://localhost/*", "http://localhost:*/*", "http://127.0.0.1:*/*"],
    where: "Coordinator Tools on this machine",
  },
};

const base = JSON.parse(await readFile(join(HERE, "manifest.json"), "utf8"));

for (const [flavour, spec] of Object.entries(FLAVOURS)) {
  const out = join(DIST, flavour);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const file of SHARED) await cp(join(HERE, file), join(out, file));

  const manifest = structuredClone(base);
  manifest.name = spec.name;
  manifest.action.default_title = spec.title;
  // Exactly one platform origin per build, and `flavour.js` ahead of the bridge in the
  // same entry — content scripts of one entry share an isolated world, so the bridge
  // reads it as a plain global. The portal's own host permission and the two scripts that
  // read it are untouched: both builds talk to the same registrar.
  manifest.content_scripts = manifest.content_scripts.map((script) =>
    script.js.includes("bridge.js")
      ? { ...script, matches: spec.platform, js: ["flavour.js", ...script.js] }
      : script,
  );
  await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  /*
   * Which build this is, as a script rather than a JSON file.
   *
   * A content script cannot `fetch(chrome.runtime.getURL(...))` an extension resource
   * unless it is listed in `web_accessible_resources` — which would make it readable by
   * every page on the internet to fingerprint the install. A script in the same entry is
   * synchronous, private to the isolated world, and needs no permission at all.
   */
  await writeFile(
    join(out, "flavour.js"),
    "'use strict';\n" +
      "/* Written by build.mjs. Do not edit: your changes are overwritten on the next build. */\n" +
      `globalThis.SCEN_FLAVOUR = ${JSON.stringify({ flavour, where: spec.where })};\n`,
  );

  console.log(`${flavour.padEnd(5)} → ${out}  (${spec.platform.join(", ")})`);
}
