import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./fonts.css";
import "./theme/fonts-extra.css";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/game.css";
import "./theme/summon.css";
import "./theme/gallery.css";
import "./theme/canvas.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
