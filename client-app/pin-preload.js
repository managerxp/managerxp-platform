/* ==========================================================================
   Staff PIN prompt — bridge

   Its own preload rather than the client's, and deliberately tiny: this
   window sits over a kiosk a customer is sitting at, so the only things it
   can do are offer four digits for checking and ask to be closed.

   The PIN itself never crosses this boundary. `try` sends what was typed and
   gets back a yes or no; the main process holds the real value and does the
   comparison.
   ========================================================================== */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("staffPin", {
  try: (pin) => ipcRenderer.invoke("staff-pin:try", String(pin || "")),
  cancel: () => ipcRenderer.send("staff-pin:cancel")
});
