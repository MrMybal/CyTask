import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CyAnnota from "./CyAnnota";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CyAnnota />
  </StrictMode>
);