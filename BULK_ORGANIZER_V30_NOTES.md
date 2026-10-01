# Bulk Organizer v30

## Scope
Adds the requested nested planning experience inside DispatchOPS without changing the existing operational Fleet/SAP tables.

## Planning model
Customer -> Invoice -> Pallet -> Vehicle.

- Customers are day-level containers and can be added/removed per date.
- Customer names use predictive suggestions from existing SAP invoice history plus customers already added to the current plan.
- Invoices can be added manually or loaded from the selected day's SAP invoice facts.
- Each invoice has invoice number, customer, location/area, division, pallet count, invoice date and schedule date.
- Pallet pieces are generated from the invoice pallet count and are individually draggable.
- Whole invoices can also be dragged into customers or vehicles.
- Individual pallets can be dragged into vehicles or back to the pending pool.
- Vehicle capacity is calculated from the current plan; capacity is editable per vehicle/day.

## Fleet integration
Vehicles are read directly from `vehicles` and permitted areas from `vehicle_permitted_areas` joined to `areas`. The displayed vehicle number/type is always the current Fleet value. Vehicle drops are blocked when the invoice area is incompatible with the vehicle type, division, or permitted-area mapping.

## Persistence
The existing `bulk_organizer_plans` table remains the only table used for this feature. Migration 0046 adds JSONB columns for `customers`, `invoices`, and `pallet_assignments`; no operational Fleet/SAP schema is modified.

## Navigation stability
The route-level Suspense boundary was moved inside `ProtectedLayout`, so the persistent top navigation remains mounted while lazy pages load instead of disappearing/reloading between pages.

## Subcategory UI
`DashboardTabs` now carries a shared `dashboard-tabs` class so Fleet subcategories such as Drivers, Helpers, Vehicles, Areas and Area Groups use the same glass tab treatment.

## Verification
A full production TypeScript build could not be completed in the sandbox because dependency installation exceeded the available execution window. Source-level delimiter checks were performed; no claim of a completed production build is made.
