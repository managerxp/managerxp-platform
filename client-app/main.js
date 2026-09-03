const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut, shell } = require("electron");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const { exec,spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const telemetry = require("./telemetry");
const updater = require("./updater");

// .env is optional — a fresh checkout or a machine where it was never copied
// still runs on the defaults below, exactly as it did before this existed.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch (e) { /* no .env on this machine */ }

let SIM_ID = "SIM-01"; // Will be updated by server
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 9090; // Port this client listens on
const SERVER_APP_PORT = Number(process.env.SERVER_APP_PORT) || 3334; // Server app HTTP port for discovery
let LOCAL_IP = null; // Will be set on startup
let BROADCAST_INTERVAL = null; // For periodic IP/MAC broadcasts
let TELEMETRY_INTERVAL = null; // Hardware sampling loop, started once registered
let telemetryIntervalSeconds = 15; // Overridden by the console's TELEMETRY_CONFIG

let win;

/* Set only by the deliberate quit paths — a remote restart-client, or the app
   shutting itself down. Everything else that asks the kiosk window to close
   is refused. */
let allowQuit = false;

/* Whether the kiosk is currently sealed. True in normal trading; dropped only
   by staff at the station using Ctrl+Alt+Shift+Q with the café's PIN. While it
   is false the window behaves like an ordinary one — the point of unlocking is
   that staff can actually use the machine.

   A console-driven minimise deliberately leaves this true: that is a window
   moved aside, not a station unlocked, so clicking it in the task bar seals
   it straight back to full screen. */
let kioskLocked = true;

/*
 * Windows keyboard guard.
 *
 * Electron's before-input-event cannot see shell-level shortcuts such as
 * Alt+Tab or the Windows key. This low-level WH_KEYBOARD_LL hook runs before
 * those shortcuts reach the Windows shell and swallows the escape keys while
 * CafeXP is locked.
 *
 * Ctrl+Alt+Shift+Q is deliberately allowed so the staff hatch still works.
 * Ctrl+Alt+Delete and Win+L are Windows secure/system shortcuts and cannot be
 * intercepted reliably by a normal desktop application.
 */
let windowsKioskGuard = null;
let windowsKioskGuardStarting = false;

const WINDOWS_KIOSK_GUARD_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class CafeXPKbdGuard {
    private const int WH_KEYBOARD_LL = 13;

    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_TAB = 0x09;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_F4 = 0x73;
    private const int VK_F11 = 0x7A;
    private const int VK_F12 = 0x7B;
    private const int VK_Q = 0x51;
    private const int VK_D = 0x44;
    private const int VK_E = 0x45;
    private const int VK_R = 0x52;
    private const int VK_X = 0x58;

    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_SHIFT = 0x10;

    private delegate IntPtr LowLevelKeyboardProc(
        int nCode,
        IntPtr wParam,
        IntPtr lParam
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(
        int idHook,
        LowLevelKeyboardProc lpfn,
        IntPtr hMod,
        uint dwThreadId
    );

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr CallNextHookEx(
        IntPtr hhk,
        int nCode,
        IntPtr wParam,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern int GetMessage(
        out MSG lpMsg,
        IntPtr hWnd,
        uint wMsgFilterMin,
        uint wMsgFilterMax
    );

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    private static IntPtr hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc proc = HookCallback;

    private static bool IsDown(int vk) {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    private static bool IsKeyMessage(IntPtr wParam) {
        int msg = wParam.ToInt32();

        return msg == WM_KEYDOWN ||
               msg == WM_SYSKEYDOWN ||
               msg == WM_KEYUP ||
               msg == WM_SYSKEYUP;
    }

    private static bool IsBlockedShortcut(int vk) {
        bool ctrl = IsDown(VK_CONTROL);
        bool alt = IsDown(VK_MENU);
        bool shift = IsDown(VK_SHIFT);

        // Always block the Windows keys while kiosk is active.
        if (vk == VK_LWIN || vk == VK_RWIN)
            return true;

        // F11/F12
        if (vk == VK_F11 || vk == VK_F12)
            return true;

        // Alt+Tab
        if (alt && vk == VK_TAB)
            return true;

        // Alt+F4
        if (alt && vk == VK_F4)
            return true;

        // Alt+Escape
        if (alt && vk == VK_ESCAPE)
            return true;

        // Ctrl+Escape
        if (ctrl && vk == VK_ESCAPE)
            return true;

        // Ctrl+Shift+Escape
        if (ctrl && shift && vk == VK_ESCAPE)
            return true;

        // Windows shortcuts
        if ((IsDown(VK_LWIN) || IsDown(VK_RWIN))) {
            if (vk == VK_D ||
                vk == VK_E ||
                vk == VK_R ||
                vk == VK_TAB ||
                vk == VK_X) {
                return true;
            }
        }

        return false;
    }

    private static IntPtr HookCallback(
        int nCode,
        IntPtr wParam,
        IntPtr lParam
    ) {
        if (nCode >= 0 && IsKeyMessage(wParam)) {
            KBDLLHOOKSTRUCT data =
                Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);

            int vk = (int)data.vkCode;

            // Allow the staff escape shortcut:
            // Ctrl+Alt+Shift+Q
            //
            // Q must pass through to Electron's globalShortcut.
            if (vk == VK_Q &&
                IsDown(VK_CONTROL) &&
                IsDown(VK_MENU) &&
                IsDown(VK_SHIFT)) {
                return CallNextHookEx(hookId, nCode, wParam, lParam);
            }

            if (IsBlockedShortcut(vk)) {
                return (IntPtr)1;
            }
        }

        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    public static void Run() {
        using (Process current = Process.GetCurrentProcess()) {
            using (ProcessModule module = current.MainModule) {
                hookId = SetWindowsHookEx(
                    WH_KEYBOARD_LL,
                    proc,
                    GetModuleHandle(module.ModuleName),
                    0
                );
            }
        }

        if (hookId == IntPtr.Zero)
            throw new Exception("SetWindowsHookEx failed.");

        MSG msg;

        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0) {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}
'@

[Console]::WriteLine("CafeXP keyboard guard started")
[CafeXPKbdGuard]::Run()
`;

function startWindowsKioskGuard() {
    if (process.platform !== "win32")
        return;

    if (windowsKioskGuard)
        return;

    if (windowsKioskGuardStarting)
        return;

    windowsKioskGuardStarting = true;

    try {
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                WINDOWS_KIOSK_GUARD_SCRIPT
            ],
            {
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        windowsKioskGuard = child;

        child.stdout.on("data", data => {
            console.log("[Kiosk] Windows keyboard guard:", data.toString().trim());
        });

        child.stderr.on("data", data => {
            console.error("[Kiosk] Windows keyboard guard error:", data.toString().trim());
        });

        child.on("error", error => {
            console.error("[Kiosk] Failed to start Windows keyboard guard:", error);
            windowsKioskGuard = null;
            windowsKioskGuardStarting = false;
        });

        child.on("exit", (code, signal) => {
            console.log(
                `[Kiosk] Windows keyboard guard exited (code=${code}, signal=${signal})`
            );

            windowsKioskGuard = null;
            windowsKioskGuardStarting = false;

            // Restart automatically if kiosk protection is still required.
            if (kioskLocked) {
                setTimeout(() => {
                    if (kioskLocked && !windowsKioskGuard) {
                        startWindowsKioskGuard();
                    }
                }, 500);
            }
        });

        windowsKioskGuardStarting = false;

    } catch (error) {
        windowsKioskGuardStarting = false;
        windowsKioskGuard = null;

        console.error(
            "[Kiosk] Failed to start Windows keyboard guard:",
            error
        );
    }
}

function stopWindowsKeyboardBlocker() {
    if (!windowsKioskGuard)
        return;

    try {
        windowsKioskGuard.kill();
    } catch (error) {
        console.warn(
            "[Kiosk] Could not stop Windows keyboard guard:",
            error
        );
    }

    windowsKioskGuard = null;
    windowsKioskGuardStarting = false;
}

function syncWindowsKeyboardBlocker() {
    if (process.platform !== "win32")
        return;

    if (kioskLocked) {
        startWindowsKioskGuard();
    } else {
        stopWindowsKeyboardBlocker();
    }
}

/*
 * The café's staff-unlock PIN, pushed by the console when this station
 * registers and cached on disk.
 *
 * Cached because the hatch it guards is for the case the console cannot be
 * reached — a PIN only held in memory would be gone after the restart that
 * often accompanies exactly that situation. Empty means no PIN has been set,
 * and the hatch is refused rather than left open: a station that unlocks
 * without a PIN is a station every customer can unlock.
 */
let staffUnlockPin = "";

const unlockPinFile = () => path.join(app.getPath("userData"), "station-config.json");

function loadUnlockPin() {
  try {
    const raw = fs.readFileSync(unlockPinFile(), "utf8");
    const parsed = JSON.parse(raw);
    staffUnlockPin = typeof parsed.staffUnlockPin === "string" ? parsed.staffUnlockPin : "";
  } catch (e) {
    staffUnlockPin = "";   // never configured, or unreadable — treat as unset
  }
}

function persistUnlockPin(pin) {
  try {
    fs.writeFileSync(unlockPinFile(), JSON.stringify({ staffUnlockPin: pin }), "utf8");
  } catch (e) {
    log(`Could not cache the staff unlock PIN: ${e.message}`);
  }
}
let timerCardWin;
let wss; // WebSocket server instance (client listens)
let serverConnection; // Connection from server
let runningProcesses = new Map(); // appName -> { pid, appPath, timerCardWin }
let cancelledLaunches = new Set(); // appName -> customer closed the loading screen before a PID existed yet
let cachedApps = null; // Cache for installed apps
let lastAppsCacheTime = 0;
const APPS_CACHE_DURATION = 5000; // Cache for 5 seconds to avoid duplicate PowerShell calls
let userToken = null; // Store user authentication token
let userInfo = null; // Store authenticated user profile
let currentPage = 'welcome'; // Track current page
let currentStatus = 'DISCONNECTED'; // Track current connection status
let currentSession = null; // Session pushed by the admin console, for display
// session_id of the last session that actually got a game running. Compared
// against currentSession.session_id to tell "nobody has played a second of
// this session yet" apart from "staff are replaying/switching mid-session" —
// see reportLaunchFailedIfSessionStart below.
let sessionGameConfirmed = null;
let currentGames = [];     // Games this station may offer, pushed by the console
let pendingSelfStartGame = null; // The title chosen when self-starting, launched once the session actually begins

/*
 * Where the backend API lives.
 *
 * Defaults to this station's own machine, which is correct exactly when the
 * console and the backend also run here — the everyday single-machine dev
 * setup, unchanged. The console corrects this to its own real address the
 * moment it connects (see the SET_NAME handler below), which is what makes a
 * station on a second machine able to reach a backend on the first.
 */
let BACKEND_BASE = process.env.BACKEND_BASE || "http://localhost:5000";

/*
 * One adapter per platform, each turning a platform configuration from
 * ManagerXP's catalog into a concrete way to start the game — a URL protocol
 * hand-off where the store has one and owns the sign-in, or a direct
 * executable where it does not.
 *
 * The fields come straight off a `game_platforms` row:
 *   platform          which store this configuration is for
 *   platform_game_id  its id there (Steam appid, Epic namespace id, …)
 *   launch_target     the executable/command, for platforms with no protocol
 *   launch_arguments  appended when launching by executable
 *
 * `launch_method` is carried too but is deliberately NOT what dispatches
 * here: the platform already determines its own protocol, and having two
 * fields that can disagree about how to start the same game is a bug waiting
 * to happen. It is stored for display and for a future platform whose launch
 * genuinely varies per title.
 *
 * Adding a store CafeXP has never seen means adding one entry here — the
 * database, the café side and the session flow need no change at all, which
 * is the modularity the architecture asks for.
 */
const LAUNCHER_ADAPTERS = {
  Steam:      { launch: (id) => id && { url: `steam://rungameid/${id}` } },
  Epic:       { launch: (id) => id && { url: `com.epicgames.launcher://apps/${id}?action=launch&silent=true` } },
  EA:         { launch: (id) => id && { url: `origin2://game/launch?offerIds=${id}` } },
  Ubisoft:    { launch: (id) => id && { url: `uplay://launch/${id}/0` } },
  'Battle.net': { launch: (id) => id && { url: `battlenet://${id}` } },
  Riot:       { launch: () => null },
  Rockstar:   { launch: () => null },
  Custom:     { launch: () => null }
};

/*
 * Resolve a game to a launch plan. The store's protocol wins when it has one
 * and the title carries an id there; every platform — including Riot,
 * Rockstar and Custom, which have no useful public protocol — falls back to
 * running `launch_target` directly. Returns null when there is nothing to
 * launch with, so the caller can say so rather than run "".
 */
function buildGameLaunch(game) {
  const id = game.platform_game_id ? String(game.platform_game_id).trim() : '';
  const exe = game.launch_target ? String(game.launch_target).trim() : '';
  const adapter = LAUNCHER_ADAPTERS[game.platform];
  const plan = adapter && adapter.launch(id);
  if (plan) return plan;
  if (exe) return { exe };
  return null;
}

/*
 * Launch a game the customer chose, through its launcher.
 *
 * CafeXP hands off and steps back: it starts the launcher, the customer signs
 * into their own account. No credential is stored, passed, or logged here.
 *
 * Shared by the "Play" button (the `launch-game` IPC channel) and the
 * self-service start flow, which launches the customer's chosen title itself
 * the moment their session actually begins — one launch path, however it was
 * reached, which is why this lives at module scope rather than nested inside
 * `createWindow` where only the IPC handler could see it.
 */
/*
 * A failure only reports up to the console — see the LAUNCH_FAILED send below,
 * which the console reads as "cancel the session" — when nobody has played a
 * second of the CURRENT session yet. That covers both a self-started session's
 * very first launch and a staff-started session's first launch, however the
 * launch was reached. Staff manually replaying a title mid-session (real play
 * time has already elapsed), or free play with no session at all, must not
 * have a launch hiccup wipe out billing that already happened.
 */
function isFirstLaunchForSession() {
  const sessionId = currentSession && currentSession.session_id;
  return !!sessionId && sessionGameConfirmed !== sessionId;
}

function reportLaunchFailedIfSessionStart(game, isSessionStart, error) {
  if (!isSessionStart || !serverConnection || serverConnection.readyState !== WebSocket.OPEN) return;
  serverConnection.send(JSON.stringify({ type: 'LAUNCH_FAILED', simId: SIM_ID, appName: game.name, error }));
}

function markSessionGameConfirmed() {
  const sessionId = currentSession && currentSession.session_id;
  if (sessionId) sessionGameConfirmed = sessionId;
}

function launchGame(game) {
  if (!game || typeof game !== 'object') return;
  // A fresh attempt at the same title supersedes any earlier cancel.
  cancelledLaunches.delete(game.name);
  const isSessionStart = isFirstLaunchForSession();
  const plan = buildGameLaunch(game);
  if (!plan) {
    log(`No launch config for ${game.name}`);
    const error = 'This game has no launch configuration yet.';
    sendToWindow(win, 'app-launch-failed', { appName: game.name, error });
    reportLaunchFailedIfSessionStart(game, isSessionStart, error);
    return;
  }

  sendToWindow(win, 'app-launching', { appName: game.name });
  log(`Launching ${game.name} via ${game.platform}${plan.url ? ' (protocol)' : ' (exe)'}`);

  if (plan.url) {
    // Protocol hand-off to the launcher. openExternal resolves once the OS
    // has accepted the URL, not when the game is up — which is all we need.
    const openGame = () => shell.openExternal(plan.url).then(() => {
      markSessionGameConfirmed();
      // Nothing to poll for a protocol hand-off (there is no PID to watch),
      // so this is the only launched signal it ever gets — without it the
      // "Getting your game ready…" overlay has nothing to close it.
      sendToWindow(win, 'app-launched', { appName: game.name });
    }).catch((err) => {
      log(`Launch failed for ${game.name}: ${err.message}`);
      const error = 'Could not reach the launcher.';
      sendToWindow(win, 'app-launch-failed', { appName: game.name, error });
      reportLaunchFailedIfSessionStart(game, isSessionStart, error);
    });

    // A venue account reserved for this session — sign Steam into it first,
    // best-effort, before handing off to the game itself.
    const credential = game.platform === 'Steam' && currentSession && currentSession.account_credential;
    if (credential) {
      ensureSteamSignedIn(credential).then(openGame);
    } else {
      openGame();
    }
  } else if (plan.exe) {
    const cmd = game.launch_arguments ? `"${plan.exe}" ${game.launch_arguments}` : `"${plan.exe}"`;
    const child = exec(cmd, (err) => {
      if (err) {
        log(`Launch failed for ${game.name}: ${err.message}`);
        const error = 'The game could not be started.';
        sendToWindow(win, 'app-launch-failed', { appName: game.name, error });
        reportLaunchFailedIfSessionStart(game, isSessionStart, error);
      }
    });
    // Track the process under the game's name so the existing close path can
    // find it, and attach a timer card if the session is timed.
    if (child.pid) {
      if (cancelledLaunches.delete(game.name)) {
        // The customer closed the loading screen before this PID existed —
        // it just arrived too late to catch. Kill it rather than leave it
        // running unseen, with no timer card and nothing tracking it.
        log(`${game.name} launched after being cancelled — closing it`);
        exec(`taskkill /F /PID ${child.pid} /T`, { windowsHide: true, timeout: 10000 });
        return;
      }
      markSessionGameConfirmed();
      sendToWindow(win, 'app-launched', { appName: game.name });
      const info = { pid: child.pid, appPath: plan.exe, timerCardWin: null };
      const mins = sessionRemainingMinutes();
      if (mins > 0) info.timerCardWin = createTimerCard(game.name, mins, sessionBufferRemainingSeconds());
      runningProcesses.set(game.name, info);
    }
  }
}

/** Whole minutes left on the current session, or 0 if it is open-ended. */
function sessionRemainingMinutes() {
  if (!currentSession || currentSession.remaining_seconds == null) return 0;
  return Math.max(0, Math.floor(Number(currentSession.remaining_seconds) / 60));
}

/*
 * How much of the café's start-of-session load buffer is still left, right
 * now — so a game launched partway through it doesn't start ticking down
 * again from zero. The server already holds elapsed/remaining at their full
 * starting value for the whole buffer, but that alone can't tell a station
 * "1 minute of a 5-minute buffer used" from "4 minutes used": both read as
 * zero elapsed. Recomputing from the session's own started_at and the grace
 * length the server sent is what actually answers that.
 */
function sessionBufferRemainingSeconds() {
  if (!currentSession || !currentSession.started_at || !currentSession.grace_seconds) return 0;
  const elapsedMs = Date.now() - new Date(currentSession.started_at).getTime();
  return Math.max(0, currentSession.grace_seconds - Math.floor(elapsedMs / 1000));
}

/* ==========================================================================
   LAUNCHER DETECTION

   Which game launchers this machine actually has. The console shows it against
   each station ("Steam ✓ Riot ✓"), so staff can see at a glance why a title
   will not start on PC-07 before a customer discovers it.

   Deliberately a filesystem check rather than the installed-apps PowerShell
   scan: that scan takes tens of seconds and is cached for minutes, while this
   is a handful of existsSync calls and can run on every connect. A launcher
   installed somewhere unusual is caught by the registry fallback below.
   ========================================================================== */
const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files';
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL_APPDATA = process.env['LOCALAPPDATA'] || '';

/* Candidate executables per launcher, most likely first. The first that exists
   wins and its folder is reported, which is also what an operator needs when
   filling in a game's executable path. */
const LAUNCHER_PATHS = {
  Steam: [
    path.join(PROGRAM_FILES_X86, 'Steam', 'steam.exe'),
    path.join(PROGRAM_FILES, 'Steam', 'steam.exe')
  ],
  Riot: [
    path.join(PROGRAM_FILES, 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
    path.join(PROGRAM_FILES_X86, 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
    'C:\\Riot Games\\Riot Client\\RiotClientServices.exe'
  ],
  EA: [
    path.join(PROGRAM_FILES, 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe'),
    path.join(PROGRAM_FILES_X86, 'Origin', 'Origin.exe')
  ],
  Epic: [
    path.join(PROGRAM_FILES_X86, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win32', 'EpicGamesLauncher.exe'),
    path.join(PROGRAM_FILES, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe')
  ],
  Ubisoft: [
    path.join(PROGRAM_FILES_X86, 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe'),
    path.join(PROGRAM_FILES, 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe')
  ],
  'Battle.net': [
    path.join(PROGRAM_FILES_X86, 'Battle.net', 'Battle.net.exe'),
    path.join(PROGRAM_FILES, 'Battle.net', 'Battle.net.exe')
  ],
  Rockstar: [
    path.join(PROGRAM_FILES, 'Rockstar Games', 'Launcher', 'Launcher.exe'),
    path.join(PROGRAM_FILES_X86, 'Rockstar Games', 'Launcher', 'Launcher.exe')
  ]
};

/* For the launchers people most often move to another drive, the registry
   knows where they went. Only consulted when no known path matched. */
const LAUNCHER_REGISTRY = {
  Steam: { key: 'HKCU\\Software\\Valve\\Steam', value: 'SteamPath', exe: 'steam.exe' },
  Epic: { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher', value: 'AppDataPath', exe: null }
};

/** Ask the Windows registry for one value. Resolves null on any failure. */
function readRegistry(key, value) {
  return new Promise((resolve) => {
    exec(`reg query "${key}" /v ${value}`, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // "    SteamPath    REG_SZ    C:/Program Files (x86)/Steam"
      const m = stdout.match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)'));
      resolve(m ? m[1].trim() : null);
    });
  });
}

/**
 * What launchers are on this machine.
 * Returns { Steam: { installed, path }, Riot: {...}, ... } for every known
 * launcher — including the absent ones, so the console can show "not
 * installed" rather than an ambiguous blank.
 */
async function detectLaunchers() {
  const result = {};

  for (const [name, candidates] of Object.entries(LAUNCHER_PATHS)) {
    let found = null;
    for (const candidate of candidates) {
      try {
        if (candidate && fs.existsSync(candidate)) { found = candidate; break; }
      } catch (e) { /* an unreadable path is simply not a match */ }
    }
    result[name] = { installed: !!found, path: found };
  }

  // Registry fallback for anything the known paths missed.
  for (const [name, reg] of Object.entries(LAUNCHER_REGISTRY)) {
    if (result[name] && result[name].installed) continue;
    const base = await readRegistry(reg.key, reg.value);
    if (!base) continue;
    const normalized = base.replace(/\//g, '\\');
    const exe = reg.exe ? path.join(normalized, reg.exe) : normalized;
    try {
      if (fs.existsSync(exe)) result[name] = { installed: true, path: exe };
    } catch (e) { /* ignore */ }
  }

  return result;
}

/*
 * Best-effort Steam sign-in for a venue account, ahead of the game hand-off.
 *
 * `-login <user> <pass>` is the one CLI credential mechanism Steam still
 * honours, for switching which account is signed in — it does not launch the
 * game itself, which still happens the same way it always has, via
 * steam://rungameid, once this has had a chance to finish.
 *
 * Steam Guard or any other second factor on the account defeats this
 * completely: there is no way to script past a prompt Valve deliberately
 * requires a human to answer, and this makes no attempt to. The account this
 * is meant for is the café's own, reserved for "Just Play" precisely so it
 * can be left free of that friction — the same reason a launcher already
 * signed in on the station was the alternative to this in the first place.
 */
function isSteamRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq steam.exe" /NH', { windowsHide: true }, (err, stdout) => {
      resolve(!err && !!stdout && stdout.toLowerCase().includes('steam.exe'));
    });
  });
}

function ensureSteamSignedIn(credential) {
  if (!credential || !credential.username || !credential.password) return Promise.resolve();
  return detectLaunchers().then((launchers) => {
    const steam = launchers.Steam;
    if (!steam || !steam.installed) {
      log('Steam auto sign-in skipped: Steam not found on this station');
      return;
    }
    return Promise.all([
      isSteamRunning(),
      readRegistry('HKCU\\Software\\Valve\\Steam', 'AutoLoginUser')
    ]).then(([running, autoLoginUser]) => {
      if (running && autoLoginUser && autoLoginUser.toLowerCase() === credential.username.toLowerCase()) {
        log(`Venue Steam account (${credential.username}) already signed in`);
        return;
      }
      /* Steam is single-instance: handing -login to it while a copy is
         already running — left open from the previous session, or signed
         into a different account — does nothing, because that flag only
         does anything the moment Steam itself starts. That silent no-op,
         not a config problem, is why auto sign-in previously "didn't work"
         whenever the launcher hadn't already been closed. Kill it first so
         the next launch actually starts fresh and reads these credentials. */
      const restart = running
        ? killProcess('steam.exe').then(() => killProcess('steamwebhelper.exe'))
        : Promise.resolve();
      return restart.then(() => new Promise((resolve) => {
        setTimeout(() => {
          log(`Signing in to venue Steam account (${credential.username}) before launch`);
          exec(
            `"${steam.path}" -login "${credential.username}" "${credential.password}"`,
            { windowsHide: true },
            (err) => { if (err) log(`Steam sign-in command failed: ${err.message}`); }
          );
          /* A fixed wait rather than polling for "signed in": there is no public
             signal for that which would not also fire while a Guard prompt sits
             waiting on a human, so polling could not tell the two apart anyway. */
          setTimeout(resolve, 6000);
        }, running ? 700 : 0);   // a moment for file handles to release after the kill
      }));
    });
  }).catch((e) => { log(`Steam auto sign-in error: ${e.message}`); });
}

/* ==========================================================================
   ACCOUNT CLEANUP

   What a station does when a session ends. The whole point is that the next
   customer must never reach the previous customer's Steam, Riot or EA account.

   Signing a launcher out means two things, in order: stop the launcher (its
   files are locked while it runs, and a live client would just rewrite them),
   then clear the specific artefact that remembers the login. Each recipe below
   names exact files — never a whole folder — because "delete the launcher's
   directory" is how a café ends up reinstalling Steam on forty machines.

   Every step is best-effort and independently guarded: a launcher that is not
   installed, a file that is not there, a permission that is refused, all just
   log and move on. A failed sign-out must never leave the station stuck.
   ========================================================================== */
const APPDATA = process.env['APPDATA'] || '';

/*
 * Per launcher: the processes to stop, the files whose removal forgets the
 * login, and any registry value to blank.
 *
 * `paths` are resolved lazily because some depend on where the launcher was
 * actually found (Steam's config lives beside steam.exe, which may be on D:).
 */
const SIGNOUT_RECIPES = {
  Steam: {
    processes: ['steam.exe', 'steamwebhelper.exe'],
    // loginusers.vdf holds the remembered accounts; the ssfn* files are the
    // saved second-factor tokens that let a machine skip Steam Guard.
    files: (installPath) => {
      const root = installPath ? path.dirname(installPath) : path.join(PROGRAM_FILES_X86, 'Steam');
      return [path.join(root, 'config', 'loginusers.vdf')];
    },
    registry: [{ key: 'HKCU\\Software\\Valve\\Steam', value: 'AutoLoginUser' }]
  },
  Riot: {
    processes: ['RiotClientServices.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe'],
    files: () => (LOCAL_APPDATA
      ? [path.join(LOCAL_APPDATA, 'Riot Games', 'Riot Client', 'Data', 'RiotGamesPrivateSettings.yaml')]
      : [])
  },
  EA: {
    processes: ['EADesktop.exe', 'EABackgroundService.exe', 'Origin.exe'],
    files: () => (LOCAL_APPDATA
      ? [path.join(LOCAL_APPDATA, 'Electronic Arts', 'EA Desktop', 'cookiejar')]
      : [])
  },
  Epic: {
    processes: ['EpicGamesLauncher.exe', 'EpicWebHelper.exe'],
    files: () => (LOCAL_APPDATA
      ? [path.join(LOCAL_APPDATA, 'EpicGamesLauncher', 'Saved', 'Config', 'Windows', 'GameUserSettings.ini')]
      : [])
  },
  Ubisoft: {
    processes: ['upc.exe', 'UbisoftConnect.exe'],
    files: () => (LOCAL_APPDATA
      ? [path.join(LOCAL_APPDATA, 'Ubisoft Game Launcher', 'user.dat')]
      : [])
  },
  'Battle.net': {
    processes: ['Battle.net.exe', 'Agent.exe'],
    files: () => (APPDATA ? [path.join(APPDATA, 'Battle.net', 'Battle.net.config')] : [])
  },
  Rockstar: {
    processes: ['Launcher.exe', 'RockstarService.exe'],
    files: () => (LOCAL_APPDATA
      ? [path.join(LOCAL_APPDATA, 'Rockstar Games', 'Launcher', 'settings_user.dat')]
      : [])
  }
};

/** taskkill one image name. Resolves either way — "not running" is a success. */
function killProcess(imageName) {
  return new Promise((resolve) => {
    exec(`taskkill /F /IM "${imageName}" /T`, { windowsHide: true, timeout: 10000 }, () => resolve());
  });
}

/** Remove one file if it is there. Never throws. */
function removeIfPresent(file) {
  try {
    if (file && fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      log(`  cleared ${file}`);
      return true;
    }
  } catch (e) {
    log(`  could not clear ${file}: ${e.message}`);
  }
  return false;
}

/** Blank a registry value (used to forget Steam's auto-login user). */
function blankRegistryValue(key, value) {
  return new Promise((resolve) => {
    exec(`reg add "${key}" /v ${value} /t REG_SZ /d "" /f`,
      { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}

/**
 * Sign one launcher out on this machine.
 * Stops it first, then clears what remembers the account.
 */
async function signOutLauncher(name, installPath) {
  const recipe = SIGNOUT_RECIPES[name];
  if (!recipe) return;
  log(`Signing out ${name}…`);

  for (const proc of recipe.processes) await killProcess(proc);
  // A moment for file handles to be released after the kill.
  await new Promise((r) => setTimeout(r, 700));

  let files = [];
  try { files = recipe.files(installPath) || []; } catch (e) { files = []; }
  files.forEach(removeIfPresent);

  for (const reg of (recipe.registry || [])) await blankRegistryValue(reg.key, reg.value);
}

/**
 * Run the café's end-of-session cleanup on this station.
 *
 * `config` is the café's session.cleanup setting; `games` are the titles that
 * were running, so their processes can be stopped by name.
 */
async function runSessionCleanup(config, games) {
  const cfg = config || {};
  log('Session cleanup starting…');

  /* 1. The game itself. Process names come from the library, so a title whose
        window name differs from its executable is still caught. */
  if (cfg.close_game !== false) {
    const names = new Set();
    (games || []).forEach((g) => { if (g && g.process_name) names.add(g.process_name); });
    runningProcesses.forEach((info, appName) => {
      if (info && info.appPath) names.add(path.basename(info.appPath));
      else if (appName) names.add(appName.endsWith('.exe') ? appName : `${appName}.exe`);
    });
    for (const n of names) await killProcess(n);
    // Close any timer cards the launches left behind.
    const hadRunning = runningProcesses.size > 0;
    runningProcesses.forEach((info) => {
      if (info.timerCardWin && !info.timerCardWin.isDestroyed()) info.timerCardWin.close();
    });
    runningProcesses.clear();
    if (names.size) log(`  closed ${names.size} game process(es)`);

    /* The portal mirrors the timer card's countdown for its own nav-bar
       display (see createTimerCard), but only the timer card itself was ever
       told a session actually ended — closing it here left the portal's own
       copy ticking down from stale numbers forever, since nothing else was
       going to fire the "app closed" event this bypassed (killProcess() is a
       direct taskkill, not the watched child whose exit normally reports
       back). Tell the portal directly so its countdown clears with the game. */
    if (hadRunning) sendToWindow(win, 'app-closed', { appName: null });
  }

  /* 2. Sign out of the launchers the café asked for. Done before "close
        launcher" because signing out stops the launcher anyway. */
  const signout = cfg.signout || {};
  const wanted = Object.keys(signout).filter((k) => signout[k]);
  if (wanted.length) {
    const installed = await detectLaunchers();
    for (const name of wanted) {
      const info = installed[name];
      if (!info || !info.installed) { log(`  ${name} not installed, nothing to sign out`); continue; }
      await signOutLauncher(name, info.path);
    }
  }

  /* 3. Close any launcher still running, for cafés that want the desktop clean
        without clearing credentials. */
  if (cfg.close_launcher) {
    for (const [name, recipe] of Object.entries(SIGNOUT_RECIPES)) {
      if (signout[name]) continue;               // already stopped by the sign-out
      for (const proc of recipe.processes) await killProcess(proc);
    }
    log('  launchers closed');
  }

  /* 4. Forget the customer on this station. The café server owns the session
        record; this only clears what the station itself is showing. */
  if (cfg.clear_session !== false) {
    currentSession = null;
    currentGames = [];
    sendToWindow(win, 'session-state', null);
    sendToWindow(win, 'games-list', []);
    log('  station session cleared');
  }

  log('Session cleanup done.');
}

/** Detect and report this station's launchers to the console. */
async function reportLaunchers(ws) {
  try {
    const launchers = await detectLaunchers();
    const on = Object.keys(launchers).filter((k) => launchers[k].installed);
    log(`Launchers detected: ${on.length ? on.join(', ') : 'none'}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'LAUNCHERS', simId: SIM_ID, launchers }));
    }
    return launchers;
  } catch (e) {
    log(`Launcher detection failed: ${e.message}`);
    return {};
  }
}

function createWindow() {
  // IPC handler for timer expiry - close the app
  ipcMain.on('timer-expired', (event, appName) => {
    log(`Timer expired for ${appName}, closing application...`);
    closeApplication(appName);
  });

  /* The block ran out and the game was left running. Tell the console so it can
     flag the station (over time, possibly low balance) for staff to settle. */
  ipcMain.on('session-overtime', (event, appName) => {
    if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
      serverConnection.send(JSON.stringify({ type: "SESSION_OVERTIME", simId: SIM_ID, appName: appName || null }));
      log("Sent SESSION_OVERTIME to console");
    }
  });

  /* The customer tapped "Call staff" from the Help menu. Fire-and-forget, same
     as the other station-initiated requests: if the console is not connected
     there is nobody to notify, and the customer already sees that from the
     "Offline" state elsewhere in the portal. */
  ipcMain.on('call-staff', () => {
    if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
      serverConnection.send(JSON.stringify({ type: "CALL_STAFF", simId: SIM_ID }));
      log("Sent CALL_STAFF to console");
    } else {
      log("Call staff requested but console not connected");
    }
  });

  /* The customer opened the game picker while idle and wants to see what they
     could start — this station's games and this café's prices. */
  ipcMain.on('request-start-options', () => {
    if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
      serverConnection.send(JSON.stringify({ type: "REQUEST_START_OPTIONS", simId: SIM_ID }));
      log("Sent REQUEST_START_OPTIONS to console");
    }
  });

  /*
   * The customer picked a game and a price and tapped Start.
   *
   * This never touches the backend directly — the station holds no staff
   * token, only the customer's own, and starting a session is a staff-scoped
   * endpoint. The console does the actual call once this reaches it (see
   * server-app's `station:start-request`), the same hand-off the Extend
   * button already relies on.
   */
  ipcMain.on('request-start-session', (event, { game, gaming_price_id, use_venue_account } = {}) => {
    if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
      // Remembered whole, not just its id, so it can be launched directly the
      // moment the session goes active — no extra round trip to look it up.
      pendingSelfStartGame = game || null;
      serverConnection.send(JSON.stringify({
        type: "START_SESSION_REQUEST", simId: SIM_ID,
        customer_id: userInfo && userInfo.customer_id,
        gaming_price_id: gaming_price_id || null,
        game_id: (game && game.game_id) || null,
        // Which store's copy of the game — this station may have more than one.
        game_platform_id: (game && game.game_platform_id) || null,
        use_venue_account: !!use_venue_account
      }));
      log("Sent START_SESSION_REQUEST to console");
    } else {
      sendToWindow(win, "start-session-failed", { message: "Not connected to the café server" });
    }
  });

  // IPC handler for page navigation
  ipcMain.on('navigate', (event, page) => {
    navigateToPage(page);
  });

  // IPC handler for storing authentication token
  ipcMain.on('store-token', (event, token) => {
    userToken = token;
    log(`User token stored`);
  });

  // IPC handler for storing authenticated user details
  ipcMain.on('store-user-info', (event, user) => {
    userInfo = user;
    log(`User info stored`);
  });

  // IPC handler for retrieving authentication token
  ipcMain.handle('get-token', async (event) => {
    return userToken;
  });

  // IPC handler for retrieving authenticated user details
  ipcMain.handle('get-user-info', async (event) => {
    return userInfo;
  });

  // IPC handler for getting PC name
  ipcMain.handle('get-pc-name', async (event) => {
    return SIM_ID;
  });

  // The portal loads before SET_NAME necessarily arrives, so it pulls the
  // current address rather than trusting a push it might have missed.
  ipcMain.handle('get-backend-base', async (event) => {
    return BACKEND_BASE;
  });

  // IPC handler for getting current connection status
  ipcMain.handle('get-status', async (event) => {
    return currentStatus;
  });

  // The portal reloads on navigation, so it needs to be able to ask for the
  // session rather than only receiving the push.
  ipcMain.handle('get-session-state', async (event) => {
    return currentSession;
  });

  ipcMain.handle('get-games', async () => currentGames);

  ipcMain.handle('get-app-version', async () => app.getVersion());

  /*
   * Which game launchers this station has, and opening one — the customer
   * side of the same detectLaunchers() the console already uses to badge a
   * station "Steam ✓ Riot ✓". Opening one just runs its own installer/login
   * screen; it never touches an account by itself, so there is nothing here
   * that needs the session-cleanup guardrails a game launch has.
   */
  ipcMain.handle('get-launchers', async () => detectLaunchers());
  ipcMain.handle('open-launcher', async (_, name) => {
    const launchers = await detectLaunchers();
    const info = launchers[name];
    if (!info || !info.installed) return { success: false, error: 'Not installed on this station' };
    return new Promise((resolve) => {
      exec(`"${info.path}"`, (err) => resolve({ success: !err, error: err ? err.message : null }));
    });
  });

  /*
   * Volume — real get/set against the default playback device's actual
   * level, via Windows' Core Audio API (IAudioEndpointVolume). scripts/
   * volume.ps1 does the work through inline C#/COM interop: no PowerShell
   * module to install, no native Node addon to compile or code-sign for the
   * packaged build. See that file's header for why the interface calls live
   * in compiled C# rather than PowerShell script code.
   *
   * Deliberately NOT touching the Windows session itself (no lock-workstation
   * call anywhere here): this is a public kiosk with no guarantee a customer
   * or even staff holds the machine's Windows credentials, so anything that
   * could leave the station stuck at a real OS lock screen is off the table.
   */
  const VOLUME_SCRIPT = path.join(__dirname, 'scripts', 'volume.ps1');
  function runVolumeScript(args) {
    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${VOLUME_SCRIPT}" ${args}`,
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err) return resolve({ success: false, error: err.message });
          try {
            const state = JSON.parse(stdout.trim());
            resolve({ success: true, level: state.level, muted: state.muted });
          } catch (parseErr) {
            resolve({ success: false, error: 'Unexpected output: ' + stdout });
          }
        }
      );
    });
  }
  ipcMain.handle('volume:get', async () => runVolumeScript('-Action get'));
  ipcMain.handle('volume:set', async (_, level) => runVolumeScript(`-Action set -Level ${Number(level) || 0}`));
  ipcMain.handle('volume:mute-toggle', async () => runVolumeScript('-Action toggle-mute'));

  ipcMain.on('launch-game', (event, game) => launchGame(game));

  /* The timer card asking to reveal or re-hide itself. Generic over which
     card sent it (a station can have more than one game timed at once), via
     the window that owns the renderer that asked. */
  ipcMain.on('timer-card:show', (event) => {
    const cardWin = BrowserWindow.fromWebContents(event.sender);
    if (cardWin && !cardWin.isDestroyed()) cardWin.show();
  });
  ipcMain.on('timer-card:hide', (event) => {
    const cardWin = BrowserWindow.fromWebContents(event.sender);
    if (cardWin && !cardWin.isDestroyed()) cardWin.hide();
  });

  /* The customer closed the "Getting your game ready…" overlay before it
     resolved. If the game already has a tracked process by now, close it the
     same way the console's own "Close app" button would; otherwise the exe
     launch is still in flight and cancelLaunches remembers to kill it the
     moment it does report a PID. Protocol hand-offs (Steam etc.) have already
     left this process's control by the time anything could react, so there is
     nothing left here to stop — the customer is simply back at the picker. */
  ipcMain.on('cancel-launch', (event, appName) => {
    if (!appName) return;
    if (runningProcesses.has(appName)) {
      log(`Launch cancelled by customer: ${appName}`);
      closeApplication(appName);
    } else {
      log(`Launch cancelled by customer before it started: ${appName}`);
      cancelledLaunches.add(appName);
    }
  });

  /* ---- Window controls ----
   *
   * Gated on the kiosk lock rather than removed.
   *
   * While a station is sealed each of these is a way onto the Windows
   * desktop, so each is refused. Once staff have unlocked it with the PIN
   * they are working on an ordinary machine and need ordinary controls, so
   * the same calls start working.
   *
   * The check lives here, in the main process, and not in the page: a control
   * the renderer merely hides is still a control the renderer can call.
   */
  const ifUnlocked = (what, run) => () => {
    if (kioskLocked) {
      log(`Ignored a request to ${what}: this station is sealed. Unlock it with Ctrl+Alt+Shift+Q.`);
      return;
    }
    if (alive(win)) run();
  };

  /*
   * Going back to full screen means going back to being a kiosk.
   *
   * For this app the two are the same state — full screen is how it trades,
   * and an unlocked full-screen window would be a station that looks sealed
   * to the customer sitting at it while every escape still works. So the
   * button that returns it to full screen re-seals it, which also puts the
   * window controls away and is the quickest way for staff to hand a station
   * back after working on it.
   *
   * Leaving full screen while unlocked stays an ordinary un-maximise.
   */
  ipcMain.on('window:toggle-fullscreen', ifUnlocked('leave full screen', () => {
    if (win.isFullScreen()) { win.setFullScreen(false); return; }
    kioskLocked = true;
    win.setKiosk(true);
    win.setFullScreen(true);
    win.focus();
    publishKioskState();
    log('Kiosk re-sealed by the full-screen control.');
  }));
  ipcMain.on('window:minimize', ifUnlocked('minimise', () => win.minimize()));
  ipcMain.on('window:toggle-maximize', ifUnlocked('un-maximise', () => {
    if (win.isFullScreen()) { win.setFullScreen(false); return; }
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }));
  ipcMain.on('window:close', ifUnlocked('close the window', () => {
    allowQuit = true;      // unlocked and asked for deliberately by staff
    win.close();
  }));

  ipcMain.handle('window:is-fullscreen', async () => alive(win) ? win.isFullScreen() : true);
  ipcMain.handle('window:is-maximized', async () => alive(win) ? win.isMaximized() : true);
  ipcMain.handle('window:is-kiosk-locked', async () => kioskLocked);

  /*
   * Payment checkout.
   *
   * A gateway's checkout SDK cannot run in the portal renderer — it loads over
   * file:// with node integration off — and giving that renderer the
   * privileges to host third-party payment script would undo the reason it is
   * locked down. So the payment happens in its own window, on the backend's
   * http origin, isolated from the portal and from the station's session.
   *
   * The renderer passes a path, never a full URL: the origin is fixed here, so
   * a compromised page cannot point the payment window at a site it chose.
   */
  let checkoutWin = null;

  ipcMain.handle('payment:open-checkout', async (event, checkoutPath) => {
    if (typeof checkoutPath !== 'string' || !/^\/api\/payments\/checkout\/[A-Za-z0-9_-]{20,64}$/.test(checkoutPath)) {
      return { ok: false, message: 'Invalid checkout link' };
    }

    if (alive(checkoutWin)) { checkoutWin.focus(); return { ok: true, reused: true }; }

    checkoutWin = new BrowserWindow({
      icon: path.join(__dirname, 'Images', 'icon.png'),
      width: 520,
      height: 720,
      parent: alive(win) ? win : undefined,
      modal: false,
      title: 'Add XP Coins',
      autoHideMenuBar: true,
      backgroundColor: '#0b0b0f',
      webPreferences: {
        // The payment page is third-party script by definition. It gets no
        // preload, no node, and its own session partition so it cannot read
        // the station's cookies or storage.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'temp:cafexp-checkout'
      }
    });

    // The page reports the outcome on the console; the portal needs to know so
    // it can refresh the balance without the customer hunting for a button.
    checkoutWin.webContents.on('console-message', (e, level, message) => {
      if (typeof message !== 'string' || message.indexOf('CAFEXP_TOPUP:') !== 0) return;
      try {
        const detail = JSON.parse(message.slice('CAFEXP_TOPUP:'.length));
        if (alive(win)) win.webContents.send('payment:topup-result', detail);
      } catch (err) { /* a malformed line is not worth crashing over */ }
    });

    // A payment page must never become a general-purpose browser.
    checkoutWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    checkoutWin.on('closed', () => {
      checkoutWin = null;
      // The customer may have paid and closed the window before it confirmed;
      // the portal re-checks rather than assuming nothing happened.
      if (alive(win)) win.webContents.send('payment:checkout-closed');
    });

    await checkoutWin.loadURL(`${BACKEND_BASE}${checkoutPath}`);
    return { ok: true };
  });


  // Create main client application window.
  // The customer portal is a full-screen experience — no title bar, no chrome.
  win = new BrowserWindow({
    icon: path.join(__dirname, 'Images', 'icon.png'),
    fullscreen: true,
    /*
     * Kiosk mode.
     *
     * This window is what a paying customer sits in front of, on a machine
     * the café owns. Everything that could put them behind it — minimising,
     * un-maximising, closing, the OS frame — is refused at the window level
     * rather than merely hidden, because a control that is only hidden is
     * still reachable by the shortcut that drives it.
     *
     * Staff are not locked out: the console drives this client remotely
     * (restart-client, lock, sign out, shut down) over the same socket it
     * already uses, so the way back in is the admin side, not a key combo a
     * customer could stumble onto.
     */
    kiosk: true,
    frame: false,
    closable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#050509', // matches the portal background, avoids a white flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // No dev tools on a customer machine.
      devTools: false
    }
  });

  /*
   * Every keyboard route out of the kiosk, refused.
   *
   * F11 and Escape used to toggle full screen here on purpose — that was the
   * staff escape before the console could drive this client remotely. On a
   * customer-facing machine they are exactly the shortcuts that put someone
   * on the Windows desktop, so they are now swallowed along with the reload,
   * dev-tools and window-closing combinations.
   *
   * Alt+F4 and Ctrl+W are caught here *and* refused again by the window's
   * close handler below: this listener only sees keys the page receives, and
   * defence in one place is not defence.
   */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = String(input.key || '').toLowerCase();

    /*
     * The staff way out: Ctrl+Alt+Shift+Q.
     *
     * Deliberately a four-key combination with a modifier set nothing else in
     * the app uses. A customer will not find it by pressing things, and it
     * cannot be hit by accident on the way to typing an email address — which
     * is the bar an escape hatch on a kiosk has to clear.
     *
     * This exists for the case the remote route cannot cover: the café's
     * network or the console is down, and somebody physically at the station
     * needs the desktop. It toggles, so the same keys put the kiosk back
     * rather than leaving the station unlocked until it is rebooted.
     */
    /* `code` is the physical key, `key` is the character it produced. With
       Ctrl+Alt held Windows applies AltGr behaviour on several layouts, so
       the character can be something other than "q" while the key under the
       finger is unchanged. Matching the physical key makes the combination
       work the same on every keyboard. */
    if (input.control && input.alt && input.shift &&
        (input.code === 'KeyQ' || key === 'q')) {
      event.preventDefault();
      toggleKioskLock('the station keyboard');
      return;
    }
    const blockedAlone = ['f11', 'f12', 'escape'];
    const blocked = !!(
      blockedAlone.includes(key) ||
      // Reload, close, print, dev tools, and the "open a new window" family.
      ((input.control || input.meta) && ['r', 'w', 'n', 't', 'p', 'q'].includes(key)) ||
      ((input.control || input.meta) && input.shift && ['i', 'j', 'c', 'r'].includes(key)) ||
      (input.alt && ['f4', 'tab'].includes(key))
    );

    /* Only while sealed. Once staff have unlocked the station these are the
       very keys they need — refusing Alt+Tab on a machine somebody is trying
       to install a driver on would make the unlock pointless. */
    if (blocked && kioskLocked) event.preventDefault();
  });

  /*
   * Coming back from minimised puts the kiosk back exactly as it was.
   *
   * A minimised window restores to whatever size it had before, and the
   * minimise that got us here had to leave kiosk mode first — Electron keeps
   * a kiosk window on top, so it would otherwise spring straight back. The
   * result was a client sitting in a small floating window with the desktop
   * visible around it the moment anybody clicked it in the task bar.
   *
   * Restoring is the signal that whoever minimised it is finished, so the
   * seal goes back on. Staff who still want the desktop minimise it again;
   * staff who want it genuinely unlocked use Ctrl+Alt+Shift+Q, which sets
   * kioskLocked false and is deliberately left alone here.
   */
  /* While the PIN prompt is up, the kiosk must not re-assert itself. It is an
     always-on-top window sitting over an always-on-top window: each raise
     would pull focus back from the other and the pair would strobe. */
  const reseal = () => {
    if (!kioskLocked || alive(pinWin)) return;
    if (win.isFullScreen()) return;   // already sealed — do not re-apply
    win.setKiosk(true);
    win.setFullScreen(true);
  };

  win.on('restore', reseal);
  /* Same for a plain show, which is what a task-bar click raises when the
     window was hidden rather than minimised. */
  win.on('show', reseal);

  /*
   * The window cannot be closed from the machine it runs on.
   *
   * `closable: false` already removes the frame's own control, but a close
   * can still arrive from Alt+F4 or the task bar, and Electron delivers that
   * as an ordinary close event. Quitting deliberately — a remote
   * restart-client — goes through app.exit(), which does not raise this at
   * all, so the legitimate path is unaffected.
   */
  win.on('close', (event) => {
    if (!allowQuit && kioskLocked) {
      event.preventDefault();
      log('Close refused: the client is in kiosk mode. Use the console to restart or stop it.');
    }
  });

  // Keep the on-screen control's icon in step with the real window state.
  const pushFullscreenState = () => {
    sendToWindow(win, 'window:fullscreen-changed', win && !win.isDestroyed() && win.isFullScreen());
  };
  win.on('enter-full-screen', pushFullscreenState);
  win.on('leave-full-screen', pushFullscreenState);

  // Same for maximise, so the button's glyph always matches the real state.
  const pushMaximizedState = () => {
    sendToWindow(win, 'window:maximized-changed', alive(win) && win.isMaximized());
  };
  win.on('maximize', pushMaximizedState);
  win.on('unmaximize', pushMaximizedState);

  // Remove the application menu
  Menu.setApplicationMenu(null);

  // Closing the portal shuts the client down, rather than leaving a headless
  // process holding the WebSocket port and broadcasting to nobody.
  win.on('closed', () => {
    win = null;
    app.quit();
  });

  currentPage = 'status';
  win.loadFile("index.html");
}

function navigateToPage(page) {
  if (!win || win.isDestroyed()) return;
  
  const pages = {
    'welcome': 'welcome.html',
    'login': 'login.html',
    'forgot-password': 'forgot-password.html',
    'register': 'register.html',
    'userdashboard': 'userdashboard.html',
    'dashboard': 'index.html',
    'status': 'index.html'
  };

  const pageFile = pages[page] || 'welcome.html';
  currentPage = page;
  log(`Navigating to ${page} (${pageFile})`);
  
  win.loadFile(pageFile);
}

// A closed BrowserWindow is not null, it is destroyed — touching webContents
// on it throws. Every send goes through these guards.
function alive(target) {
  return !!target && !target.isDestroyed();
}

function sendToWindow(target, channel, payload) {
  if (!alive(target)) return;
  try {
    target.webContents.send(channel, payload);
  } catch (err) {
    // The window can be torn down between the check and the send.
    console.warn(`[send] ${channel} dropped: ${err.message}`);
  }
}

function log(message) {
  sendToWindow(win, "log", message);
}

function updateStatus(status) {
  /*
   * Only tell the windows when it actually changed.
   *
   * The console opens a fresh socket on every heartbeat sweep, so this used
   * to be called with "CONNECTED" over and over. The status bar shows itself
   * on each message and hides three seconds later, which turned a healthy
   * link into a strip flashing in and out across the top of the welcome
   * screen — the flicker, rather than anything the page was drawing.
   *
   * The navigation below still runs on every call: it is guarded by the page
   * the client is currently on, not by the message being new, and a
   * reconnect that finds the client stranded on the wrong page should still
   * move it.
   */
  const changed = currentStatus !== status;
  currentStatus = status; // Update current status

  if (changed) {
    sendToWindow(win, "status", status);
  }
  
  // Navigate to welcome page when connected
  if (status === "CONNECTED" && currentPage === 'status') {
    setTimeout(() => {
      navigateToPage('welcome');
    }, 500);
  }
  
  // Navigate back to the home/logs page when disconnected
  if (status === "DISCONNECTED" && currentPage !== 'status') {
    setTimeout(() => {
      log("PC disconnected, navigating back to home page");
      navigateToPage('status');
    }, 500);
  }
}

// Get the local IP address of the system
function getLocalIPAddress() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Try to find the first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      for (const addr of iface) {
        // Find IPv4 addresses that are not internal (loopback)
        if (addr.family === 'IPv4' && !addr.internal) {
          log(`Found local IP address: ${addr.address} on interface: ${name}`);
          return addr.address;
        }
      }
    }
    
    // Fallback: return localhost
    log('Warning: No local IP found, using localhost');
    return '127.0.0.1';
  } catch (error) {
    log(`Error getting local IP address: ${error.message}`);
    return '127.0.0.1';
  }
}

