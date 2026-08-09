# Known limitations

- The explicit climate power-on operation was not separately qualified; the live run qualified HVAC mode, temperature, and safe power-off restoration.
- Real in-flight Adapter/Runtime restart, REST-200-without-state-change, and complete Home Assistant/PMS outage recovery remain unverified.
- The optional light brightness operation was not side-effect qualified and remains outside the first-version baseline.
- Windows PM2 pidusage diagnostics report WMI ManagementException errors although Runtime readiness and task paths passed.
- Readiness is `false`; no SDAR Agent Runtime was connected.
- Reports contain no credentials, Authorization headers, or internal Home Assistant Entity IDs.
