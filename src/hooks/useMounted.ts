import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True after the component has mounted — use to avoid SSR/client hydration
 * mismatches (e.g. for values that depend on `localStorage`).
 * `useSyncExternalStore` keeps the first render identical on server and client,
 * so no effect/setState and no hydration warning.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}
