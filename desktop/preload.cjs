const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mxPageDesktop", {
  runtime: "desktop",
});
