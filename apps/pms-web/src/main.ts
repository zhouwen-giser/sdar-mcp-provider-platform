import { PmsWebApplication } from "./app.js";
import { PmsWebApiClient } from "./api-client.js";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("PMS_WEB_ROOT_MISSING");
const apiBase = document.querySelector<HTMLMetaElement>('meta[name="pms-api-base"]')?.content ?? "";
const api = new PmsWebApiClient({
  baseUrl: apiBase,
  authorization: () => sessionStorage.getItem("pms.management.authorization") ?? undefined,
  actorId: () => sessionStorage.getItem("pms.management.actorId") ?? undefined,
});
new PmsWebApplication(root, api).start();
