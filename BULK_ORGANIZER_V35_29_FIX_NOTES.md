# Bulk Organizer V35.29 Fixes

- Fixed **Add Another Invoice** schedule picker: clicking **Date** now opens a real date input for that invoice row, starts from the current planning date, and allows selecting any future planning date without the old weekday/date-list restriction blocking the picker.
- Standardized pallet conversion to **1 Big = 2 Small**.
  - Big pallet = 1.00 Big-equivalent
  - Small pallet = 0.50 Big-equivalent
  - Example: 5 Big + 3 Small = 6.50 Big-equivalent
  - Example: 6 Big = 6.00 Big-equivalent
  - Example: 9 Small = 4.50 Big-equivalent
- Bulk Organizer vehicle capacity is enforced entirely in **Big-pallet-equivalent** units.
- Vehicle cards show used/free **Big-pallet space** and the equivalent small-pallet count.
- Fleet Database uses one capacity field only: **Pallet Capacity (Big Equivalent)**.
- Production Supabase `public.vehicles` was updated so the legacy `big_pallet_capacity` and `small_pallet_capacity` columns are removed; `pallet_capacity` remains the single capacity field.
