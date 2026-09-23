/// <reference types="vite/client" />

// Typed shape of the env vars this app actually reads (see
// src/lib/supabase.ts). Vite only exposes VITE_-prefixed vars to client
// code; extending ImportMetaEnv here is the normal Vite mechanism for
// getting typed, autocompleted import.meta.env access instead of the
// default "ImportMeta has no property 'env'" error.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
