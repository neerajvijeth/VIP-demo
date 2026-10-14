import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { Bookmark, LayoutDashboard, MessageSquare, Moon, Server, ShieldAlert, Terminal, Wand2 } from 'lucide-react';
import { useUi } from '@/store/ui';
import { useSaved } from '@/store/saved';
import { builderStore } from '@/store/builder';
import { ENTITY } from '@/lib/entities';
import { getPresets, encodeHash } from '@/lib/tree';
import { useOpenBuilder } from '@/lib/hooks';

const itemCls = 'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground aria-selected:bg-muted aria-selected:text-foreground';
const headCls = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground';

export function CommandPalette() {
  const { paletteOpen, setPalette, toggleTheme } = useUi();
  const navigate = useNavigate();
  const open = useOpenBuilder();
  const { views } = useSaved();
  const go = (fn: () => void) => () => {
    setPalette(false);
    fn();
  };
  return (
    <Dialog.Root open={paletteOpen} onOpenChange={setPalette}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-pop-in">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Jump to pages, presets and saved views</Dialog.Description>
          <Command label="Command palette" className={headCls}>
            <Command.Input autoFocus placeholder="Jump to a page, preset or saved view…" className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground" />
            <Command.List className="max-h-[50vh] overflow-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing found.</Command.Empty>
              <Command.Group heading="Pages">
                <Command.Item className={itemCls} onSelect={go(() => navigate('/dashboard/overview'))}><LayoutDashboard size={15} /> Overview <span className="ml-auto mono text-[11px] text-muted-foreground">g o</span></Command.Item>
                <Command.Item className={itemCls} onSelect={go(() => navigate('/dashboard/assets'))}><Server size={15} /> Assets <span className="ml-auto mono text-[11px] text-muted-foreground">g a</span></Command.Item>
                <Command.Item className={itemCls} onSelect={go(() => navigate('/dashboard/vulnerabilities'))}><ShieldAlert size={15} /> Vulnerabilities <span className="ml-auto mono text-[11px] text-muted-foreground">g v</span></Command.Item>
                <Command.Item className={itemCls} onSelect={go(() => navigate('/dashboard/sql'))}><Terminal size={15} /> Custom SQL <span className="ml-auto mono text-[11px] text-muted-foreground">g s</span></Command.Item>
                <Command.Item className={itemCls} onSelect={go(() => navigate('/chat'))}><MessageSquare size={15} /> Chatbot <span className="ml-auto mono text-[11px] text-muted-foreground">g c</span></Command.Item>
              </Command.Group>
              <Command.Group heading="Quick-filter presets">
                {getPresets().map((p) => (
                  <Command.Item key={p.id} value={`preset ${p.label} ${p.entity}`} className={itemCls} onSelect={go(() => open(p.entity, p.tree, undefined, p.summary))}>
                    <Wand2 size={15} /> {p.label} <span className="ml-auto text-[11px] text-muted-foreground">{ENTITY[p.entity].label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {views.length > 0 && (
                <Command.Group heading="Saved views">
                  {views.map((v) => (
                    <Command.Item
                      key={v.id}
                      value={`saved ${v.name} ${v.entity}`}
                      className={itemCls}
                      onSelect={go(() => {
                        builderStore(v.entity).getState().loadView(v);
                        navigate(ENTITY[v.entity].path + encodeHash(v.tree, v.options, v.mode === 'summary' ? v.summary : null));
                      })}
                    >
                      <Bookmark size={15} /> {v.name} <span className="ml-auto text-[11px] text-muted-foreground">{ENTITY[v.entity].label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Preferences">
                <Command.Item className={itemCls} onSelect={go(toggleTheme)}><Moon size={15} /> Toggle theme</Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
