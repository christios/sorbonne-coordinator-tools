import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number };

export function AutoResizeTextarea({ minRows = 3, value, className, ...props }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
    textarea.style.height = `${Math.max(textarea.scrollHeight, lineHeight * minRows)}px`;
  }, [minRows, value]);

  return <textarea ref={textareaRef} value={value} rows={minRows} className={`w-full resize-none ${className ?? ""}`} {...props} />;
}
