import process from "node:process";
import { clearInterval, setInterval } from "node:timers";

const timer = setInterval(() => undefined, 1_000);

function shutdown() {
  clearInterval(timer);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
