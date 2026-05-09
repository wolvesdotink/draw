import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { osPlatform } from "./lib/platform";
import { DialogProvider } from "./hooks/useDialog";

// Add a `platform-<os>` body class so CSS can target iOS / macOS / other
// without React having to plumb the platform through every component.
// Set once at boot — the OS doesn't change at runtime.
document.body.classList.add(`platform-${osPlatform()}`);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </React.StrictMode>,
);
