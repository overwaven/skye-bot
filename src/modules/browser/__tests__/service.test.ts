import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../../../core/tenant.js";
import {
  assertSafeBrowserUrl,
  browserSessionId,
  BrowserService,
  type BrowserServiceOptions,
} from "../service.js";

const tenant: TenantContext = { chatId: 123, chatType: "private", threadId: 9, userId: 456 };

function options(fetchImpl: typeof fetch): BrowserServiceOptions {
  return {
    enabled: true,
    workerUrl: "http://browser-worker:8765",
    workerToken: "test-token",
    requestTimeoutMs: 30_000,
    maxOutputChars: 20_000,
    maxScreenshotBytes: 1024 * 1024,
    maxAgentSteps: 25,
    viewportWidth: 1440,
    viewportHeight: 900,
    allowedDomains: [],
    prohibitedDomains: ["localhost"],
    fetchImpl,
  };
}

describe("BrowserService", () => {
  it("uses an opaque stable session id", () => {
    expect(browserSessionId(tenant)).toMatch(/^[a-f0-9]{32}$/);
    expect(browserSessionId(tenant)).toBe(browserSessionId(tenant));
    expect(browserSessionId(tenant)).not.toContain("123");
  });

  it("blocks local and private navigation", () => {
    expect(() => assertSafeBrowserUrl("http://localhost/admin")).toThrow();
    expect(() => assertSafeBrowserUrl("http://127.0.0.1/admin")).toThrow();
    expect(() => assertSafeBrowserUrl("http://192.168.1.10/")).toThrow();
    expect(() => assertSafeBrowserUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeBrowserUrl("https://example.com/path")).not.toThrow();
  });

  it("sends authenticated action requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { title: "Example" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const service = new BrowserService(options(fetchMock as unknown as typeof fetch));
    const result = await service.action(tenant, "navigate", { url: "https://example.com" });

    expect(result).toContain("Example");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain(`/v1/sessions/${browserSessionId(tenant)}/action`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(init.body)).action).toBe("navigate");
  });

  it("decodes screenshots and enforces the byte limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          screenshot_base64: Buffer.from("png-data").toString("base64"),
          mime_type: "image/png",
          metadata: { url: "https://example.com" },
        }),
        { status: 200 }
      )
    );
    const screenshot = await new BrowserService(
      options(fetchMock as unknown as typeof fetch)
    ).screenshot(tenant, false);
    expect(screenshot.buffer.toString()).toBe("png-data");
    expect(screenshot.metadata.url).toBe("https://example.com");
  });
});