// Broadcast PC information to server app for auto-discovery
function broadcastPCInfo() {
  try {
    const macAddress = getSystemMacAddress();
    const localIP = LOCAL_IP;
    const hostname = os.hostname();

    const payload = JSON.stringify({
      type: 'PC_DISCOVERY',
      ip_address: localIP,
      mac_address: macAddress,
      hostname: hostname,
      port: CLIENT_PORT
    });

    const options = {
      hostname: 'localhost',
      port: SERVER_APP_PORT,
      path: '/api/pc-discovery',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          log(`✓ PC broadcast successful - IP: ${localIP}, MAC: ${macAddress}`);
        } else {
          log(`✗ PC broadcast failed - Status: ${res.statusCode}`);
        }
      });
    });

    req.on('error', (error) => {
      // Expected on a real café floor: the console almost never runs on this
      // same machine, so nothing is listening on localhost:SERVER_APP_PORT.
      // That is not fatal — reportMacToBackend() below is the path that
      // actually reaches the console in that layout.
      log(`⚠ Local discovery relay unreachable (expected on a separate console machine): ${error.message}`);
    });

    req.setTimeout(3000);
    req.write(payload);
    req.end();

    reportMacToBackend(localIP, macAddress);
  } catch (error) {
    log(`Error broadcasting PC info: ${error.message}`);
  }
}

