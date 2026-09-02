<#
  Reads and sets the default playback device's master volume via Windows'
  Core Audio API (IAudioEndpointVolume), reached through .NET COM interop
  defined inline — no PowerShell module install, no native Node addon, no
  binary to bundle or code-sign. Works on every Windows 7+ box unmodified.

  Every actual interface call lives inside the compiled C# helper below, not
  in the PowerShell body: IAudioEndpointVolume is a raw vtable COM interface,
  not an IDispatch automation object, and PowerShell's `$obj.Method()` late
  binding only resolves IDispatch members — calling it from script code fails
  with "does not contain a method named ..." even though the interface is
  correctly defined. C# compiles a direct vtable call instead, which is the
  actual fix, not a workaround.

  Usage:
    volume.ps1 -Action get                # -> {"level":42,"muted":false}
    volume.ps1 -Action set -Level 60       # sets level to 60 (0-100)
    volume.ps1 -Action mute
    volume.ps1 -Action unmute
    volume.ps1 -Action toggle-mute
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('get', 'set', 'mute', 'unmute', 'toggle-mute')]
  [string]$Action,
  [double]$Level
)

$ErrorActionPreference = 'Stop'

$sig = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int NotImpl1();
  int NotImpl2();
  int GetChannelCount();
  int SetMasterVolumeLevel(float level, Guid ctx);
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint idx, float level, Guid ctx);
  int SetChannelVolumeLevelScalar(uint idx, float level, Guid ctx);
  int GetChannelVolumeLevel(uint idx, out float level);
  int GetChannelVolumeLevelScalar(uint idx, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  int GetVolumeStepInfo(out uint step, out uint stepCount);
  int VolumeStepUp(Guid ctx);
  int VolumeStepDown(Guid ctx);
  int QueryHardwareSupport(out uint support);
  int GetVolumeRange(out float min, out float max, out float increment);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, out IAudioEndpointVolume epv);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

// Every real vtable call happens in here, compiled — see the file header for why.
public static class AudioEndpoint {
  static IAudioEndpointVolume Vol() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    // dataFlow 0 = eRender (playback), role 1 = eMultimedia
    enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume epv;
    dev.Activate(ref iid, 23, IntPtr.Zero, out epv);
    return epv;
  }

  public static int GetLevel() {
    float level;
    Vol().GetMasterVolumeLevelScalar(out level);
    return (int)Math.Round(level * 100);
  }

  public static bool GetMuted() {
    bool muted;
    Vol().GetMute(out muted);
    return muted;
  }

  public static void SetLevel(double level) {
    double clamped = Math.Max(0, Math.Min(100, level));
    Vol().SetMasterVolumeLevelScalar((float)(clamped / 100.0), Guid.Empty);
  }

  public static void SetMuted(bool mute) {
    Vol().SetMute(mute, Guid.Empty);
  }
}
'@


<#
  Add-Type -TypeDefinition compiles this C# from scratch via csc.exe on every
  single invocation — measured at 1-1.8 SECONDS per call, almost entirely
  compile time, not the COM calls themselves or PowerShell's own startup.
  That is the actual "laggy slider": every tick that reaches the OS was
  taking the better part of two seconds to apply.

  Compiling once to a cached assembly and loading that thereafter (a plain
  file load, no compiler invocation) turns each call into tens of
  milliseconds instead. Cached under LOCALAPPDATA rather than next to this
  script: a kiosk build installed under Program Files is not writable by a
  standard user account, and this must not silently fail volume control on
  a machine set up that way.
#>
$cacheDir = Join-Path $env:LOCALAPPDATA 'CafeXP'
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
$dllPath = Join-Path $cacheDir 'AudioEndpoint.dll'

if (-not (Test-Path $dllPath)) {
  # -OutputAssembly only writes the file — it does not also register the
  # types in this session, so the explicit -Path load below is still needed
  # after this, first run or not.
  Add-Type -TypeDefinition $sig -Language CSharp -OutputAssembly $dllPath
}
try {
  Add-Type -Path $dllPath
} catch {
  # A DLL from a different PowerShell/.NET build, or otherwise unusable —
  # recompile rather than fail every call from here on.
  Remove-Item -Force $dllPath -ErrorAction SilentlyContinue
  Add-Type -TypeDefinition $sig -Language CSharp -OutputAssembly $dllPath
  Add-Type -Path $dllPath
}

function Write-State {
  $obj = @{ level = [AudioEndpoint]::GetLevel(); muted = [AudioEndpoint]::GetMuted() }
  Write-Output ($obj | ConvertTo-Json -Compress)
}

switch ($Action) {
  'get' { Write-State }
  'set' { [AudioEndpoint]::SetLevel($Level); Write-State }
  'mute' { [AudioEndpoint]::SetMuted($true); Write-State }
  'unmute' { [AudioEndpoint]::SetMuted($false); Write-State }
  'toggle-mute' { [AudioEndpoint]::SetMuted(-not [AudioEndpoint]::GetMuted()); Write-State }
}
