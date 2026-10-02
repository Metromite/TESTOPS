# DispatchOPS working-version patch

Base: DispatchOPS_DASHBOARD_INSTANT_LOGI_TALKING_FIX(1).zip supplied by user.

Changes in this patch only:
- Restored multiple LOGI AI providers: Groq, Ollama (local-only), Gemini, OpenAI, Claude, OpenRouter, Supabase Data Assistant.
- Preserved existing fallback provider keys when saving AI settings.
- Expanded LOGI app/domain context and live-data reasoning tools in `supabase/functions/logi-agent/index.ts`.
- Added live data snapshot, full-dataset summary tool, deeper tool loop, OpenAI/Groq/OpenRouter tool support and Claude tool support.
- Restored explicit React-driven LOGI mouth animation using existing `logi-idle.png` and `logi-active.png` in the chat.
- Fixed Dashboard analytics SAP/GPS reads to paginate beyond Supabase's first response page.
- Driver Performance now matches VZone to SAP by vehicle_key first, manual mapping second, then driver name fallback.
- GPS analytics use the latest completed Landmark/VZone import batch to prevent old uploads mixing into current results.
- Diagnostics now paginates SAP/GPS data and checks all vehicle keys, fixing the false full standalone-mode warning.
- App title changed to bold white `DISPATCH OPS` next to the app icon.

Live verification on 2026-09-03:
- Latest Landmark/VZone upload: Landmark AUG 2026.xlsx
- Parsed GPS facts: 81,567
- Distinct GPS driver names: 40
- Distinct GPS vehicle keys: 44
- SAP vehicle keys: 43
- Matching SAP/GPS vehicle keys: 40

Build note: native Windows EXE is not compiled in this Linux environment. `npm ci` timed out, so a full frontend build could not be completed here. Static TypeScript checking of changed frontend files showed no syntax-class errors; dependency-resolution errors are expected without node_modules.

## Driver Performance chart grouping fix
- Stops per Driver and Route Duration (hrs) charts are grouped by resolved Driver Name, not vehicle.
- A driver using multiple vehicles is shown once; all vehicle stop counts and route-duration hours are aggregated into that driver.
- Route Detail remains vehicle-level so no audit/detail functionality is lost.
- Native `_hours` is retained in route-card payload for correct client-side Primary + Secondary merging.
