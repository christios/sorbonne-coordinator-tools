import { useEffect, useState } from "react";

import { recall, remember } from "@/services/remembered";

/** Said whenever a remembered choice changes, so every page holding it follows at once. */
const CHANGED = "scen-remembered";

type Changed = CustomEvent<{ key: string; value: string }>;

/**
 * A piece of state that this browser keeps: `useState`, but it is still there tomorrow.
 *
 * Read when the component mounts and written on every change, so a page that unmounts on
 * the way to another page comes back to the same choice. And shared while it is open: the
 * semester chosen in the header moves the page on screen with it, not only the next one —
 * every holder of the same key hears the change, in this tab and in the others.
 */
export function useRemembered(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => recall(key));

  useEffect(() => {
    const follow = (event: Event) => {
      const said = (event as Changed).detail;
      if (said?.key === key) setValue(said.value);
    };
    // Another tab of the same browser: localStorage says so on its own.
    const elsewhere = () => setValue(recall(key));
    window.addEventListener(CHANGED, follow);
    window.addEventListener("storage", elsewhere);
    return () => {
      window.removeEventListener(CHANGED, follow);
      window.removeEventListener("storage", elsewhere);
    };
  }, [key]);

  return [
    value,
    (next: string) => {
      setValue(next);
      remember(key, next);
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: { key, value: next } }));
    },
  ];
}
