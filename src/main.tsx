import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/AppV3";
import "./app/v3.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
