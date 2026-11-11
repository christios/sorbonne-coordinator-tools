/**
 * A course schedule card turned from a session into a graded activity, or back (11 Nov 2026).
 *
 * The week and date stay; the session's topic names the graded activity, or the activity's
 * name (else its type) becomes the session's topic, when the card has none of its own yet.
 * Nothing else is dropped: what only the other kind shows — a session's type, length and
 * details, an activity's weight, outcomes and AI policy — stays on the card, out of sight and
 * out of the document (every reader goes by the kind), so switching back brings it back.
 */
export type CardKind = "session" | "graded";
type Card = Record<string, string> & { id: string };

export function cardKind(card: Card): CardKind {
  return card.kind === "graded" ? "graded" : "session";
}

export function switchCardKind(card: Card, to: CardKind): Card {
  if (cardKind(card) === to) return card;
  if (to === "graded") {
    const name = card.name?.trim() ? card.name : firstLine(card.topic);
    return { ...card, kind: "graded", name };
  }
  const session = { ...card };
  delete session.kind;
  const topic = card.topic?.trim() ? card.topic : card.name?.trim() || card.type?.trim() || "";
  return { ...session, topic };
}

function firstLine(value: string | undefined): string {
  return (value ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}
