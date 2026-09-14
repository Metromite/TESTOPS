import { useRef, useState } from "react";
import { api } from "../api/client";

interface Props {
  endpointPrefix: string; // e.g. "/drivers"
  onImported: () => void;
  canWrite: boolean;
}

export default function TableImportExport({ endpointPrefix, onImported, canWrite }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function handleExport() {
    window.open(`/api${endpointPrefix}/export-excel`, "_blank");
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg("");
    const token = localStorage.getItem("access_token");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api${endpointPrefix}/import-excel`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Import failed");
      setMsg(`Imported: ${data.created} created, ${data.updated} updated${data.skipped_blank_key ? `, ${data.skipped_blank_key} skipped` : ""}.`);
      if (fileRef.current) fileRef.current.value = "";
      onImported();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUndo() {
    setBusy(true);
    setMsg("");
    try {
      const res = await api.post(`${endpointPrefix}/undo-last`, {});
      if (!res.ok) throw new Error(res.error || "Nothing to undo");
      setMsg(`Undid last ${res.undid_action} on ${res.entity_key}.`);
      onImported();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" style={{ background: "var(--navy3)", color: "var(--muted)" }} onClick={handleExport}>
        📥 Export Excel
      </button>
      {canWrite && (
        <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ maxWidth: 180, fontSize: 12 }} />
          <button className="btn" onClick={handleImport} disabled={busy}>
            {busy ? "Importing..." : "📤 Import Excel"}
          </button>
          <button className="btn" style={{ background: "var(--amber)" }} onClick={handleUndo} disabled={busy}>
            ↩ Undo Last Change
          </button>
        </>
      )}
      {msg && <span style={{ fontSize: 12, color: "var(--muted)" }}>{msg}</span>}
    </div>
  );
}