/*
 * Tell the backend directly that this MAC is now at this IP.
 *
 * The local relay above only ever reaches the console when both apps happen
 * to share a machine — never true on a real floor, where every station is
 * its own PC. BACKEND_BASE is the address that already carries every other
 * live request this app makes (wallet, session, checkout), corrected to the
 * console's real LAN address via SET_NAME the moment this station first
 * connects — so it is reachable long before a same-machine relay ever would
 * be. /api/pcs/check-exists needs no auth and is exactly the endpoint that
 * updates a known MAC's IP in the database, which is the actual fix for a
 * station whose DHCP lease changed since it last registered.
 */
function reportMacToBackend(localIP, macAddress) {
  fetch(`${BACKEND_BASE}/api/pcs/check-exists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip_address: localIP, mac_address: macAddress })
  })
    .then((res) => res.json())
    .then((result) => {
      if (result && result.ip_updated) {
        log(`✓ Backend IP auto-update confirmed for MAC ${macAddress} → ${localIP}`);
      }
    })
    .catch((error) => {
      log(`⚠ Backend IP auto-update failed: ${error.message}`);
    });
}

// Get the MAC address of the system
function getSystemMacAddress() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Try to find the first non-internal, active interface with a MAC address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      
      // Skip loopback and internal interfaces
      if (iface[0]?.family === 'IPv4' && !iface[0]?.internal) {
        const macAddress = iface[0]?.mac;
        if (macAddress && macAddress !== '00:00:00:00:00:00') {
          log(`Found MAC address: ${macAddress} on interface: ${name}`);
          return macAddress;
        }
      }
    }
    
    // Fallback: get the first available MAC address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      for (const addr of iface) {
        const macAddress = addr.mac;
        if (macAddress && macAddress !== '00:00:00:00:00:00') {
          log(`Found fallback MAC address: ${macAddress} on interface: ${name}`);
          return macAddress;
        }
      }
    }
    
    log('Warning: No valid MAC address found, using default');
    return 'unknown';
  } catch (error) {
    log(`Error getting MAC address: ${error.message}`);
    return 'error';
  }
}

function createTimerCard(appName, timerMinutes, bufferSeconds) {
  bufferSeconds = bufferSeconds || 0;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  /* Sized to the pill, not to a panel. The old 190×130 window was mostly
     empty space with a blurred background, which is what read as a strip
     across the corner of the game. */
  const timerCard = new BrowserWindow({
    width: 186,
    height: 48,
    x: width - 202,  // 16px from the right edge
    y: 16,           // 16px from the top
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    /* Most games show no on-screen session clock at all — this card should
       read the same way. It stays off-screen (still running, still ticking)
       until timercard.js asks to show it, which it does only once the
       five-minute warning fires. */
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  timerCard.loadFile("timercard.html");
  timerCard.setAlwaysOnTop(true, 'floating');
  
  // Send timer data once window is ready
  timerCard.webContents.once('did-finish-load', () => {
    timerCard.webContents.send("start-timer", {
      appName: appName,
      minutes: timerMinutes,
      bufferSeconds: bufferSeconds
    });
  });

  // Mirror the same event to the customer portal so it can show the countdown
  // in its navigation bar. Display only — the timer card remains the window
  // that reports expiry back to the main process.
  sendToWindow(win, "start-timer", { appName: appName, minutes: timerMinutes, bufferSeconds: bufferSeconds });

  return timerCard;
}

function getInstalledApps() {
  return new Promise((resolve, reject) => {
    // Return cached apps if still fresh
    const now = Date.now();
    if (cachedApps && (now - lastAppsCacheTime) < APPS_CACHE_DURATION) {
      log(`✅ Using cached apps (${cachedApps.length} items)`);
      resolve(cachedApps);
      return;
    }

    const scriptPath = path.join(__dirname, "get_apps.ps1");
    const outputDir = path.join(__dirname, "output");
    const outputFile = path.join(outputDir, "apps.json");

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 1;

    const executeScript = () => {
      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`,
        { cwd: __dirname, timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
        (err) => {
          const duration = Date.now() - startTime;
          
          if (err) {
            log(`❌ PowerShell error (${duration}ms): ${err.message}`);
            if (retryCount < maxRetries) {
              retryCount++;
              log(`🔄 Retrying PowerShell execution (attempt ${retryCount}/${maxRetries})...`);
              setTimeout(executeScript, 500); // Retry after 500ms
            } else {
              reject(err);
            }
            return;
          }
          
          // Add delay to ensure file is fully written
          setTimeout(() => {
            try {
              if (!fs.existsSync(outputFile)) {
                reject(new Error('Output file not created by PowerShell script'));
                return;
              }
              
              const fileStats = fs.statSync(outputFile);
              log(`📄 Output file size: ${fileStats.size} bytes`);
              
              const data = fs.readFileSync(outputFile, "utf8");
              const apps = JSON.parse(data);
              
              // Cache the result
              cachedApps = apps;
              lastAppsCacheTime = Date.now();
              
              log(`✅ Parsed ${apps.length} apps (${duration}ms)`);
              resolve(apps);
            } catch (parseErr) {
              log(`❌ Parse error (${duration}ms): ${parseErr.message}`);
              reject(parseErr);
            }
          }, 500); // Wait 500ms for file to be fully written
        }
      );
    };

    executeScript();
  });
}

