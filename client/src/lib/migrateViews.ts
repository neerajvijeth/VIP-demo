import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSaved } from '@/store/saved';
import { toast } from '@/store/toast';
import { SavedApi } from './savedQueries';

let started = false;

/**
 * One-time move of the old browser-only "Saved views" into server-side Saved queries, so nothing the user saved is lost
 * when the sidebar list goes away. A view is removed locally only after the server accepted it.
 */
export function useMigrateLocalViews() {
  const qc = useQueryClient();
  useEffect(() => {
    if (started) return;
    const local = useSaved.getState().views;
    if (!local.length) return;
    started = true;
    (async () => {
      try {
        const existing = await SavedApi.list();
        let moved = 0, failed = 0;
        for (const v of local) {
          const dup = existing.find((q) => q.kind === 'builder' && q.entity === v.entity && q.name === v.name);
          try {
            if (!dup) await SavedApi.create({ kind: 'builder', entity: v.entity, name: v.name, description: 'Moved from your browser saved views', payload: { tree: v.tree, columns: v.columns, sort: v.sort, options: v.options, mode: v.mode ?? 'rows', summary: v.summary } });
            useSaved.getState().remove(v.id);
            moved++;
          } catch { failed++; }
        }
        await qc.invalidateQueries({ queryKey: ['saved-sql'] });
        if (moved) toast.success('Saved views moved', `${moved} view${moved === 1 ? '' : 's'} from this browser ${moved === 1 ? 'is' : 'are'} now in Saved queries.`);
        if (failed) toast.warning('Some views could not be moved', `${failed} saved view${failed === 1 ? '' : 's'} no longer match the data (for example a removed column) and stay in this browser.`);
      } catch {
        started = false; // server unreachable: try again next time the app loads
      }
    })();
  }, [qc]);
}
