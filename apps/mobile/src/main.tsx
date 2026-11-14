import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Station } from "./station/Station";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.startsWith("/station") ? <Station /> : <App />}
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