/* ==========================================================================
   POWER ACTIONS
   Restart, shut down, lock or sign out, driven from the admin console.

   Windows is given a short delay rather than an immediate order, so the
   person at the machine sees the on-screen warning and the console gets its
   acknowledgement back before the socket goes away.
   ========================================================================== */
const POWER_ACTIONS = {
  restart: {
    label: "Restart",
    // /f closes applications that would otherwise hold the shutdown open —
    // a game sitting on a "save before quitting?" prompt would block forever.
    command: (seconds) => `shutdown /r /f /t ${seconds} /c "CafeXP: this station is restarting"`
  },
  shutdown: {
    label: "Shut down",
    command: (seconds) => `shutdown /s /f /t ${seconds} /c "CafeXP: this station is shutting down"`
  },
  lock: {
    label: "Lock",
    command: () => "rundll32.exe user32.dll,LockWorkStation"
  },
  signout: {
    label: "Sign out",
    // /l takes no timeout, so the warning below is the only notice given.
    command: () => "shutdown /l /f"
  }
};

/*
 * The staff lock toggle, reached two ways.
 *
 * `before-input-event` only fires while the kiosk window itself has focus,
 * which is the normal case on a station but not the only one — a café that
 * runs the console on the same machine, or any moment the client has been
 * minimised, leaves focus somewhere else entirely and the combination looked
 * dead. So the same toggle is also registered as a system-wide shortcut, and
 * both routes land here rather than each growing their own copy of the rules.
 */
