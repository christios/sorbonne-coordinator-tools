import { useState } from "react";

import { recall, remember } from "@/services/remembered";

/**
 * A piece of state that this browser keeps: `useState`, but it is still there tomorrow.
 *
 * Read once when the component mounts and written on every change, so a page that unmounts
 * on the way to another page comes back to the same choice.
 */
export function useRemembered(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => recall(key));
  return [
    value,
    (next: string) => {
      setValue(next);
      remember(key, next);
    },
  ];
}
