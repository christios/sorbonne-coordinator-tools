/**
 * The e-mail addresses of the students in a section, for pasting into a mail client.
 *
 * They come from the pulls this browser is holding, like the names beside them, and they
 * go no further than this tab — the server is never told a student's name or address.
 *
 * Semicolons, not commas. Outlook is where these are pasted and it treats a comma inside
 * an address list as part of an address unless a setting nobody has has been changed; a
 * semicolon is unambiguous there and accepted everywhere else.
 *
 * Who is missing is returned rather than quietly dropped. A copy of twenty addresses for
 * a section of twenty-four is the kind of thing that only shows up when four people say
 * they never got the mail.
 */

export type WithEmail = { studentId: string };

export type EmailList = {
  /** Addresses, in the order the list shows them, with duplicates removed. */
  found: string[];
  /** The student ids this browser holds no address for. */
  missing: string[];
};

export function emailsFor(students: WithEmail[], held: Record<string, string>): EmailList {
  const found: string[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const student of students) {
    const address = (held[student.studentId] ?? "").trim();
    if (!address) {
      missing.push(student.studentId);
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(address);
  }
  return { found, missing };
}

/** The one string that goes on the clipboard. */
export function asMailList(emails: string[]): string {
  return emails.join("; ");
}
