figma.showUI(__html__, { width: 360, height: 560 });

figma.ui.onmessage = (message: { type: string }) => {
  if (message.type === "PING") {
    figma.ui.postMessage({ type: "READY" });
  }
};
