(function () {
  const config = window.HYDROHELP_FIREBASE_CONFIG;

  if (!config || !config.apiKey || config.apiKey.startsWith("YOUR_")) {
    window.dispatchEvent(new CustomEvent("hydrohelp-firebase-status", { detail: { connected: false, label: "Configuration required" } }));
    return;
  }

  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK not loaded, running in preview mode.");
    window.dispatchEvent(new CustomEvent("hydrohelp-firebase-status", { detail: { connected: false, label: "SDK offline" } }));
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    const database = firebase.database();

    window.HydroHelpFirebase = {
      start(handlers) {
        database.ref(".info/connected").on("value", (snapshot) => {
          const connected = snapshot.val() === true;
          handlers.connection?.(connected);
        });
        database.ref("trays").on("value", (snapshot) => handlers.trays?.(snapshot.val() || {}));
        database.ref("farm_config").on("value", (snapshot) => handlers.farm?.(snapshot.val() || {}));
        database.ref("activity").on("value", (snapshot) => handlers.activity?.(snapshot.val() || {}));
      },
      async command(payload) {
        const command = {
          ...payload,
          command_id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : ("cmd-" + Date.now() + "-" + Math.floor(Math.random() * 1000)),
          issued_at: Date.now(),
          status: "QUEUED"
        };
        await database.ref("robot_command").set(command);
        await database.ref("activity").push({
          source: "Web portal",
          message: `Command queued: ${command.action}`,
          status: "QUEUED",
          timestamp: Date.now()
        });
        return command;
      },
      updateTray(trayId, values) {
        return database.ref(`trays/${trayId}`).update(values);
      }
    };

    window.dispatchEvent(new Event("hydrohelp-firebase-ready"));
  } catch (err) {
    console.error("Firebase initialization failed:", err);
    window.dispatchEvent(new CustomEvent("hydrohelp-firebase-status", { detail: { connected: false, label: "Connection error" } }));
  }
})();
