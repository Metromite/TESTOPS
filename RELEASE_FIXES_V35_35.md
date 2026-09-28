# DispatchOPS V35.35

## Bulk Organizer
- Big and Small quantities can be entered together on the same invoice.
- Standard conversion: 1 Big = 1.5 Small; 1 Small = 2/3 Big-equivalent.
- Invoice stores big_pallets, small_pallets, pallet_types and total physical pallets.
- Vehicle capacity/load calculations use Big-equivalent units.
- Loaded mixed invoices calculate actual assigned pallet types instead of treating all pallets as one type.

## Login
- admin / 0000 => admin role
- user / user12345 => user role
- Admin navigation/settings are restricted by role.

## Price Change Portal
- Driver payload now includes only OPEN lists with an active assignment for that driver.
- Admin can hide/show an existing driver assignment without deleting the assignment or submissions.
- Existing entry/submission RPC flow is preserved.

## Price Change ZIP export
- Browser download keeps the existing export mechanism but delays object URL revocation to avoid first-click failures.
- ZIP extraction layout is now:
  <ListName>/
    <ListName>.xlsx
    <ListName>_Attachments/
      photos/signatures...
- Excel relative links continue to point to the attachment folder.
