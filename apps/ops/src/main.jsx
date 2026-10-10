import React from "react";
import { createRoot } from "react-dom/client";
import { applyBrand } from "@nova/shared";
import App from "./App";
import "./index.css";

applyBrand({}); // the console always wears Nova's own colours
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
