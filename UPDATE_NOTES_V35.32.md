# DispatchOPS V35.32 – Bulk Organizer fixes

- Standard pallet conversion: 1 Big = 1.5 Small; 1 Small = 2/3 Big-equivalent.
- Bulk Organizer totals now use Big-equivalent as the standard total while preserving raw Big/Small counts.
- Vehicle cards show loaded Big, loaded Small, and Total Big-equivalent.
- Mixed Big/Small department entries preserve pallet_types for correct capacity accounting.
- Add Another Invoice starts a fresh row with the current invoice date/schedule date.
- Batch schedule Date control keeps a visible date picker area and glass styling.
- Batch invoice cards received stronger glassmorphism styling.
- Fleet Database keeps one pallet capacity field, explicitly labeled Total Big Pallet Capacity (Big Equivalent).
- Login accounts: admin / 0000 (admin role) and user / 0000 (user role).
- Admin navigation/settings are shown only when the active session role is admin.

Build note: dependency installation was unavailable in the sandbox due to network timeout, so a full npm/vite production build was not completed here.
