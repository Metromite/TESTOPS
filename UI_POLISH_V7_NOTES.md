# DispatchOPS UI Polish V7

## Changes
- Predictive autocomplete dropdowns now render through a document-body portal with fixed positioning, so table/parent stacking contexts cannot paint them underneath tables.
- Dashboard Excel Export menu now uses a more opaque frosted-glass surface while retaining blur/saturation and the existing top stacking behavior.
- Route Planning active tab pill now has a first-mount slide/scale entrance while retaining the shared Framer Motion layoutId for subsequent tab-to-tab sliding.
- Added admin-only Page Visibility controls using the existing `feature_flags` table. No new schema/table was added.
- Route Intelligence and Control Center are hidden by default for non-admin users as requested. Admin can Show/Hide any listed operational page at any time.
- Hidden pages are removed from navigation and blocked for normal users if reached directly. Admin users can still access them.
- LOGI now has direct live-data answers for best driver/helper requests using route assignment scores when populated, with workload fallback when scores are unavailable.
- LOGI provider prompt now explicitly prevents planning narration, "hold on", waiting messages, and internal reasoning exposure; conversation history is forwarded to the provider.
- Existing LOGI provider/fallback architecture and confirmed write flow are retained.
- Existing Bulk Organizer data logic was not changed.
