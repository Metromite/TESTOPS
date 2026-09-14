import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Truck, User } from "lucide-react";
import { api } from "../api/client";
import Modal from "./Modal";
import { GlassCard } from "../design-system/GlassCard";

interface Availability {
  drivers: { available_count: number; total_count: number; available_names: string[]; on_vacation_names: string[] };
  helpers: { available_count: number; total_count: number; available_names: string[]; on_vacation_names: string[] };
  extra_drivers: { count: number; names: string[] };
  extra_helpers: { count: number; names: string[] };
  shortage: {
    current_driver_shortage: number; future_driver_shortage: number;
    current_helper_shortage: number; future_helper_shortage: number; has_shortage: boolean;
  };
}

export default function AvailabilityWidget() {
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<string | null>(null);

  async function load() {
    try { setData(await api.get("/dashboard/availability")); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <GlassCard className="mb-5 text-[var(--red)]">{error}</GlassCard>;
  if (!data) return null;

  const shortageLabel = data.shortage.has_shortage
    ? `D:-${data.shortage.current_driver_shortage} | H:-${data.shortage.current_helper_shortage}`
    : "Sufficient";

  return (
    <>
      <h3 className="mb-2.5 text-[13px] font-semibold text-ink">Today's Availability</h3>
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <GlassCard interactive onClick={() => setModal("drivers")} className="flex flex-col gap-1.5">
          <Truck className="h-4 w-4 text-muted" />
          <span className="font-mono text-[24px] font-bold tabular-nums text-[var(--teal)]">{data.drivers.available_count} / {data.drivers.total_count}</span>
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Drivers Available</span>
        </GlassCard>
        <GlassCard interactive onClick={() => setModal("extra_drivers")} className="flex flex-col gap-1.5">
          <Truck className="h-4 w-4 text-muted" />
          <span className="font-mono text-[24px] font-bold tabular-nums text-[var(--teal)]">{data.extra_drivers.count}</span>
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Extra Drivers (Surplus)</span>
        </GlassCard>
        <GlassCard interactive onClick={() => setModal("helpers")} className="flex flex-col gap-1.5">
          <User className="h-4 w-4 text-muted" />
          <span className="font-mono text-[24px] font-bold tabular-nums text-[var(--teal)]">{data.helpers.available_count} / {data.helpers.total_count}</span>
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Helpers Available</span>
        </GlassCard>
        <GlassCard interactive onClick={() => setModal("extra_helpers")} className="flex flex-col gap-1.5">
          <User className="h-4 w-4 text-muted" />
          <span className="font-mono text-[24px] font-bold tabular-nums text-[var(--teal)]">{data.extra_helpers.count}</span>
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Extra Helpers (Surplus)</span>
        </GlassCard>
        <GlassCard
          interactive
          onClick={() => setModal("shortage")}
          className={"flex flex-col gap-1.5" + (data.shortage.has_shortage ? " border-[var(--red)]/50" : "")}
        >
          {data.shortage.has_shortage ? <AlertTriangle className="h-4 w-4 text-[var(--red)]" /> : <CheckCircle2 className="h-4 w-4 text-[var(--green)]" />}
          <span className={"font-mono text-[20px] font-bold tabular-nums " + (data.shortage.has_shortage ? "text-[var(--red)]" : "text-[var(--green)]")}>
            {shortageLabel}
          </span>
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Route Status</span>
        </GlassCard>
      </div>

      {modal === "drivers" && (
        <Modal title="Drivers" onClose={() => setModal(null)}>
          <NameList label={`Available (${data.drivers.available_names.length})`} names={data.drivers.available_names} ok />
          <NameList label={`On Vacation (${data.drivers.on_vacation_names.length})`} names={data.drivers.on_vacation_names} />
        </Modal>
      )}
      {modal === "helpers" && (
        <Modal title="Helpers" onClose={() => setModal(null)}>
          <NameList label={`Available (${data.helpers.available_names.length})`} names={data.helpers.available_names} ok />
          <NameList label={`On Vacation (${data.helpers.on_vacation_names.length})`} names={data.helpers.on_vacation_names} />
        </Modal>
      )}
      {modal === "extra_drivers" && (
        <Modal title="Extra Drivers (Surplus)" onClose={() => setModal(null)}>
          <p className="mb-2 text-[12px] text-muted">Drivers currently free. Some may be scheduled as future replacements.</p>
          <NameList label="" names={data.extra_drivers.names} />
        </Modal>
      )}
      {modal === "extra_helpers" && (
        <Modal title="Extra Helpers (Surplus)" onClose={() => setModal(null)}>
          <p className="mb-2 text-[12px] text-muted">Helpers currently free. Some may be scheduled as future replacements.</p>
          <NameList label="" names={data.extra_helpers.names} />
        </Modal>
      )}
      {modal === "shortage" && (
        <Modal title="Shortage Details" onClose={() => setModal(null)}>
          {data.shortage.has_shortage ? (
            <div className="flex flex-col gap-1.5 text-[13px]">
              <p className="font-semibold text-[var(--red)]">Shortage Detected!</p>
              <p>Current Driver Shortage: <strong className="font-mono tabular-nums">{data.shortage.current_driver_shortage}</strong></p>
              <p>Future Driver Shortage (Replacements): <strong className="font-mono tabular-nums">{data.shortage.future_driver_shortage}</strong></p>
              <p>Current Helper Shortage: <strong className="font-mono tabular-nums">{data.shortage.current_helper_shortage}</strong></p>
              <p>Future Helper Shortage (Replacements): <strong className="font-mono tabular-nums">{data.shortage.future_helper_shortage}</strong></p>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[var(--green)]"><CheckCircle2 className="h-4 w-4" /> Sufficient staff for all mandatory routes today.</p>
          )}
        </Modal>
      )}
    </>
  );
}

function NameList({ label, names, ok }: { label: string; names: string[]; ok?: boolean }) {
  if (names.length === 0) return label ? <p className="text-[12px] text-muted">{label}: none</p> : null;
  return (
    <div className="mb-3">
      {label && (
        <div className={"mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold " + (ok ? "text-[var(--green)]" : "text-[var(--amber)]")}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {label}
        </div>
      )}
      <ol className="m-0 list-decimal pl-5 text-[13px] text-ink">
        {names.map((n, i) => <li key={i}>{n}</li>)}
      </ol>
    </div>
  );
}
