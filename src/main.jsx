import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { loadSavedLocale } from "./i18n.js";
import { loadUiState } from "./ui-state.js";
import "./fonts.css";
import "./theme/fonts-extra.css";
import "./theme/fonts-ja.css";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/game.css";
import "./theme/summon.css";
import "./theme/gallery.css";
import "./theme/canvas.css";

// 先讀本機核心記的介面語言與畫面狀態（節點位置、偏好、上次的角色）再畫面，避免一開啟就閃過另一種語言或跳回預設。
Promise.allSettled([loadSavedLocale(), loadUiState()]).finally(() => createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
