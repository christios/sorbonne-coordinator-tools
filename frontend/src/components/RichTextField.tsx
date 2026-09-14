import {
  Bold,
  Heading1,
  Heading2,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FieldHistoryControl, type HistoryField } from "@/components/FieldHistory";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { plainToRichText, sanitiseRichText } from "@/services/richText";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  history?: { field: HistoryField; onOpenHistory: (field: HistoryField) => void };
};

/** 1, then a, then i, and round again — the three a numbered list is usually written in. */
const NUMBERINGS = ["1", "a", "i"] as const;

/**
 * A box for writing a session out properly: headings, emphasis and lists.
 *
 * The content lives in the element rather than in React state, because rewriting it on every
 * keystroke would put the caret back at the start. It is written in only when the value
 * arrives from somewhere else — a different session opened, a revision restored.
 */
export function RichTextField({ label, value, onChange, hint, history }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const lastWritten = useRef<string>("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const element = editor.current;
    if (!element) return;
    const html = plainToRichText(value);
    if (html === lastWritten.current || html === element.innerHTML) return;
    element.innerHTML = html;
    lastWritten.current = html;
  }, [value]);

  const publish = () => {
    const element = editor.current;
    if (!element) return;
    const html = sanitiseRichText(element.innerHTML);
    // Opening a session and closing it again is not an edit. Without this, simply looking at
    // one rewrote the field — plain text became paragraphs — and left a revision behind.
    if (html === lastWritten.current) return;
    lastWritten.current = html;
    onChange(html);
  };

  const run = (command: string, argument?: string) => {
    editor.current?.focus();
    // Left to itself the browser writes emphasis as an inline style on a span, which is
    // exactly the kind of markup a pasted value is stripped of — so the bold vanished on
    // save. Asking for tags instead gives <b> and <i>, which survive.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, argument);
    publish();
  };

  /** A heading button is a switch: pressed on a heading of its own level, it turns it off. */
  const toggleHeading = (tag: "h3" | "h4") => {
    const current = document.queryCommandValue("formatBlock").toLowerCase();
    run("formatBlock", current === tag ? "<p>" : `<${tag}>`);
  };

  /** Cycle the list the caret is in through the ways a numbered list is written. */
  const cycleNumbering = () => {
    const element = editor.current;
    const anchor = window.getSelection()?.anchorNode;
    const list =
      anchor && element?.contains(anchor)
        ? (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("ol")
        : null;
    if (!list) {
      run("insertOrderedList");
      return;
    }
    const next = NUMBERINGS[(NUMBERINGS.indexOf((list.getAttribute("type") ?? "1") as never) + 1) % NUMBERINGS.length];
    list.setAttribute("type", next);
    publish();
  };

  const tools = [
    { label: "Bold", icon: Bold, act: () => run("bold") },
    { label: "Italic", icon: Italic, act: () => run("italic") },
    { label: "Heading", icon: Heading1, act: () => toggleHeading("h3") },
    { label: "Subheading", icon: Heading2, act: () => toggleHeading("h4") },
    { label: "Bulleted list", icon: List, act: () => run("insertUnorderedList") },
    { label: "Numbered list — press again for a, then i", icon: ListOrdered, act: cycleNumbering },
    { label: "Indent, to nest a list inside another", icon: Indent, act: () => run("indent") },
    { label: "Outdent", icon: Outdent, act: () => run("outdent") },
  ];

  return (
    <label className="grid h-full w-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-1 text-sm font-medium text-[#344054]">
      <FormFieldLabel hint={hint} fieldKey={history?.field.path}>
        {label}
      </FormFieldLabel>
      <div
        className={`relative flex h-full min-h-40 flex-col rounded-md border ${focused ? "border-[#1f4e79] ring-2 ring-[#d7e5f3]" : "border-[#b7bec8]"}`}
      >
        <div className="flex flex-wrap items-center gap-1 border-b border-[#e5e7eb] px-2 py-1.5 pr-10">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              // The button must not take focus, or the selection it is meant to act on is lost.
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.act}
              className="rounded p-1.5 text-[#475467] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
            >
              <tool.icon size={16} />
            </button>
          ))}
        </div>
        <div
          ref={editor}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          onInput={publish}
          onBlur={() => { setFocused(false); publish(); }}
          onFocus={() => setFocused(true)}
          // Tab nests a list item rather than leaving the box, which is what it does in
          // every other editor a professor has written a list in.
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            run(event.shiftKey ? "outdent" : "indent");
          }}
          // A paste carries the styling of wherever it came from; take the words only.
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
            publish();
          }}
          className="min-h-24 w-full flex-1 overflow-y-auto px-3 py-2 font-normal leading-6 text-[#344054] outline-none [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:font-semibold [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol[type=a]]:list-[lower-alpha] [&_ol[type=i]]:list-[lower-roman] [&_p]:min-h-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]"
        />
        {history ? (
          <div className="absolute right-2 top-2">
            <FieldHistoryControl
              field={history.field}
              onOpenSidebar={history.onOpenHistory}
              placement="label"
            />
          </div>
        ) : null}
      </div>
    </label>
  );
}
