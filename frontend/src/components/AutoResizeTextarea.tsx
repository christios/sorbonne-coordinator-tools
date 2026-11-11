import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number };

/**
 * A text box as tall as what it holds. It measures again when its text changes and when its
 * width does — a table column settling, a window resized — since the same words take more
 * lines in a narrower box, and a box measured at the old width cuts its last line off.
 */
export function AutoResizeTextarea({ minRows = 3, value, className, ...props }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const fit = () => {
      textarea.style.height = "auto";
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
      textarea.style.height = `${Math.max(textarea.scrollHeight, lineHeight * minRows)}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    // Only a change of width can change the number of lines; reacting to height as well
    // would answer the box's own resizing and never stop.
    let width = textarea.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (Math.abs(next - width) < 0.5) return;
      width = next;
      fit();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [minRows, value]);

  return <textarea ref={textareaRef} value={value} rows={minRows} className={`w-full resize-none ${className ?? ""}`} {...props} />;
}
