import { Bold, Heading, Italic, List, ListOrdered } from "lucide-react";
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

const tools = [
  { command: "bold", label: "Bold", icon: Bold },
  { command: "italic", label: "Italic", icon: Italic },
  { command: "formatBlock", argument: "<h3>", label: "Heading", icon: Heading },
  { command: "insertUnorderedList", label: "Bulleted list", icon: List },
  { command: "insertOrderedList", label: "Numbered list", icon: ListOrdered },
] as const;

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

  const apply = (command: string, argument?: string) => {
    editor.current?.focus();
    // Left to itself the browser writes emphasis as an inline style on a span, which is
    // exactly the kind of markup a pasted value is stripped of — so the bold vanished on
    // save. Asking for tags instead gives <b> and <i>, which survive.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, argument);
    publish();
  };

  return (
    <label className="grid w-full grid-cols-[minmax(0,1fr)] content-start gap-1 text-sm font-medium text-[#344054]">
      <FormFieldLabel hint={hint} fieldKey={history?.field.path}>
        {label}
      </FormFieldLabel>
      <div
        className={`relative rounded-md border ${focused ? "border-[#1f4e79] ring-2 ring-[#d7e5f3]" : "border-[#b7bec8]"}`}
      >
        <div className="flex flex-wrap items-center gap-1 border-b border-[#e5e7eb] px-2 py-1.5">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              // The button must not take focus, or the selection it is meant to act on is lost.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(tool.command, "argument" in tool ? tool.argument : undefined)}
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
          // A paste carries the styling of wherever it came from; take the words only.
          onPaste={(event) => {
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
            publish();
          }}
          className="prose-syllabus min-h-24 w-full px-3 py-2 font-normal leading-6 text-[#344054] outline-none [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ml-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-6 [&_ul]:list-disc [&_ul]:pl-6"
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
