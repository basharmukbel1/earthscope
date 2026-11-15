/* Standalone QA harness for the chart kit (dev only). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "../../../styles/globals.css";
import ChartGallery from "./ChartGallery";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChartGallery />
  </StrictMode>,
);
