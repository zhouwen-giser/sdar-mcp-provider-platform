# Live Catalog and Registry

Evidence class: `real`.

PMS published Catalog revision 1 for each Provider and Registry revision 3 for `home-lab`. The Registry `latest` and `bootstrap` responses returned the same checksum and ETag. Both Provider IDs are present, and the redacted document contains neither secret keys nor Entity ID keys. The two Runtime `tools/list` responses match their active Catalog tool names.

`watch` was not used as an authority; its status remains `unverified`.
