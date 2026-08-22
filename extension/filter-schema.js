/*
 * What the portal will accept as a filter — the one place that decides it.
 *
 * The platform composes filters now instead of naming a preset, so this is what keeps
 * that safe: a field the schema does not know, or a value a field does not offer, is
 * refused here and never reaches the portal. Kept in its own module so it can be tested
 * without a browser; see frontend/src/services/portalFilters.test.ts.
 */

export const FIELD_KEY = /^[A-Z][A-Z0-9_]{1,39}$/;
export const VALUE = /^[A-Za-z0-9._\-]{1,40}$/;
export const MAX_FIELDS = 12;
export const MAX_VALUES = 40;

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

/** Refuse anything the schema does not recognise, and say which part was wrong. */
export function checkFilter(filter, fields) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return 'filter_not_an_object';
  const keys = Object.keys(filter);
  if (!keys.length) return 'filter_empty';
  if (keys.length > MAX_FIELDS) return 'too_many_fields';

  const known = new Map(fields.map(f => [f.key, f]));
  for (const key of keys) {
    if (!FIELD_KEY.test(key)) return 'bad_field:' + key;
    // An empty schema means nothing has been learned yet; fall back to shape checks only.
    if (known.size && !known.has(key)) return 'unknown_field:' + key;
    const values = filter[key];
    if (!Array.isArray(values) || !values.length) return 'bad_values:' + key;
    if (values.length > MAX_VALUES) return 'too_many_values:' + key;
    const allowed = known.get(key)?.options || [];
    for (const value of values) {
      if (typeof value !== 'string' || !VALUE.test(value)) return 'bad_value:' + key;
      if (allowed.length && !allowed.some(option => option.value === value)) {
        return 'value_not_offered:' + key + '=' + value;
      }
    }
  }
  return null;
}
