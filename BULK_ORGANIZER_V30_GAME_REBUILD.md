# Bulk Organizer v30 — Game Board Rebuild

This rebuild keeps the existing DispatchOPS Fleet/SAP source tables intact and moves the visual planning experience into Bulk Organizer.

## Board
1. Buildings / Customers
2. Vehicles / Pickups / Vans
3. Today's Invoices / Pallets

## Planning behavior
- Buildings are user-created 3D-style game pieces and can be named, typed (warehouse/hospital/store/custom), and assigned an area.
- Buildings and customer schedules can be saved as global defaults and reused across dates.
- Fleet vehicles are not all placed automatically. The user selects the default vehicles.
- Vehicle number/type/division/area permissions continue to come from Fleet Data Manager.
- Capacity is editable per selected vehicle; yellow means space remains, green means full.
- Driver/helper are optional day-level vehicle metadata.
- Orders are shown only on their scheduled date.
- Invoices can be added with invoice number, customer, invoice date, schedule date, pallets, division and area.
- Customer input uses the existing SAP customer library as a predictive datalist.
- Customer schedules create day-specific notification cards in the Bulk Organizer side rail.
- Pallets are draggable into vehicles; whole invoices can also be dragged.
- Vehicles can be dragged onto buildings to route the vehicle for that day.
- Vehicle drops are checked against area, vehicle type, division and Fleet permitted-area mappings.
- Bulk Organizer daily plans use Supabase Realtime so open copies of the same day can receive saved changes live.

## Database
Migration `0047_bulk_organizer_game_board.sql` adds:
- `bulk_organizer_plans.buildings`
- `bulk_organizer_plans.vehicle_meta`
- `bulk_organizer_plans.customer_schedules`
- `bulk_organizer_defaults` for reusable global defaults
- Realtime publication entries for the planner tables

## Wallpaper
The ThemeProvider now keeps the existing Supabase light/dark wallpaper URL as a CSS variable and fixed background layer as well as the inline body background, preventing the iOS/liquid-glass page chrome from visually hiding the uploaded wallpaper.
