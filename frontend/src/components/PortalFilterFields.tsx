import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";

import { fetchSchema, type PortalField } from "@/services/scenRosters";

const PORTAL_URL = "https://reg.psuad.ac.ae/PSUADPortal/StudentSearch/Enrollment";

/**
 * What the extension knows the portal can be filtered by.
 *
 * The filter builder is generated from this, so it is worth being able to see it: if the
 * portal has never been visited since the extension was installed, the list is the
 * hand-verified fallback rather than the real thing, and that difference explains a
 * search that returns nobody.
 */
export function PortalFilterFields() {
  const [open, setOpen] = useState(false);
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });

  const learned = schema.data?.source === "portal";
  const fields = schema.data?.fields ?? [];
  const withValues = fields.filter((field) => field.options.length).length;

  return (
    <section className="mt-6 rounded-lg border border-[#d9dee7] bg-white">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
      >
        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <span className="text-sm font-semibold text-[#171717]">Portal filters</span>
        {schema.isLoading ? (
          <span className="text-sm text-[#667085]">asking the extension…</span>
        ) : !schema.data?.ok ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#a6292f]">
            <AlertTriangle size={14} aria-hidden="true" /> {schema.data?.error || "not available"}
          </span>
        ) : learned ? (
          <span className="inline-flex items-center gap-1 text-sm text-[#256237]">
            <Check size={14} aria-hidden="true" /> {fields.length} fields read from the portal
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#8a6d00]">
            <AlertTriangle size={14} aria-hidden="true" /> using the built-in list
          </span>
        )}
        <RefreshCw
          size={14}
          aria-hidden="true"
          className="ml-auto text-[#98a2b3]"
          onClick={(event) => {
            event.stopPropagation();
            void schema.refetch();
          }}
        />
      </button>

      {open ? (
        <div className="border-t border-[#eef1f5] px-5 py-4">
          {!learned ? (
            <p className="mb-3 max-w-3xl text-sm leading-6 text-[#667085]">
              These are the codes verified by hand in August, not the portal's own list. Open the{" "}
              <a href={PORTAL_URL} target="_blank" rel="noreferrer" className="font-semibold text-[#1f4e79] underline">
                Student Search page
              </a>{" "}
              once, come back and refresh, and the extension will replace them with whatever the
              portal actually offers today.
            </p>
          ) : (
            <p className="mb-3 text-sm text-[#667085]">
              Read from the portal itself, so a filter the registrar adds or renames turns up here.
              {withValues ? ` ${withValues} of them list the values they accept.` : ""}
            </p>
          )}

          {fields.length === 0 ? (
            <p className="text-sm text-[#667085]">No fields yet.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {fields.map((field) => (
                <li key={field.key} className="rounded-md border border-[#eef1f5] px-3 py-2">
                  <FieldSummary field={field} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FieldSummary({ field }: { field: PortalField }) {
  return (
    <>
      <span className="block text-sm font-semibold text-[#171717]">{field.label || field.key}</span>
      <span className="block text-xs tabular-nums text-[#98a2b3]">{field.key}</span>
      {field.options.length ? (
        <span className="mt-1 block text-xs text-[#667085]">
          {field.options
            .slice(0, 8)
            .map((option) => option.value)
            .join(", ")}
          {field.options.length > 8 ? ` … ${field.options.length} in total` : ""}
        </span>
      ) : (
        <span className="mt-1 block text-xs text-[#98a2b3]">any value</span>
      )}
    </>
  );
}
