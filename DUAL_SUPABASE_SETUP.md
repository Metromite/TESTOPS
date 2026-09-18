# DispatchOPS — Dual Supabase Federation

This build connects DispatchOPS to two Supabase projects as one logical data source.

- Primary: `chrokbnrlvrfejckmzuz`
- Secondary: `vyqyrcqrdsyrxywglqbh`
- Primary Storage threshold: 85%
- New imports are kept whole in one project so batch/fact relationships never cross databases.
- Dashboard/SAP/Fleet/V-Zone reads are federated across both projects.
- V-Zone analytics no longer restricts itself to the latest import batch.
- Dashboard filter options no longer use the primary-only aggregate RPC.
- Realtime subscriptions are attached to both projects.
- Fleet/master-data writes are mirrored to both projects.
- Shared configuration/master data is bootstrapped from Primary to Secondary on app startup.
- AI provider secrets are not copied between projects.

The existing Primary database and historical fact data are not deleted or moved.
