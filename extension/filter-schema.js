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

/**
 * Never filterable, whatever any schema says.
 *
 * The endpoint returns these columns and the allowlist strips them from the answer — but
 * *filtering* by one is a question in itself: ask whether any student has a given passport
 * number and the row count answers it. So they are refused as filter fields outright,
 * rather than depending on a schema being complete.
 */
export const NEVER_FILTERABLE = new Set([
  'PASSPORT_ID',
  'DOB_CHAR',
  'BIRTH_DATE',
  'MOBILE_NO',
  'PHONE_NO',
  'PERS_EMAIL',
  'BALANCE',
  'NATIONAL_ID',
]);

/**
 * Refuse anything the schema does not recognise, and say which part was wrong.
 *
 * Values are enforced only where the list can be trusted: what the extension read from
 * the portal itself, or a fallback field marked verified. A hand-written list that has
 * never been checked is a suggestion — enforcing it would block the *correct* code, which
 * is exactly what happened with ESTS_CODE. Shape is always enforced, whatever the source:
 * a field name is a field name, and a value is a code rather than a sentence.
 */
export function checkFilter(filter, fields, { trustValues = false } = {}) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return 'filter_not_an_object';
  const keys = Object.keys(filter);
  if (!keys.length) return 'filter_empty';
  if (keys.length > MAX_FIELDS) return 'too_many_fields';

  const known = new Map(fields.map(f => [f.key, f]));
  for (const key of keys) {
    if (!FIELD_KEY.test(key)) return 'bad_field:' + key;
    if (NEVER_FILTERABLE.has(key)) return 'sensitive_field:' + key;
    // Only the portal's own list is complete enough to refuse an unknown field by name.
    if (trustValues && !known.has(key)) return 'unknown_field:' + key;
    const values = filter[key];
    if (!Array.isArray(values) || !values.length) return 'bad_values:' + key;
    if (values.length > MAX_VALUES) return 'too_many_values:' + key;
    const field = known.get(key);
    const enforce = (trustValues || field?.verified) && (field?.options || []).length;
    for (const value of values) {
      if (typeof value !== 'string' || !VALUE.test(value)) return 'bad_value:' + key;
      if (enforce && !field.options.some(option => option.value === value)) {
        return 'value_not_offered:' + key + '=' + value;
      }
    }
  }
  return null;
}
