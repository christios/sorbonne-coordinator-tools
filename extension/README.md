# SCEN Rosters — Chrome extension

One click gives a coordinator a filtered student roster. **No portal
navigation, no page, no filter setting** — and no stored password.

## Why this works

The portal is a Serenity Platform app whose grid endpoint accepts filters in
the request body:

    POST https://reg.psuad.ac.ae/PSUADPortal/Services/StudentSearch/Enrollment/List
    {"EqualityFilter":{...},"Sort":["FULL_NAME"],"Skip":0,"Take":0}

Because the filters travel in the request, a saved preset can be fired
directly — the portal page never has to be opened. `Take: 0` means no limit,
so the whole set arrives in one response.

Authentication is the user's ordinary portal session cookie. `host_permissions`
lets the extension attach it with `credentials: 'include'`. Consequences:

* No password is requested, stored or transmitted, by anyone.
* Nothing is shared between coordinators; each runs as themselves.
* Authorisation stays server-side — each person receives exactly the rows the
  portal would already show them. This grants nobody new access.
* The extension can talk to `reg.psuad.ac.ae` and nothing else.

## Install (per coordinator)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → choose this `extension/` folder
3. Pin "SCEN Rosters" to the toolbar

For more than a couple of people, publish it unlisted on the Chrome Web Store
or have IT push it by policy — unpacked installs nag on every restart.

## Use

Click the toolbar icon, click a preset. That's the whole workflow. Then
**Download CSV** or **Copy JSON**.

If the session has expired the portal login page opens; sign in and click the
preset again. That single login is the only recurring manual step — see
"Limits" below.

## Editing presets

`presets.json`. Verified filter codes for the current term:

| Field | Values |
|---|---|
| `YEARLEVEL_CODE` | `FY`, `L1`, `L2`, `L3` |
| `STST_CODE` | `AS` Active, `ME` Make-up Exam, `IS` Inactive, `DA` Declined, `WD` Withdrawal, `DF` Deferred, `DI` Dismissed |
| `ESTS_CODE` | `NA` Not Available, `NS` No Show |
| `MAJOR_CODE` | `MATH`, `PHYS` |
| `DEPT_CODE` | `SCEN` |
| `LEVEL_CODE` | `UG` |
| `CAMPUS_CODE` | `AD` |
| `STYP_CODE` | `N` New, `C` Continuing, `H` FY Math, `P` FY Physics, `R` Re-Admission |

**Each new term, update `term.code`.** Current: `262710` (First Semester
2026-2027).

An unrecognised code does not error — it returns **zero rows**, confidently.
That is why every preset carries an `expect` count: the popup warns when the
live number diverges. Counts verified 2026-08-21, and they reconcile:
FY 245 + L1 119 + L2 37 + L3 14 = 415 = all years; MATH 359 + PHYS 56 = 415.

## Columns and privacy

The server **ignores `IncludeColumns`** and always returns all 45 fields,
including `PASSPORT_ID`, `DOB_CHAR`, `MOBILE_NO`, `PERS_EMAIL` and `BALANCE`.
Something has to trim that before anything is written to disk or the clipboard.

Since v1.5 the list of columns is **read from the grid**, the same list its
Column Picker offers, so the platform's table can show what the registrar
shows — *plus* the columns in `presets.json`, which the service has always
answered with. Neither list contains the other: the grid shows
`CURRENT_AVERAGE`, which the service does not return, and the service returns
`FIRST_NAME` and `LAST_NAME`, which the grid folds into one `FULL_NAME` column.

Two things bound the result:

* `NEVER_RETURNED` in `filter-schema.js` — passport, national/Emirates ID,
  date of birth, mobile, phone, personal e-mail and balance, matched as
  substrings of the column key so a name nobody here has seen is caught too. A
  cohort table has no use for any of them, and pulling one would put it in a
  coordinator's `localStorage` for the rest of the term.
* The `columns` list in `presets.json` — no longer a fallback but a floor: it
  is offered whether or not anybody has visited the portal.

`SPRIDEN_ID` is always kept: every answer is keyed by it.

## Limits

* **A live portal session is still required.** One login when it expires,
  typically once a day. Removing even that would mean storing credentials —
  don't. If unattended/scheduled extraction is ever needed, ask IT for a
  service account or a scheduled export instead.
* `CURRENT_AVERAGE` and `ACTIVITY_CODE` are grid columns but are not in the
  service response, so they cannot be exported here. They are harvested from
  the Column Picker like the rest, so the platform will offer them and their
  cells will be empty — the grid and the service disagree, and the grid is what
  the picker describes.
* Private, undocumented endpoint: a portal upgrade may change the contract.
  The `expect` counts are the early-warning system.
* Two coordinators running the same preset may legitimately get different
  counts if their portal roles differ in scope.

---

# Platform integration (v1.1)

The coordinator platform cannot call the portal itself — the endpoint sends no
CORS headers, and the session cookie is `SameSite`-scoped to the portal. So the
UI lives in the platform and the *permission* lives here:

    platform page  <--window.postMessage-->  bridge.js  <--runtime-->  background.js  --> portal

* `background.js` — the only code allowed to reach the portal. One
  implementation, shared by the popup and the platform.
* `bridge.js` — content script, injected only into the platform's origin.
  A relay; it holds no logic.
* `../platform/scen-rosters.js` — ES module the platform imports.

**Only a preset id crosses the bridge — never a raw filter.** Any script on the
platform origin can reach it, so the set of possible queries is fixed in
`presets.json` rather than chosen by the caller.

## Wiring it into the platform

1. Copy `platform/scen-rosters.js` into the web app.
2. Add the app's origin to `content_scripts[0].matches` in `manifest.json`
   (`https://sorbonne-coordinator-tools.fastapicloud.dev/*` and localhost are
   already there). Reload the extension after editing.
3. Use it:

```js
import { isInstalled, listPresets, fetchRoster, download } from './scen-rosters.js';

if (!await isInstalled()) showInstallPrompt();
const { presets } = await listPresets();
const roster = await fetchRoster('scen-fy');
if (roster.ok) render(roster.rows);
else if (roster.error === 'auth') window.open(roster.loginUrl, '_blank');
```

`platform/demo.html` is a complete working example — preset buttons, results
table, CSV download, and every error path.

## Why a content script instead of `externally_connectable`

`externally_connectable` needs the page to hardcode the extension ID, and an
unpacked install gets a fresh random ID on every machine. The content script
works identically everywhere with no per-install configuration. Switch to
`externally_connectable` if you later publish with a stable ID.

## Tests

`platform/bridge-test.html` mocks the extension side and asserts the protocol
end to end — run it on any origin, no install needed. 9/9 passing as of
2026-08-21.

## If IT ever grants CORS

Add `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` on the
portal and set the auth cookie `SameSite=None; Secure`, and the extension
becomes unnecessary: reimplement `fetchRoster()` as a direct fetch and delete
the rest. The platform code above does not change.
