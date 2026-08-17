import { LoaderCircle, Search } from "lucide-react";
import { FormEvent, useId, useState } from "react";

import { BibliographyLookupItem, BibliographyLookupKind, lookupBibliography } from "@/services/bibliographyLookup";

type Props = {
  kind: BibliographyLookupKind;
  onApply: (item: BibliographyLookupItem) => void;
};

export function BibliographyReferenceFinder({ kind, onApply }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BibliographyLookupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputId = useId();
  const label = kind === "book" ? "Find book by ISBN, title, or author" : "Find article by DOI, title, or author";

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setResults([]);
    try {
      setResults(await lookupBibliography(kind, query));
    } catch (reason) {
      setResults([]);
      setError(reason instanceof Error ? reason.message : "Reference lookup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const apply = (item: BibliographyLookupItem) => {
    onApply(item);
    setResults([]);
  };

  return (
    <section className="grid gap-3 rounded-md border border-[#d9dee7] bg-[#f8fafc] p-3" aria-label="Reference finder">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={search}>
          <label className="sr-only" htmlFor={inputId}>{label}</label>
          <input id={inputId} value={query} onChange={(event) => { setQuery(event.target.value); setHasSearched(false); setError(null); }} type="search" placeholder={label} className="h-10 min-w-0 flex-1 rounded-md border border-[#b7bec8] bg-white px-3 text-sm text-[#344054] placeholder:text-[#667085] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />
          <button type="submit" disabled={isLoading || query.trim().length < 2} className="inline-flex min-w-[10.75rem] shrink-0 whitespace-nowrap items-center justify-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#173b5e] disabled:cursor-not-allowed disabled:bg-[#98a2b3]">
            {isLoading ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />} Search references
          </button>
        </form>
        {error ? <p role="alert" className="text-sm text-[#a6292f]">{error}</p> : null}
        {!hasSearched && !error ? <p className="text-sm text-[#667085]">Search by a title, author, ISBN, or DOI. Selecting a result fills the editable fields below.</p> : null}
        {hasSearched && !isLoading && results.length === 0 && !error ? <p role="status" className="text-sm text-[#667085]">No matching references were found. Try the ISBN, a shorter title, or an author surname.</p> : null}
        {results.length ? <div className="grid gap-2" aria-label="Reference search results">{results.map((item, index) => <button key={`${item.provider}-${item.doi ?? item.isbn ?? item.title}-${index}`} type="button" onClick={() => apply(item)} className="rounded-md border border-[#d9dee7] bg-white p-3 text-left hover:border-[#98a2b3] hover:bg-[#fdfdfd] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]">
          <span className="block text-sm font-semibold text-[#344054]">{item.title}</span>
          <span className="mt-1 block text-sm text-[#667085]">{[item.authors.join(", "), item.journal ?? item.publisher, item.year].filter(Boolean).join(" · ")}</span>
          <span className="mt-1 block text-xs font-medium text-[#667085]">{item.provider}</span>
        </button>)}</div> : null}
    </section>
  );
}
