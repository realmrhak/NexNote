import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// VERSION MARKER: If you're debugging, check the browser console for this log.
// It tells you which version of the code is actually running. If you don't see
// "Round 6" here, your browser is caching an old build — do a hard refresh
// (Ctrl+Shift+R / Cmd+Shift+R) or clear the browser cache.
console.log(
  "%c🔧 NexNote Frontend v5.1 (Round 6 — Todo form CSS fix + socket URL fix)",
  "color: #2383E2; font-weight: bold; font-size: 13px;"
);
console.log("Build date:", "2026-06-18 Round 6");
console.log("VITE_API_URL:", import.meta.env.VITE_API_URL || "(empty — using Vite proxy)");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
