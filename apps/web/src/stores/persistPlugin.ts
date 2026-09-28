import type { PiniaPluginContext } from 'pinia';

declare module 'pinia' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface DefineStoreOptionsBase<S, Store> {
    /**
     * localStorage keys whose state is mirrored to storage. Keys are used
     * verbatim, not namespaced, so a value written by the vanilla pages before
     * the Vue migration is still read after it.
     */
    persist?: string[];
  }
}

/**
 * Pinia plugin: mirrors the state keys a store opts into into `localStorage`.
 *
 * Replaces the scattered `localStorage.setItem` calls the vanilla pages made
 * (`simAllocCurrency`, `allocCurrency`, …) with one declaration on the store.
 * Strings are stored bare, which is what those pages wrote, so a preference set
 * before the migration is still read afterwards.
 */
export function persistPlugin({ store, options }: PiniaPluginContext): void {
  const keys = options.persist;
  if (!keys || keys.length === 0) return;

  const read = (key: string): unknown => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Written by a vanilla page: a bare string rather than JSON.
      return raw;
    }
  };

  const write = (key: string, value: unknown): void => {
    if (value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  };

  for (const key of keys) {
    const stored = read(key);
    if (stored === undefined) continue;
    if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
      store.$patch((state) => Object.assign(state, stored));
    } else {
      store.$patch((state) => {
        (state as Record<string, unknown>)[key] = stored;
      });
    }
  }

  store.$subscribe(
    (_mutation, state) => {
      for (const key of keys) write(key, (state as Record<string, unknown>)[key]);
    },
    { detached: true },
  );
}
