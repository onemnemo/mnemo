import { useT } from '@/i18n/useT';

export function useNotesT() {
  const t = useT();
  return (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
}
