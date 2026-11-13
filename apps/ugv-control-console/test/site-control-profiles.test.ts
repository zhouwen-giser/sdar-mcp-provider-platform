import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteControlConsole } from "../web/SiteControlConsole.js";

function render(profile: string) {
  return renderToStaticMarkup(
    createElement(SiteControlConsole, {
      device: {
        resourceId: "vehicle:ugv",
        tools: [{ _meta: { "io.sdar/ugvZmq": { catalogProfile: profile } } }],
        data: {},
      },
      session: {},
      commands: [],
      tasks: [],
      refresh: () => undefined,
      renderTask: () => null,
    }),
  );
}

describe("published control form versions", () => {
  it.each([
    "zmq_v1_4_0_site_control_14",
    "zmq_v1_5_0_site_control_15",
    "zmq_v1_5_1_site_control_15",
    "zmq_v1_5_2_site_control_15",
  ])("keeps km/h defaults and the simulation view entry for %s", (profile) => {
    const html = render(profile);
    expect(html).toContain("速度上限（km/h）");
    expect(html).toContain('value="60"');
    expect(html).toContain('value="simulation_adjust_view"');
    expect(html).toContain("仿真视场（专属相机）");
  });

  it("preserves the older 1.2 form contract", () => {
    const html = render("zmq_v1_2_0_site_control_13");
    expect(html).toContain("速度上限（m/s）");
    expect(html).not.toContain('value="simulation_adjust_view"');
  });
});
