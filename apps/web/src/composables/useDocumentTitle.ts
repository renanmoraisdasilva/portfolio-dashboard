import { onMounted } from 'vue';

const BASE = 'Portfolio Dashboard';

/**
 * Per-page document title.
 *
 * Client-side navigation does not reload the document, so without this every
 * view would leave the tab reading "Portfolio Dashboard" — the legacy pages set
 * it in their own `<title>`.
 */
export function useDocumentTitle(title: string): void {
  onMounted(() => {
    document.title = title === BASE ? BASE : `${title} — ${BASE}`;
  });
}