/*
 * Put the window's own capabilities in step with the lock.
 *
 * closable/minimizable/maximizable are set false when the window is built, and
 * they are enforced by the OS rather than by anything this code checks — so
 * lifting the kiosk flag alone left Close and Minimise dead even after staff
 * had unlocked the station with the PIN. The buttons appeared and did nothing.
 *
 * They are toggled with the lock rather than left permanently on, because they
 * are also what removes the frame's own controls for the customer.
 */
function applyKioskCapabilities() {
  if (!alive(win)) return;
  const unlocked = !kioskLocked;
  try {
    win.setClosable(unlocked);
    win.setMinimizable(unlocked);
    win.setMaximizable(unlocked);
  } catch (e) {
    log(`Could not change the window's capabilities: ${e.message}`);
  }
}

/*
 * The Windows-level escape routes `before-input-event` cannot actually stop.
 *
 * That listener only sees keys already delivered to this window, and several
 * of the combinations it tries to block — Alt+Tab above all — are intercepted
 * by Windows' own shell before any application's window procedure sees them;
 * calling preventDefault() there does nothing for those specific keys. The
 * WH_KEYBOARD_LL hook started by startWindowsKioskGuard() runs ahead of the
 * shell itself, which is the only thing that actually stops them.
 *
 * Win+L and Ctrl+Alt+Del are deliberately not attempted here — Windows
 * reserves both as part of the Secure Attention Sequence and refuses to let
 * any application, including this one, intercept them. Nothing short of a
 * Group Policy / Assigned Access configuration on the machine itself can
 * change that, so claiming success here would be a lie.
 */
