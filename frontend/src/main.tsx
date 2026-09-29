import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// PERMANENT ARCHITECTURE: unlike the old apiFetch/BASE setup, the
// Supabase client (src/lib/supabase.ts) needs no async initialization
// step before the app can render - it's a synchronous client
// construction, and it never blocks or throws if the network/Supabase
// project happens to be unreachable at this moment (see
// useConnectionStatus.ts for how that's surfaced instead). The app
// shell renders immediately.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
