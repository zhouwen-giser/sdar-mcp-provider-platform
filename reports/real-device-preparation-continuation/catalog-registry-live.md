# Live Catalog and Registry

Evidence class: `real`.

PMS published Catalog revision 1 for each Provider and Registry revision 3 for `home-lab`. The Registry `latest` and `bootstrap` responses returned the same checksum and ETag. Both Provider IDs are present, and the redacted document contains neither secret keys nor Entity ID keys. The two Runtime `tools/list` responses match their active Catalog tool names. Live `history`, `diff`, `If-None-Match` (304), and initial `watch` event checks also passed.

`watch` is recorded only as a revision/checksum hint; `latest` remains the authority after a hint.
