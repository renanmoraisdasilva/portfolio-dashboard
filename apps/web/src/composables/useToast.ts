import { readonly, ref } from 'vue';

export interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'error';
}

const toasts = ref<Toast[]>([]);
let nextId = 1;

/**
 * App-wide toasts.
 *
 * Module state rather than a store: toasts are fire-and-forget UI and must
 * survive navigation between views. Replaces the DOM-append helper the vanilla
 * pages each carried.
 */
export function useToast() {
  function show(text: string, kind: 'success' | 'error' = 'success', timeout = 4000): void {
    const id = nextId++;
    toasts.value.push({ id, text, kind });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, timeout);
  }

  return { toasts: readonly(toasts), show };
}
