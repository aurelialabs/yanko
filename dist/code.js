"use strict";
(() => {
  // src/main.ts
  figma.showUI(__html__, { width: 360, height: 560 });
  figma.ui.onmessage = (message) => {
    if (message.type === "PING") {
      figma.ui.postMessage({ type: "READY" });
    }
  };
})();
