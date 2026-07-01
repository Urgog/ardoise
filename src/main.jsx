import React from "react";
import ReactDOM from "react-dom/client";
import Ardoise from "./Ardoise.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Ardoise />
  </React.StrictMode>
);

// PWA : enregistre le service worker (installable + hors-ligne)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {});
  });
}
