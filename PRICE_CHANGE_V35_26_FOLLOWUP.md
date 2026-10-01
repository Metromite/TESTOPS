# Price Change Portal follow-up

- Added persistent `price_change_default_areas` master list.
- Existing active campaign areas are seeded into the master list once, so configured areas survive deletion of every campaign/list.
- Creating a genuinely new Price Change list automatically copies the master defaults into that list.
- Editing/removing an area inside one list remains list-local and does not erase the master defaults.
- Admin data now returns `campaign_areas`, which fixes the frontend area dropdown/data mismatch.
- Evidence viewer uses the app's Level-3 glass modal at a wide desktop size with non-nested glass panes.
- Top navigation dropdown triggers expose `aria-expanded`, so active/open trigger icons use the same white active color as their labels; dropdown active-item icons also use white.