/* Keep the Windows keyboard guard synchronized with kioskLocked. */
function syncKioskShortcuts() {
  syncWindowsKeyboardBlocker();
}

/* Tell the page whether it is sealed, so the on-screen window controls can
   appear only when they would actually do something. */
function publishKioskState() {
  applyKioskCapabilities();
  syncKioskShortcuts();
  sendToWindow(win, 'window:kiosk-state', kioskLocked);
}

function toggleKioskLock(source) {
  /* Console too, not just the in-app log: when staff are chasing "the
     shortcut does nothing", the answer is usually in whether this line
     appears at all. */
  console.log(`[Kiosk] Toggle requested from ${source} (currently ${kioskLocked ? 'sealed' : 'unlocked'}).`);
  if (!alive(win)) return;

  // Re-sealing needs no PIN. Locking a station down is never the risky
  // direction, and asking for one would only tempt staff to leave it open.
  if (!kioskLocked) {
    kioskLocked = true;
    win.setKiosk(true);
    win.setFullScreen(true);
    win.focus();
    publishKioskState();
    log(`Kiosk re-locked from ${source}.`);
    return;
  }

  if (!staffUnlockPin) {
    log(`Unlock requested from ${source}, but no staff PIN is set for this café.`);
    promptStaffPin(null);
    return;
  }
  log(`Unlock requested from ${source} — asking for the staff PIN.`);
  promptStaffPin(staffUnlockPin);
}

/*
 * Ask for the staff PIN before unlocking the kiosk.
 *
 * Its own always-on-top window, because the thing it sits over is a kiosk
 * window that Electron deliberately keeps above everything else — a prompt
 * drawn inside the page would be reachable by the very customer the PIN is
 * meant to keep out, and one drawn in an ordinary window would be hidden
 * behind the kiosk.
 *
 * The PIN is compared here in the main process. It is never sent to the page:
 * the renderer only reports what was typed, and gets back nothing but whether
 * the window should close.
 *
 * `expected` of null means no PIN is configured for this café — the prompt
 * still appears, and explains why it cannot let anybody through, rather than
 * leaving staff pressing a combination that silently does nothing.
 */
let pinWin = null;

function promptStaffPin(expected) {
  if (alive(pinWin)) { pinWin.focus(); return; }

  pinWin = new BrowserWindow({
    width: 340,
    height: 260,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    backgroundColor: '#0b0b0f',
    parent: alive(win) ? win : undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, "pin-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  });
  pinWin.setAlwaysOnTop(true, 'screen-saver');

  const unset = expected === null;
  const body = unset
    ? `<p class="msg">No staff PIN has been set for this caf&eacute;.</p>
       <p class="hint">Set one in the admin console under Settings, then try again.
       Staff can still minimise this station from the console.</p>
       <button id="cancel" class="btn">Close</button>`
    : `<p class="msg">Staff PIN</p>
       <input id="pin" type="password" inputmode="numeric" maxlength="4" autofocus />
       <p class="hint" id="err">&nbsp;</p>
       <div class="row"><button id="cancel" class="btn">Cancel</button>
       <button id="ok" class="btn primary">Unlock</button></div>`;

  const html = `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;height:100vh;display:flex;align-items:center;
      justify-content:center;background:#0b0b0f;color:#f4f4f7;
      font-family:'Segoe UI',system-ui,sans-serif;border:1px solid #2a2a35;border-radius:10px}
    .card{padding:22px;width:100%;text-align:center}
    .msg{margin:0 0 14px;font-size:14px;font-weight:600}
    .hint{margin:10px 0 0;font-size:11px;color:#8a8a9a;line-height:1.5}
    input{width:150px;padding:10px;font-size:24px;text-align:center;letter-spacing:12px;
      background:#15151d;border:1px solid #2a2a35;border-radius:8px;color:#fff;outline:none}
    input:focus{border-color:#ff1744}
    .row{display:flex;gap:8px;justify-content:center;margin-top:16px}
    .btn{padding:8px 16px;font-size:12px;border-radius:7px;border:1px solid #2a2a35;
      background:transparent;color:#c9c9d4;cursor:pointer}
    .btn.primary{background:#ff1744;border-color:#ff1744;color:#fff;font-weight:600}
    .err{color:#ff5a6e}
  </style><div class="card">${body}</div>
  <script>
    document.getElementById('cancel').addEventListener('click', () => window.staffPin.cancel());
    const pin = document.getElementById('pin');
    if (pin) {
      const err = document.getElementById('err');
      const submit = () => {
        if (pin.value.length !== 4) return;
        window.staffPin.try(pin.value).then((ok) => {
          if (ok) return;   // main closes the window on success
          err.textContent = 'Incorrect PIN'; err.className = 'hint err';
          pin.value = ''; pin.focus();
        });
      };
      document.getElementById('ok').addEventListener('click', submit);
      pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      pin.addEventListener('input', () => {
        pin.value = pin.value.replace(/\\D/g, '');
        // Four digits is the whole PIN, so there is nothing to press Enter for.
        if (pin.value.length === 4) submit();
      });
      setTimeout(() => pin.focus(), 50);
    }
  <\/script>`;

  pinWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  pinWin.on('closed', () => { pinWin = null; if (alive(win)) win.focus(); });
}

/*
 * Checking the PIN.
 *
 * Registered once, at module scope, rather than per prompt — re-registering
 * an ipcMain handler throws, so doing it inside promptStaffPin would fail the
 * second time staff ever used the hatch.
 *
 * A wrong PIN is answered with a plain false and nothing else: no count of
 * how many digits matched, no timing difference worth measuring over four
 * digits typed by hand.
 */
ipcMain.handle('staff-pin:try', async (_event, typed) => {
  if (!staffUnlockPin) return false;
  if (String(typed) !== String(staffUnlockPin)) {
    log('Staff unlock refused: wrong PIN entered at the station.');
    return false;
  }

  kioskLocked = false;
  stopWindowsKeyboardBlocker();
  if (alive(win)) {
    win.setKiosk(false);
    win.setFullScreen(false);
  }
  publishKioskState();
  log('Kiosk UNLOCKED at the station with the staff PIN — the desktop is reachable.');
  if (alive(pinWin)) pinWin.close();
  return true;
});

ipcMain.on('staff-pin:cancel', () => { if (alive(pinWin)) pinWin.close(); });

function runPowerAction(ws, action, delaySeconds) {
  const reply = (ok, message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "POWER_RESULT", simId: SIM_ID, action, success: ok, message
      }));
    }
    log(`Power ${action}: ${message}`);
  };

  if (action === "restart-client") {
    reply(true, "Restarting the CafeXP client");
    // The console asked for this, so the kiosk's close guard stands aside.
    allowQuit = true;
    // Relaunch, then quit — Electron starts the new instance as this one goes.
    app.relaunch();
    setTimeout(() => app.exit(0), 400);
    return;
  }

  /*
   * Getting the kiosk out of the way, on the console's authority.
   *
   * The window refuses to be minimised by the person sitting at it — that is
   * what makes it a kiosk. It does not refuse the café that owns it. Kiosk
   * mode has to come off first: Electron keeps a kiosk window on top, so
   * minimising without leaving kiosk gives a window that hides and springs
   * straight back.
   */
  if (action === "minimize-client") {
    if (!alive(win)) { reply(false, "The client window is not available"); return; }
    /*
     * Out of the way, but still sealed.
     *
     * kioskLocked deliberately stays true: this is a window that has been
     * moved aside, not a station that has been unlocked. Kiosk mode itself
     * has to come off for the minimise to stick — Electron keeps a kiosk
     * window on top — but the flag is what makes clicking the client in the
     * task bar put it straight back to full screen, which is the behaviour
     * staff expect when they are finished on the desktop.
     *
     * Genuinely unlocking a station is Ctrl+Alt+Shift+Q, at the station.
     */
    // kioskLocked itself stays true (see above), so this stops the hook
    // directly rather than through publishKioskState — restore-client's
    // own publishKioskState() call is what starts it back up.
    stopWindowsKeyboardBlocker();
    win.setKiosk(false);
    win.setFullScreen(false);
    win.minimize();
    reply(true, "Client minimised — the desktop is reachable until the client is clicked again");
    return;
  }

  if (action === "restore-client") {
    if (!alive(win)) { reply(false, "The client window is not available"); return; }
    kioskLocked = true;
    publishKioskState();
    win.restore();
    win.setKiosk(true);
    win.setFullScreen(true);
    win.focus();
    reply(true, "Client restored to kiosk mode");
    return;
  }

  const spec = POWER_ACTIONS[action];
  if (!spec) { reply(false, `Unknown power action: ${action}`); return; }

  if (process.platform !== "win32") {
    reply(false, `Power actions are implemented for Windows only (this is ${process.platform})`);
    return;
  }

  const seconds = Number.isFinite(Number(delaySeconds))
    ? Math.min(Math.max(Math.round(Number(delaySeconds)), 0), 600)
    : 10;

  // Tell the person at the machine before the countdown starts, rather than
  // letting the desktop simply disappear on them.
  sendToWindow(win, "power-warning", { action, label: spec.label, seconds });

  exec(spec.command(seconds), { windowsHide: true }, (err) => {
    if (err) reply(false, err.message);
    else reply(true, `${spec.label} accepted (${seconds}s)`);
  });
}

