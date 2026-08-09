# Known limitations

- The latest read-only Home Assistant preflight passed for all configured resources.
- The explicit climate power-on operation was not separately qualified; HVAC mode, target temperature, and safe power-off restoration were qualified.
- Real in-flight Adapter/Runtime restart recovery and real PMS/HA outage recovery remain unverified.
- REST 200 without observed target state was not injected against a real device.
- Optional light brightness was read and capability-checked but not side-effect qualified.
- Windows PM2 pidusage diagnostics report WMI ManagementException errors although Runtime readiness and task paths passed.
- The Worker PM2 gate initially reproduced three identical Mock Adapter connection-refused attempts; a bounded startup-race fix was then verified with the full production-path gate.
- The first current verify:v2 attempt failed before container work because sandboxed Docker access was denied; the exact command subsequently passed with authorized Docker access.
- Protected-branch GitHub checks and review state are not yet fully passed; main merge readiness remains independent and false until they are.
- No SDAR Agent Runtime was connected, and no public deployment, merge, tag, or release was performed.

Readiness: **NO**.
