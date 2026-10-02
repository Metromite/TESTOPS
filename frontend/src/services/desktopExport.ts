import * as XLSX from "xlsx";
import { invoke } from "@tauri-apps/api/core";

export interface ExportProgress {
  pct: number;
  status: "preparing" | "saving" | "success" | "error";
  message: string;
  path?: string;
}

interface SaveResult { path: string; bytes: number; }

function isTauriDesktop(): boolean {
  return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

export async function saveWorkbookToDispatchFolder(
  workbook: XLSX.WorkBook,
  filename: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<SaveResult> {
  try {
    onProgress?.({ pct: 15, status: "preparing", message: "Preparing Excel workbook…" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (!isTauriDesktop()) {
      onProgress?.({ pct: 65, status: "saving", message: "Preparing Excel download…" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const xlsxBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
      onProgress?.({ pct: 85, status: "saving", message: "Starting Excel download…" });
      const blob = new Blob([xlsxBytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      // Browser-only download. Keep this completely separate from the Tauri
      // save path so the web Dashboard never depends on the native command.
      const legacySaver = (navigator as any).msSaveOrOpenBlob;
      if (typeof legacySaver === "function") {
        legacySaver.call(navigator, blob, filename);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.rel = "noopener";
        link.style.position = "fixed";
        link.style.left = "-9999px";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      const result = { path: filename, bytes: blob.size };
      onProgress?.({ pct: 100, status: "success", message: "Excel export downloaded successfully.", path: filename });
      return result;
    }

    onProgress?.({ pct: 65, status: "saving", message: "Preparing Excel file for save…" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const base64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64", compression: true });
    onProgress?.({ pct: 78, status: "saving", message: "Saving to DispatchOPS Exports…" });
    const result = await invoke<SaveResult>("save_export_file", {
      payload: { filename, base64_data: base64 },
    });
    onProgress?.({ pct: 100, status: "success", message: "Excel export saved successfully.", path: result.path });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({ pct: 100, status: "error", message });
    throw error;
  }
}

export async function getDispatchExportFolder(): Promise<string> {
  if (!isTauriDesktop()) return "Browser Downloads";
  return invoke<string>("get_export_folder");
}

export interface OfflineExportAttachment { filename: string; base64_data: string; }

function base64ToBlob(base64: string, mime: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

/**
 * Packs one Excel workbook plus its evidence attachments (pharmacy photos /
 * signatures) into a single .zip - the Excel file at the zip root, images in
 * a sibling folder inside the zip - and saves that one .zip locally (Tauri:
 * next to the app via the existing generic save_export_file command; browser
 * fallback: a normal browser download). The Excel's hyperlinks point at
 * `${attachmentsDirName}/<file>`, a relative path that resolves correctly
 * once the zip is extracted, so clicking a linked cell opens the matching
 * image straight from that folder.
 * Real progress (not simulated) comes from JSZip's own onUpdate callback
 * during compression, reported through onProgress the same way the other
 * export helpers in this file do, so it drives the shared ExportStatus bar.
 */
export async function saveZipBundle(
  zipFilename: string,
  excelFilename: string,
  excelBase64: string,
  attachments: OfflineExportAttachment[],
  attachmentsDirName: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<SaveResult & { attachments: number }> {
  try {
    onProgress?.({ pct: 1, status: "preparing", message: "Starting download…" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    onProgress?.({ pct: 3, status: "preparing", message: "Packing Excel file and attachments…" });
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const exportFolderName = zipFilename.replace(/\.zip$/i, "");
    zip.file(`${exportFolderName}/${excelFilename}`, excelBase64, { base64: true });
    for (const a of attachments) {
      zip.file(`${exportFolderName}/${attachmentsDirName}/${a.filename}`, a.base64_data, { base64: true });
    }
    const zipBase64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE", compressionOptions: { level: 3 } }, (meta) => {
      onProgress?.({ pct: Math.max(2, Math.min(92, Math.round(meta.percent))), status: "preparing", message: "Packing Excel file and attachments…" });
    });

    if (!isTauriDesktop()) {
      onProgress?.({ pct: 96, status: "saving", message: "Downloading zip file…" });
      const blob = base64ToBlob(zipBase64, "application/zip");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = zipFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      onProgress?.({ pct: 100, status: "success", message: "Zip file downloaded successfully.", path: zipFilename });
      return { path: zipFilename, bytes: 0, attachments: attachments.length };
    }

    onProgress?.({ pct: 96, status: "saving", message: "Saving zip file…" });
    const result = await invoke<SaveResult>("save_export_file", {
      payload: { filename: zipFilename, base64_data: zipBase64 },
    });
    onProgress?.({ pct: 100, status: "success", message: "Zip file saved successfully.", path: result.path });
    return { ...result, attachments: attachments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({ pct: 100, status: "error", message });
    throw error;
  }
}

export async function saveWorkbookWithOfflineAttachments(
  workbook: XLSX.WorkBook,
  filename: string,
  attachments: OfflineExportAttachment[],
): Promise<SaveResult & { attachments: number; attachments_dir: string }> {
  if (!isTauriDesktop()) {
    const xlsxBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([xlsxBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return { path: filename, bytes: blob.size, attachments: 0, attachments_dir: '' };
  }
  const base64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64', compression: true });
  const stem = filename.replace(/\.[^.]+$/, '');
  return invoke<SaveResult & { attachments: number; attachments_dir: string }>('save_export_bundle', {
    payload: { filename, base64_data: base64, attachments_dir: `${stem}_Attachments`, attachments },
  });
}