/* ==========================================================================
   TELEMETRY
   This machine samples its own counters and pushes them to the console. It
   runs while someone is gaming, so the sampler is deliberately cheap: CPU and
   memory are arithmetic over `os`, and the two counters that need a shell out
   are cached inside telemetry.js rather than read every tick.
   ========================================================================== */
function currentRunningApp() {
  const running = Array.from(runningProcesses.keys());
  return running.length ? running[0] : null;
}

async function pushTelemetry(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const reading = await telemetry.sample({
      pc_name: SIM_ID,
      running_app: currentRunningApp()
    });
    ws.send(JSON.stringify({ type: "TELEMETRY", simId: SIM_ID, sample: reading }));
  } catch (err) {
    // A failed sample is not worth interrupting anything for — the console
    // will show the station as not reporting, which is the truth.
    log(`Telemetry sample failed: ${err.message}`);
  }
}

function startTelemetry(ws, sampleSeconds) {
  stopTelemetry();

  const seconds = Number(sampleSeconds);
  telemetryIntervalSeconds = Number.isFinite(seconds) && seconds >= 5 && seconds <= 600
    ? Math.round(seconds)
    : telemetryIntervalSeconds;

  telemetry.prime();
  log(`Telemetry sampling every ${telemetryIntervalSeconds}s`);

  // One sample shortly after priming, so the console has something to show
  // without waiting a full interval for the first CPU delta.
  setTimeout(() => { pushTelemetry(ws); }, 1500);

  TELEMETRY_INTERVAL = setInterval(() => { pushTelemetry(ws); }, telemetryIntervalSeconds * 1000);
}

function stopTelemetry() {
  if (TELEMETRY_INTERVAL) {
    clearInterval(TELEMETRY_INTERVAL);
    TELEMETRY_INTERVAL = null;
  }
}

function listen() {
  log("Starting WebSocket server on port " + CLIENT_PORT + "...");
  
  wss = new WebSocket.Server({ port: CLIENT_PORT, host: '0.0.0.0' });
  
  wss.on("connection", async (ws) => {
    serverConnection = ws;
    log("Connected to VMS Server");
    updateStatus("CONNECTED");

    // Listen for server to send the PC name
    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw);
      
      // Handle SET_NAME message from server
      if (msg.type === "SET_NAME") {
        SIM_ID = msg.name;
        log(`PC name set to: ${SIM_ID}`);

        // Send PC name to renderer
        sendToWindow(win, "pc-name", SIM_ID);

        /* The console's own address, so the renderer's wallet calls and the
           checkout window reach the backend wherever it actually is rather
           than this machine. Only acted on when it actually changes something,
           the same guard used elsewhere for this handshake — the console
           resends SET_NAME on every reconcile, and there is no reason to
           re-announce the same address to the renderer each time. */
        if (msg.apiBase && msg.apiBase !== BACKEND_BASE) {
          BACKEND_BASE = msg.apiBase;
          log(`Backend address set to: ${BACKEND_BASE}`);
          sendToWindow(win, "backend-base", BACKEND_BASE);
        }

        // Register this client with the server using the provided name
        ws.send(JSON.stringify({
          type: "REGISTER",
          simId: SIM_ID,
          hostname: os.hostname()
        }));

        /* Which launchers this machine has. Sent before the app scan because it
           takes milliseconds, so the console knows what this station can run
           long before the full software inventory arrives. */
        reportLaunchers(ws);

        // This build's own version, for the console's version inventory.
        ws.send(JSON.stringify({ type: "CLIENT_VERSION", simId: SIM_ID, version: app.getVersion() }));

        // Fetch and send installed apps to server
        try {
          log("Fetching installed applications...");
          const apps = await getInstalledApps();
          log(`Found ${apps.length} applications`);
          
          ws.send(JSON.stringify({
            type: "APPS_LIST",
            simId: SIM_ID,
            apps: apps
          }));
          
          log("Apps list sent to server");
        } catch (err) {
          log(`Error fetching apps: ${err.message}`);
        }

        // The station has a name now, so its samples can be attributed.
        startTelemetry(ws, telemetryIntervalSeconds);

        return; // Don't process this as a command message
      }

      // Handle other messages
      
      if (msg.type === "COMMAND") {
        log(`Command received: ${msg.command}`);
      }

      /*
       * Settings this station has to hold locally.
       *
       * The unlock PIN in particular: the escape hatch it guards exists for
       * the moment this console cannot be reached, so a PIN that had to be
       * verified over the network would be useless exactly when it is
       * needed. Cached to disk so it survives a restart with the café
       * offline.
       */
      if (msg.type === "STATION_CONFIG") {
        if (typeof msg.staffUnlockPin === "string") {
          staffUnlockPin = msg.staffUnlockPin;
          persistUnlockPin(staffUnlockPin);
          log(`Station config received — staff unlock PIN is ${staffUnlockPin ? "set" : "not set"}.`);
        }
      }

      // Power actions issued from the admin console. The console has already
      // checked the operator's permission and written the audit entry, so by
      // the time this arrives the decision is made.
      if (msg.type === "POWER") {
        runPowerAction(ws, msg.action, msg.delaySeconds);
      }

      // Session state pushed by the admin console. The client only displays
      // it — the café server owns the session and its billing.
      if (msg.type === "SESSION_STATE") {
        const wasRunning = !!currentSession;
        currentSession = msg.session || null;
        const summary = currentSession
          ? `${currentSession.status} for ${currentSession.customer_name || "guest"}`
          : "cleared";
        log(`Session ${summary}`);
        console.log(`[Session] Received: ${summary}`);
        // account_credential exists only for the main process's own Steam
        // sign-in step (see ensureSteamSignedIn) — the renderer has no use
        // for it and must never hold it, not even in memory.
        if (currentSession && currentSession.account_credential) {
          const { account_credential, ...forRenderer } = currentSession;
          sendToWindow(win, "session-state", forRenderer);
        } else {
          sendToWindow(win, "session-state", currentSession);
        }

        /* The self-started session just went live — launch the title the
           customer picked when they hit Start, so they land straight in the
           game rather than having to find and click it again. */
        if (!wasRunning && currentSession && currentSession.status === 'active' && pendingSelfStartGame) {
          const game = pendingSelfStartGame;
          pendingSelfStartGame = null;
          launchGame(game);
        } else if (!currentSession) {
          pendingSelfStartGame = null;
        }

        // The station just freed up — if an update finished downloading
        // while a customer was playing, this is the moment updater.js was
        // built to wait for.
        if (wasRunning && !currentSession) updater.onStationIdle();
      }

      /* The console found this station running an older build than what
         ManagerXP has published (see checkForSoftwareUpdate). feedUrl is
         derived by dropping the filename from the direct download link —
         electron-updater's generic provider fetches "<feedUrl>/latest.yml"
         itself, which the release pipeline uploads to the same tag as the
         installer. */
      if (msg.type === "UPDATE_AVAILABLE") {
        const url = msg.download_url || "";
        const feedUrl = url.slice(0, url.lastIndexOf("/"));
        if (feedUrl) {
          log(`Update available: v${msg.version} — downloading in the background`);
          updater.download({ feedUrl, targetVersion: msg.version });
        }
      }

      /* The games this station may offer. Held so a portal that mounts after
         the push still gets them (via get-games), and forwarded so one already
         open updates live. */
      if (msg.type === "GAMES_LIST") {
        currentGames = Array.isArray(msg.games) ? msg.games : [];
        log(`Games list: ${currentGames.length} titles`);
        sendToWindow(win, "games-list", currentGames);
      }

      /* What a logged-in customer can start for themself — this station's
         games and this café's prices, sent whether or not a session is
         already running (unlike GAMES_LIST above). */
      if (msg.type === "START_OPTIONS") {
        log(`Start options: ${(msg.games || []).length} games, ${(msg.prices || []).length} prices`);
        sendToWindow(win, "start-options", { games: msg.games || [], prices: msg.prices || [] });
      }

      /* The self-start this station asked for could not begin — insufficient
         balance, the station taken by someone else, etc. */
      if (msg.type === "START_SESSION_FAILED") {
        log(`Self-start failed: ${msg.message || ""}`);
        sendToWindow(win, "start-session-failed", { message: msg.message || "Could not start the session" });
      }

      /* The console extended this station's session. Grow every open timer
         card by the added minutes so the visible clock matches the block the
         customer just bought. */
      if (msg.type === "EXTEND_TIMER") {
        const minutes = Number(msg.minutes) || 0;
        log(`Extend timer by ${minutes} min`);
        runningProcesses.forEach((info) => {
          if (info.timerCardWin && !info.timerCardWin.isDestroyed()) {
            info.timerCardWin.webContents.send("extend-timer", { minutes });
          }
        });
        // Mirror to the portal's own countdown too.
        sendToWindow(win, "extend-timer", { minutes });
      }


      if (msg.type === "LAUNCH_APP") {
        log(`Launching: ${msg.appName}`);
        if (msg.appPath) {
          // Tell the portal a launch started so it can show its transition.
          // Purely a UI notification; the launch itself is unchanged.
          sendToWindow(win, "app-launching", { appName: msg.appName });

          const child = exec(`"${msg.appPath}"`, (err) => {
            if (err) {
              log(`Error launching app: ${err.message}`);
              sendToWindow(win, "app-launch-failed", { appName: msg.appName, error: err.message });
            } else {
              log(`Successfully launched: ${msg.appName}`);
            }
          });
          
          // Store the process info with timer card if timer is set
          if (child.pid) {
            const processInfo = {
              pid: child.pid,
              appPath: msg.appPath,
              timerCardWin: null
            };
            
            // Create timer card if timer is set
            if (msg.timerMinutes && msg.timerMinutes > 0) {
              processInfo.timerCardWin = createTimerCard(msg.appName, msg.timerMinutes, sessionBufferRemainingSeconds());
            }
            
            runningProcesses.set(msg.appName, processInfo);
            log(`Tracking process PID: ${child.pid}${msg.timerMinutes ? ` with ${msg.timerMinutes} min timer` : ''}`);
          }
        }
      }
      
      /* The console asked which launchers are here — re-detected rather than
         answered from memory, so installing Steam and clicking refresh shows
         it without restarting the station. */
      if (msg.type === "GET_LAUNCHERS") {
        reportLaunchers(ws);
      }

      /* The session on this station ended and the café wants the machine put
         back to a clean state. The console sends the configuration rather than
         the station holding its own copy, so changing the policy takes effect
         on the next session without touching the stations. */
      if (msg.type === "SESSION_CLEANUP") {
        const games = Array.isArray(msg.games) ? msg.games : currentGames;
        runSessionCleanup(msg.config, games)
          .then(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "CLEANUP_DONE", simId: SIM_ID }));
            }
          })
          .catch((e) => log(`Cleanup failed: ${e.message}`));
      }

      if (msg.type === "REFRESH_APPS") {
        log("Refreshing apps list...");
        try {
          // Force fresh fetch for refresh
          cachedApps = null;
          const apps = await getInstalledApps();
          ws.send(JSON.stringify({
            type: "APPS_LIST",
            simId: SIM_ID,
            apps: apps
          }));
          log("Apps list refreshed and sent");
        } catch (err) {
          log(`Error refreshing apps: ${err.message}`);
        }
      }
      
      if (msg.type === "CLOSE_APP") {
        log(`Closing application: ${msg.appName}`);
        closeApplication(msg.appName);
      }
      
      // The console has always sent HEARTBEAT_PING and this client has always
      // ignored it. Answering closes the round trip, which is the only honest
      // way to measure network latency to this station.
      if (msg.type === "HEARTBEAT_PING") {
        ws.send(JSON.stringify({ type: "HEARTBEAT_PONG", simId: SIM_ID }));
      }

      // The console can ask for a sample out of band — on opening a station
      // panel, say — without waiting for the next scheduled push.
      if (msg.type === "GET_TELEMETRY") {
        await pushTelemetry(ws);
      }

      // The console sets the cadence, so the sample rate can be tuned from
      // Settings without touching the client.
      if (msg.type === "TELEMETRY_CONFIG") {
        startTelemetry(ws, msg.sample_seconds);
      }

      if (msg.type === "GET_MAC_ADDRESS") {
        const macAddress = getSystemMacAddress();
        log(`Sending MAC address: ${macAddress}`);
        ws.send(JSON.stringify({
          type: "MAC_ADDRESS",
          macAddress: macAddress
        }));
      }
      
      if (msg.type === "GET_SOFTWARE_LIST") {
        log("Fetching software list...");
        try {
          const startTime = Date.now();
          // Force fresh fetch, bypass cache for software list requests
          cachedApps = null;
          const apps = await getInstalledApps();
          const duration = Date.now() - startTime;
          log(`Fetched ${apps.length} apps in ${duration}ms`);
          
          const software = apps.map(app => ({
            name: app.name,
            version: app.version,
            path: app.launch
          }));
          
          const message = {
            type: "SOFTWARE_LIST",
            simId: SIM_ID,
            software: software,
            count: software.length
          };
          
          ws.send(JSON.stringify(message));
          log(`✅ Software list sent: ${software.length} items`);
        } catch (err) {
          log(`❌ Error fetching software: ${err.message}`);
          ws.send(JSON.stringify({
            type: "SOFTWARE_LIST",
            simId: SIM_ID,
            software: [],
            error: err.message
          }));
        }
      }
    });

    ws.on("close", () => {
      log("Disconnected from server. Waiting for reconnection...");
      updateStatus("DISCONNECTED");
      serverConnection = null;
      // Nothing to push to, so stop spending cycles sampling.
      stopTelemetry();
    });

    ws.on("error", (err) => {
      log(`WebSocket error: ${err.message}`);
      updateStatus("DISCONNECTED");
    });
  });

  wss.on("error", (err) => {
    log(`Server error: ${err.message}`);
  });

  log(`WebSocket server listening on ws://0.0.0.0:${CLIENT_PORT}`);
}

