import { onMounted } from 'vue';

const BASE = 'Portfolio Dashboard';

export function useDocumentTitle(title: string): void {
  onMounted(() => {
    document.title = title === BASE ? BASE : `${title} — ${BASE}`;
  });
}
