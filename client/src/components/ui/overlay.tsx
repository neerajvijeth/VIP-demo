import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = 'start', children, ...p }: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn('z-50 rounded-lg border border-border bg-popover text-foreground shadow-lg shadow-black/10 animate-pop-in outline-none', className)}
        {...p}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/** Right-hand side sheet (detail drawer, SQL drawer). */
export function Sheet({ open, onOpenChange, title, description, children, width = 'max-w-xl', side = 'right' }: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  width?: string;
  side?: 'right' | 'left';
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-fade-in no-print" />
        <Dialog.Content
          className={cn('fixed top-0 z-50 h-full w-full bg-popover border-border shadow-2xl flex flex-col animate-sheet-in no-print', width, side === 'right' ? 'right-0 border-l' : 'left-0 border-r')}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold truncate">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Details panel</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Modal({ open, onOpenChange, title, children, className }: { open: boolean; onOpenChange: (b: boolean) => void; title: string; children: ReactNode; className?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content className={cn('fixed left-1/2 top-[18%] z-50 w-[92vw] max-w-md -translate-x-1/2 rounded-lg border border-border bg-popover p-5 shadow-2xl animate-pop-in', className)}>
          <Dialog.Title className="mb-3 text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
