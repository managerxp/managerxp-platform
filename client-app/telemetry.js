/* ==========================================================================
   CafeXP Client — Hardware telemetry
   Samples this machine's real counters and hands them to the caller, which
   pushes them to the admin console over the WebSocket that already exists.

   Two rules shape everything here:

   1. Nothing is invented. A counter this machine will not report arrives as
      null and stays null all the way to the database. A zero would read as a
      healthy idle machine, which is worse than an honest gap.

   2. This runs on a gaming PC while someone is playing. CPU and memory come
      from `os`, which is a few microseconds of arithmetic. Disk and GPU need
      a shell out to PowerShell, so disk is refreshed once a minute and GPU
      once per process — never on the fast path.
   ========================================================================== */
const os = require("os");
const { exec } = require("child_process");

const DISK_REFRESH_MS = 60_000;

// Cumulative CPU ticks from the previous sample. Utilisation is the change
// between two readings, so the very first sample has nothing to compare with.
let previousCpu = null;

let diskCache = { value: null, at: 0 };
let gpuCache = null;           // resolved once; a GPU does not change mid-shift
let gpuPending = null;

/** Total and idle jiffies across all cores, right now. */
function cpuTicks() {
  let idle = 0;
  let total = 0;
  os.cpus().forEach((core) => {
    Object.keys(core.times).forEach((kind) => { total += core.times[kind]; });
    idle += core.times.idle;
  });
  return { idle, total };
}

/**
 * CPU utilisation since the previous call, as a percentage.
 * Returns null on the first call and whenever the counters have not moved —
 * dividing by a zero delta would produce a number with no meaning.
 */
function cpuPercent() {
  const now = cpuTicks();
  const previous = previousCpu;
  previousCpu = now;

  if (!previous) return null;

  const totalDelta = now.total - previous.total;
  const idleDelta = now.idle - previous.idle;
  if (totalDelta <= 0) return null;

  const used = 100 * (1 - idleDelta / totalDelta);
  return Math.min(100, Math.max(0, Number(used.toFixed(2))));
}

/** Run a PowerShell one-liner and resolve its parsed JSON, or null. */
function powershellJson(script, timeoutMs) {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script}"`,
      { timeout: timeoutMs || 8000, windowsHide: true, maxBuffer: 1024 * 512 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) { resolve(null); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      }
    );
  });
}

/**
 * Free and total bytes on the system drive. Windows only — on anything else
 * this resolves null rather than guessing, and the column stays empty.
 */
async function diskUsage() {
  if (process.platform !== "win32") return null;
  if (diskCache.value && Date.now() - diskCache.at < DISK_REFRESH_MS) return diskCache.value;

  const drive = (process.env.SystemDrive || "C:").replace(/\\$/, "");
  const parsed = await powershellJson(
    `Get-CimInstance Win32_LogicalDisk -Filter \\\"DeviceID='${drive}'\\\" | ` +
    "Select-Object Size,FreeSpace | ConvertTo-Json -Compress"
  );

  if (!parsed || !parsed.Size) return diskCache.value;

  const total = Number(parsed.Size);
  const free = Number(parsed.FreeSpace);
  if (!Number.isFinite(total) || total <= 0) return diskCache.value;

  diskCache = {
    at: Date.now(),
    value: {
      total_bytes: total,
      free_bytes: Number.isFinite(free) ? free : null,
      percent: Number.isFinite(free)
        ? Number((100 * (1 - free / total)).toFixed(2))
        : null
    }
  };
  return diskCache.value;
}

/**
 * GPU name and video memory. WMI reports these reliably; it does not report
 * GPU *utilisation*, so that stays unmeasured rather than faked.
 *
 * AdapterRAM is a signed 32-bit field, so anything at or above 4 GB comes
 * back wrong — it is discarded rather than reported as a small number.
 */
async function gpuInfo() {
  if (process.platform !== "win32") return null;
  if (gpuCache !== null) return gpuCache;
  if (gpuPending) return gpuPending;

  gpuPending = powershellJson(
    "Get-CimInstance Win32_VideoController | Select-Object -First 1 " +
    "Name,AdapterRAM | ConvertTo-Json -Compress"
  ).then((parsed) => {
    const ram = Number(parsed && parsed.AdapterRAM);
    gpuCache = parsed && parsed.Name
      ? {
          name: String(parsed.Name),
          vram_bytes: Number.isFinite(ram) && ram > 0 && ram < 4294967295 ? ram : null
        }
      : null;
    gpuPending = null;
    return gpuCache;
  });

  return gpuPending;
}

/**
 * Package temperature in Celsius, when the board exposes it.
 *
 * Most consumer machines do not: the WMI class needs a driver that many
 * vendors do not ship, and it often needs elevation. A miss is expected and
 * is reported as null, not as a cool machine.
 */
async function temperature() {
  if (process.platform !== "win32") return null;

  const parsed = await powershellJson(
    "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature " +
    "-ErrorAction SilentlyContinue | Select-Object -First 1 CurrentTemperature | " +
    "ConvertTo-Json -Compress",
    4000
  );

  const raw = Number(parsed && parsed.CurrentTemperature);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  // WMI reports tenths of a Kelvin.
  const celsius = raw / 10 - 273.15;
  return celsius > -50 && celsius < 150 ? Number(celsius.toFixed(2)) : null;
}

/**
 * One complete sample of this machine.
 *
 * `extra` carries what the caller knows and this module does not — the
 * station's name and which application it launched.
 */
async function sample(extra) {
  const context = extra || {};
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus();

  // Disk and temperature are allowed to fail; the rest of the sample is still
  // worth sending, so neither is awaited without a fallback.
  const [disk, gpu, temp] = await Promise.all([
    diskUsage().catch(() => null),
    gpuInfo().catch(() => null),
    temperature().catch(() => null)
  ]);

  return {
    pc_name: context.pc_name || os.hostname(),
    cpu_percent: cpuPercent(),
    cpu_model: cpus.length ? String(cpus[0].model).trim() : null,
    cpu_cores: cpus.length || null,
    mem_total_bytes: totalMem,
    mem_used_bytes: usedMem,
    mem_percent: totalMem > 0 ? Number((100 * (usedMem / totalMem)).toFixed(2)) : null,
    disk_total_bytes: disk ? disk.total_bytes : null,
    disk_free_bytes: disk ? disk.free_bytes : null,
    disk_percent: disk ? disk.percent : null,
    gpu_name: gpu ? gpu.name : null,
    gpu_vram_bytes: gpu ? gpu.vram_bytes : null,
    temperature_c: temp,
    uptime_seconds: Math.round(os.uptime()),
    platform: process.platform,
    os_release: os.release(),
    running_app: context.running_app || null,
    sampled_at: new Date().toISOString()
  };
}

/**
 * Prime the CPU counter so the first real sample has a baseline to diff
 * against, instead of reporting null.
 */
function prime() {
  previousCpu = cpuTicks();
  // Warm the GPU lookup too, so no sample ever waits on it.
  gpuInfo().catch(() => {});
}

module.exports = { sample, prime };
