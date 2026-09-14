/**
 * Reading a pasted time-sheet link before it is saved.
 *
 * Both answers are also the server's, and are made here as well so the mistake is said
 * while the coordinator is still looking at what they pasted. The common one is the file
 * path out of Explorer rather than the share link out of OneDrive.
 */

/** The host a link points at, so a wrong paste is visible without opening it. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * A web address, and nothing that could run as script.
 *
 * Not tidiness: a stored `javascript:` address would run the moment a coordinator
 * clicked the teacher's name for it. OneDrive's own share links are long and
 * query-heavy, and pass.
 */
export function isWebLink(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