function closeApplication(appName) {
  const processInfo = runningProcesses.get(appName);
  
  if (processInfo) {
    log(`Closing tracked application: ${appName}`);
    
    // Close timer card if exists
    if (processInfo.timerCardWin && !processInfo.timerCardWin.isDestroyed()) {
      processInfo.timerCardWin.close();
      log(`Timer card closed for: ${appName}`);
    }
    
    // Remove from tracking first to avoid duplicate close attempts
    runningProcesses.delete(appName);

    // Let the portal show its session-ended screen. Notification only.
    sendToWindow(win, "app-closed", { appName: appName });

    // Close the actual application
    closeByExecutableName(processInfo.appPath, appName);
  } else {
    log(`No tracked process info for ${appName}, attempting close by name...`);
    closeByExecutableName(null, appName);
  }
}

function deriveExeName(appPath, appName) {
  if (appPath) {
    const pathParts = appPath.split(/[\\/]/);
    const executable = pathParts[pathParts.length - 1];
    return executable.replace(/\.exe$/i, '');
  }
  // No path on record — take the first word of the display name as a guess.
  return appName.split(' ')[0];
}

function closeByExecutableName(appPath, appName) {
  const exeName = deriveExeName(appPath, appName);
  log(`Closing by executable name: ${exeName}`);

  // Use taskkill for reliable closing
  const command = `taskkill /F /IM "${exeName}.exe" /T`;
  
  exec(command, (err, stdout, stderr) => {
    if (err) {
      // taskkill couldn't find the process or failed
      if (stderr && stderr.includes('not found')) {
        log(`No running process found for: ${exeName}`);
      } else {
        log(`Taskkill failed for ${exeName}, trying PowerShell...`);
        
        // Fallback to PowerShell
        const psCommand = `powershell -Command "Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Stop-Process -Force; if ($?) { Write-Output 'Success' } else { Write-Output 'Not found' }"`;
        
        exec(psCommand, (psErr, psStdout, psStderr) => {
          if (psStdout && psStdout.includes('Success')) {
            log(`Successfully closed ${appName} via PowerShell`);
          } else {
            log(`Could not close ${appName}: Process not found`);
          }
        });
      }
    } else {
      // Success - taskkill worked
      const match = stdout.match(/SUCCESS/i);
      if (match) {
        log(`Successfully closed ${appName} (taskkill)`);
      }
    }
  });
}

/*
 * Nothing here ever hears about a game closing on its own — a player quitting
 * normally, a crash, an alt-F4 — because closeApplication() only runs when
 * something on our side decides to end it. Left unwatched, runningProcesses
 * and its timer card sit there forever and the portal never learns the
 * station is free again. Polling by executable name (rather than the PID
 * exec() handed back) because many launches hand off to a second process —
 * the PID we have is often already gone the moment the real game starts.
 */
function pollRunningProcesses() {
  runningProcesses.forEach((info, appName) => {
    const exeName = deriveExeName(info.appPath, appName);
    exec(`tasklist /FI "IMAGENAME eq ${exeName}.exe" /NH`, (err, stdout) => {
      if (err) return;   // a failed check must never look like "it closed"
      const stillRunning = stdout && stdout.toLowerCase().includes(exeName.toLowerCase());
      if (stillRunning) return;

      log(`${appName} is no longer running (detected by poll)`);
      const current = runningProcesses.get(appName);
      if (!current) return;   // already handled by an explicit close in the meantime
      if (current.timerCardWin && !current.timerCardWin.isDestroyed()) current.timerCardWin.close();
      runningProcesses.delete(appName);
      sendToWindow(win, "app-closed", { appName });
    });
  });
}
setInterval(pollRunningProcesses, 8000);

app.whenReady().then(() => {
  // Get local IP on startup
  LOCAL_IP = getLocalIPAddress();

  /* Read the cached staff PIN before the window exists, so the escape hatch
     works on a station that starts up with the café's network down — which is
     one of the situations it is there for. The console refreshes it over the
     socket as soon as one is available. */
  loadUnlockPin();

  createWindow();

  /* Updates only ever reach this station because the console pushed one
     (see the UPDATE_AVAILABLE handler below) — this station never asks the
     backend itself. autoApply is on because the whole point of updater.js's
     session-aware design is to install itself the moment the station is
     free; leaving it off would make this no different from the console's
     own do-nothing visibility badge. */
  updater.init({ log: log, isSessionActive: () => !!currentSession });
  updater.setAutoApply(true);

  /*
   * The same staff toggle, system-wide.
   *
   * Registered as a global shortcut as well as a window one because the
   * window route needs focus, and the situations this hatch exists for are
   * exactly the ones where focus is elsewhere — the client minimised, or a
   * café running the console on the same machine as a station.
   *
   * Failing to register is not fatal: another application may already own
   * the combination. Saying so in the log beats a shortcut that silently
   * does nothing.
   */
  const combo = 'Control+Alt+Shift+Q';
  const registered = globalShortcut.register(combo, () => toggleKioskLock('the system shortcut'));
  const shortcutNote = registered
    ? `[Kiosk] Staff shortcut ${combo} is active (works even without focus).`
    : `[Kiosk] Could not register ${combo} — another application already holds it. ` +
      `The same keys still work while the client window has focus.`;
  /* console as well as the in-app log: `log()` only reaches the renderer, and
     whether this registered is the first thing anyone debugging the hatch
     needs to know — including when the window is not up yet. */
  console.log(shortcutNote);
  log(shortcutNote);

  /* kioskLocked defaults to true from module load, before any toggle ever
     fires — claim the escape-route shortcuts now so a station is sealed
     from its very first frame, not only after the first PIN interaction. */
  syncKioskShortcuts();

  listen();
  
  // Start broadcasting PC info every 10 seconds
  BROADCAST_INTERVAL = setInterval(() => {
    broadcastPCInfo();
  }, 10000);
  
  // Initial broadcast immediately
  broadcastPCInfo();
});

// Stop the discovery broadcast on the way out so it cannot fire against
// windows that are already gone.
/* A quit that reached this point is deliberate — the OS is shutting down, or
   the app asked to go. Release the kiosk guard so the window can actually
   close rather than refusing and hanging the shutdown. */
app.on('before-quit', () => {
  allowQuit = true;
  // Hand the combination back to the OS, or it stays claimed for the life of
  // the session and a relaunched client cannot register it again.
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  if (BROADCAST_INTERVAL) {
    clearInterval(BROADCAST_INTERVAL);
    BROADCAST_INTERVAL = null;
  }
  stopTelemetry();
});

app.on('window-all-closed', () => {
  app.quit();
});

/* ---- HEARTBEAT ---- */
setInterval(() => {
  if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
    serverConnection.send(JSON.stringify({ type: "HEARTBEAT" }));
  }
}, 5000);
