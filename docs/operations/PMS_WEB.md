# PMS Web operations

The Platform V0.1 Web image is `sdar/pms-web:0.1.0-rc`. It contains the compiled JavaScript
application, HTML, CSS, and a repository-owned minimal static server. The final container runs as
UID 1000 (`node`) with root-owned, read-only application files.

## Configuration

| Variable           | Default     | Purpose                                                     |
| ------------------ | ----------- | ----------------------------------------------------------- |
| `PMS_WEB_HOST`     | `0.0.0.0`   | Static server bind host                                     |
| `PMS_WEB_PORT`     | `8080`      | Static server port                                          |
| `PMS_WEB_API_BASE` | same origin | Absolute HTTP(S) PMS API base injected into the served HTML |

The server exposes `/health/live` and `/health/ready`, serves `/assets/main.js` and `/styles.css`,
and returns `index.html` for extensionless SPA routes. Missing asset paths return `404`. Responses
set a restrictive Content Security Policy, `nosniff`, deny framing, isolate the opener, and suppress
referrer information. HTML is never cached; static assets use a short public cache.

`PMS_WEB_API_BASE` is runtime configuration, not a build argument. It must not contain user info or
credentials. Management authorization remains session-scoped browser state and is never included
in the image or initial HTML.

Build and test:

```bash
pnpm --filter @sdar/pms-web test
pnpm --filter @sdar/pms-web build
docker build --target pms-web --build-arg VCS_REF="$(git rev-parse HEAD)" \
  -t sdar/pms-web:0.1.0-rc .
```
