# Known Limitations

1. Repository `node_modules` are unavailable, so dependency-backed gates remain local validation.
2. Work Node.js `v24.14.0` does not match the repository `>=22 <23` engine.
3. Work pnpm `11.7.0` does not match the declared `11.13.1`.
4. The supplied frozen ZIP's mandatory lock hashes pass, but its auxiliary
   `contractManifestSha256` does not match `CONTRACT.md`. Goal 07 explicitly gates only status,
   OpenAPI, Schema Bundle, Endpoint Source Map, and Error Source Map, so this is reported without
   editing or refreezing the contract.
5. The final candidate ZIP excludes every `dist` directory as required. Local validation must
   restore the supplied frozen Bundle before running the contract-lock test.

