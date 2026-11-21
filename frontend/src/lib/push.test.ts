import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ default: { get: vi.fn(), post: vi.fn(), defaults: {} } }));

import { pushAvailability } from "./push";

function stubBrowser({
  secure = true,
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130",
  platform = "MacIntel",
  maxTouchPoints = 0,
  standalone = false,
  push = true,
} = {}) {
  vi.stubGlobal("navigator", {
    userAgent,
    platform,
    maxTouchPoints,
    standalone,
    ...(push ? { serviceWorker: {} } : {}),
  });
  vi.stubGlobal("window", {
    isSecureContext: secure,
    matchMedia: () => ({ matches: standalone }),
    ...(push ? { PushManager: class {}, Notification: class {} } : {}),
  });
}

describe("pushAvailability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is available in a desktop browser over https", () => {
    stubBrowser();
    expect(pushAvailability()).toBe("available");
  });

  it("needs https", () => {
    stubBrowser({ secure: false });
    expect(pushAvailability()).toBe("insecure");
  });

  it("asks iPhone users to add the app to the home screen first", () => {
    stubBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone" });
    expect(pushAvailability()).toBe("ios-needs-install");
  });

  it("treats an iPad (which reports itself as a Mac) the same way", () => {
    stubBrowser({ maxTouchPoints: 5 });
    expect(pushAvailability()).toBe("ios-needs-install");
  });

  it("works in the installed iPhone app", () => {
    stubBrowser({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      standalone: true,
    });
    expect(pushAvailability()).toBe("available");
  });

  it("reports browsers without Web Push", () => {
    stubBrowser({ push: false });
    expect(pushAvailability()).toBe("unsupported");
  });
});
