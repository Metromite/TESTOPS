import type { ReactNode, DragEvent } from "react";
import { Building2, Cross, Warehouse, Package, Truck, CarFront } from "lucide-react";

/**
 * Flat "hexagonal cube" building block for the Bulk Organizer game view.
 * Three clip-path faces (top/left/right) give an isometric-looking block
 * without any perspective/3D transform math or WebGL — cheap to render,
 * identical on every machine. Colour + icon come from the wrapping class
 * (see the .iso-building / .iso-vehicle / .iso-pallet rules in index.css).
 */
export function IsoCube({ icon, dragOver }: { icon?: ReactNode; dragOver?: boolean }) {
  return (
    <div className={`iso-cube-wrap${dragOver ? " dragover" : ""}`}>
      {icon && <div className="iso-cube__icon">{icon}</div>}
      <div className="iso-cube__top" />
      <div className="iso-cube__left" />
      <div className="iso-cube__right" />
    </div>
  );
}

const BUILDING_ICON: Record<string, ReactNode> = {
  store: <Building2 size={20} />,
  hospital: <Cross size={20} />,
  warehouse: <Warehouse size={20} />,
};

export function IsoBuilding({
  name,
  subtitle,
  buildingType = "store",
  notify,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: {
  name: string;
  subtitle?: string;
  buildingType?: "store" | "hospital" | "warehouse";
  notify?: boolean;
  dragOver?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onClick?: () => void;
}) {
  return (
    <div className="iso-slot" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div
        className={`iso-building ${buildingType}`}
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(e); }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ position: "relative" }}
      >
        {notify && <span className="iso-badge">!</span>}
        <IsoCube icon={BUILDING_ICON[buildingType]} dragOver={dragOver} />
      </div>
      <div className="iso-slot-label">{name}</div>
      {subtitle && <div className="iso-slot-sub">{subtitle}</div>}
    </div>
  );
}

export function IsoVehicle({
  label,
  subtitle,
  driverName,
  pct,
  used,
  capacity,
  empty,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  isPickup,
}: {
  label: string;
  subtitle?: string;
  driverName?: string;
  pct: number;
  used: number;
  capacity: number;
  empty?: boolean;
  dragOver?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  isPickup?: boolean;
}) {
  // Yellow while there's still room, green only once actually full - matches
  // "بيزيد باللون الأصفر... أول ما توصل أخضر معناه إنها كده full" from the brief.
  const fillColor = pct >= 100 ? "#4e9a24" : "#f2c53d";
  return (
    <div className="iso-slot" style={{ width: 118 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div
          className={`iso-vehicle${empty ? " empty" : ""}`}
          onDragOver={(e) => { e.preventDefault(); onDragOver?.(e); }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <IsoCube icon={isPickup ? <Truck size={19} /> : <CarFront size={19} />} dragOver={dragOver} />
        </div>
        <div className="iso-gauge" title={`${used} / ${capacity} pallets`}>
          <div className="iso-gauge-fill" style={{ height: `${Math.min(100, pct)}%`, background: fillColor }} />
        </div>
      </div>
      <div className="iso-slot-label">{label}</div>
      {subtitle && <div className="iso-slot-sub">{subtitle}</div>}
      <div className="iso-slot-sub">{used}/{capacity} · {driverName || "no driver set"}</div>
    </div>
  );
}

export function IsoPallet({
  loaded,
  draggable = true,
  onDragStart,
  label,
}: {
  loaded?: boolean;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  label?: string;
}) {
  return (
    <div className={`iso-pallet-wrap iso-pallet${loaded ? " loaded" : ""}`} draggable={draggable} onDragStart={onDragStart} title={label}>
      <IsoCube icon={<Package size={13} />} />
    </div>
  );
}
