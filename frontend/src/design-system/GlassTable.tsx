import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * GlassTable - composable table primitives (shadcn/ui table pattern) that
 * read the app's existing theme variables. Drop-in visual replacement for
 * the legacy `<table className="data-table">` markup:
 *
 *   <GlassTable.Root><GlassTable.Wrap>
 *     <GlassTable.Header><tr>...</tr></GlassTable.Header>
 *     <GlassTable.Body>...</GlassTable.Body>
 *   </GlassTable.Wrap></GlassTable.Root>
 */
function Wrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full overflow-x-auto rounded-lg", className)} {...props} />;
}

function Root({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />;
}

function Header({ className, sticky = false, ...props }: HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "bg-[var(--glass-bg)] [&_tr]:border-b [&_tr]:border-edge",
        sticky && "sticky top-0 z-10 backdrop-blur-glass",
        className
      )}
      {...props}
    />
  );
}

function Body({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        "[&_tr]:border-b [&_tr]:border-edge [&_tr:nth-child(even)]:bg-[var(--row-alt)] [&_tr:hover]:bg-[var(--row-hover)] [&_tr]:transition-colors [&_tr]:duration-100",
        className
      )}
      {...props}
    />
  );
}

function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("whitespace-nowrap px-3.5 py-2.5 text-left text-[12px] font-bold uppercase tracking-wide text-muted", className)}
      {...props}
    />
  );
}

function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("whitespace-nowrap px-3.5 py-2.5 text-ink", className)} {...props} />;
}

export const GlassTable = { Wrap, Root, Header, Body, Th, Td };
