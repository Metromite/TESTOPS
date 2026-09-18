import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Printer, Search } from "lucide-react";
import Modal from "./Modal";
import { GlassInput } from "../design-system/GlassInput";
import { GlassButton } from "../design-system/GlassButton";
import { GlassTable } from "../design-system/GlassTable";

/**
 * Dashboard Detail Window (V2 milestone): the popup that opens when you
 * click a KPI card, chart, or table row. Supports sorting (click a
 * header), searching (instant, across every column), copy (TSV to
 * clipboard - pastes straight into Excel), export (CSV download), and
 * print (opens a clean, isolated print view so you don't print the whole
 * app chrome around it). Hosted in the shared Modal, so it's already
 * auto-sized/vertical-scroll-only per the Responsive Detail Windows work.
 */
export interface DetailColumn { key: string; label: string; }

export default function DetailWindow({
  title, columns, rows, loading, truncated, totalMatching, onClose,
}: {
  title: string;
  columns: DetailColumn[];
  rows: Record<string, any>[];
  loading?: boolean;
  truncated?: boolean;
  totalMatching?: number;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Never mount thousands of table rows at once. The old dashboard detail
  // window rendered every returned invoice synchronously, which could block
  // the main thread and make a KPI click look like a full-page freeze.
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, sortKey, sortDir, columns]);

  useEffect(() => { setPage(0); }, [search, sortKey, sortDir, rows]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toTsv(): string {
    const header = columns.map((c) => c.label).join("\t");
    const body = filtered.map((r) => columns.map((c) => r[c.key] ?? "").join("\t")).join("\n");
    return `${header}\n${body}`;
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(toTsv()); } catch { /* clipboard permissions vary by browser - silently ignore */ }
  }

  function handleExportCsv() {
    const csv = columns.map((c) => c.label).join(",") + "\n" +
      filtered.map((r) => columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const win = window.open("", "_blank", "width=1000,height=700");
    if (!win) return;
    const rowsHtml = filtered.map((r) =>
      `<tr>${columns.map((c) => `<td>${r[c.key] ?? ""}</td>`).join("")}</tr>`
    ).join("");
    win.document.write(`
      <html><head><title>${title}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 24px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 13px; }
        th { background: #f0f0f0; }
      </style></head><body>
      <h2>${title}</h2>
      <table><thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GlassInput
          icon={<Search className="h-4 w-4" />}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-auto min-w-[220px]"
        />
        <GlassButton variant="secondary" size="sm" onClick={handleCopy}><Copy className="h-3.5 w-3.5" />Copy</GlassButton>
        <GlassButton variant="secondary" size="sm" onClick={handleExportCsv}><Download className="h-3.5 w-3.5" />Export</GlassButton>
        <GlassButton variant="secondary" size="sm" onClick={handlePrint}><Printer className="h-3.5 w-3.5" />Print</GlassButton>
        <span className="text-[12px] text-muted">
          {filtered.length.toLocaleString()} row{filtered.length === 1 ? "" : "s"}
          {truncated && totalMatching ? ` (showing first ${rows.length.toLocaleString()} of ${totalMatching.toLocaleString()} - narrow your filters for the rest)` : ""}
        </span>
      </div>

      {loading ? (
        <div className="py-8 text-center text-muted">Loading…</div>
      ) : (
        // Render only one small page of rows. Searching/sorting still uses the
        // full in-memory result set, but the DOM never contains thousands of
        // <tr>s at once. This is the critical anti-freeze path for KPI details.
        // constrained vertical overflow before. A table with many columns
        // has no natural max-width of its own, so without overflow-x
        // here too, its full intrinsic width could inflate the modal's
        // `width: fit-content` sizing calculation (in GlassModal.tsx)
        // past the viewport, before the modal's max-w-92vw clamp got a
        // chance to apply - overflow only clips rendering, it doesn't
        // retroactively shrink a fit-content ancestor's computed width.
        // overflow-x-auto here gives the table its own horizontal scroll
        // and stops it from pushing the dialog's own size around.
        <GlassTable.Wrap className="max-h-[60vh] overflow-y-auto overflow-x-auto">
          <GlassTable.Root>
            {/* Sticky header is safe here: this table always lives inside a
                bounded-height scroll area (the modal cap above), not the
                page flow, so it can't overlap the app's sticky TopNav. */}
            <GlassTable.Header sticky>
              <tr>
                {columns.map((c) => (
                  <GlassTable.Th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none">
                    {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </GlassTable.Th>
                ))}
              </tr>
            </GlassTable.Header>
            <GlassTable.Body>
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length} className="py-5 text-center text-muted">No matching rows.</td></tr>
              )}
              {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r, i) => (
                <tr key={`${page}-${i}`}>
                  {columns.map((c) => <GlassTable.Td key={c.key}>{r[c.key] ?? "—"}</GlassTable.Td>)}
                </tr>
              ))}
            </GlassTable.Body>
          </GlassTable.Root>
        </GlassTable.Wrap>
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-muted">
            Showing {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <GlassButton variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</GlassButton>
            <span className="text-[12px] text-muted">Page {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span>
            <GlassButton variant="secondary" size="sm" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage((p) => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))}>Next</GlassButton>
          </div>
        </div>
      )}
    </Modal>
  );
}
