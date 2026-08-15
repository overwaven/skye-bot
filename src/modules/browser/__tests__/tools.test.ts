import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../../../core/tenant.js";
import type { BrowserService } from "../service.js";
import { browserTools } from "../tools.js";

const tenant: TenantContext = { chatId: 123, chatType: "private", userId: 456 };

function service(): BrowserService {
  return {
    timeoutMs: 30_000,
    maxAgentSteps: 25,
    action: vi.fn().mockResolvedValue("ok"),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserService;
}

describe("browser tools", () => {
  it("exposes low-level, autonomous, and lifecycle actions", () => {
    expect(browserTools(service()).map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_get_state",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_go_back",
      "browser_list_tabs",
      "browser_switch_tab",
      "browser_close_tab",
      "browser_task",
      "browser_close",
    ]);
  });

  it("forwards click confirmation", async () => {
    const browser = service();
    const click = browserTools(browser).find((tool) => tool.name === "browser_click")!;
    await click.execute({ index: 7, confirmed: true }, tenant);
    expect(browser.action).toHaveBeenCalledWith(
      tenant,
      "click",
      { index: 7, confirmed: true },
      undefined
    );
  });

  it("caps autonomous tasks at the configured step limit", async () => {
    const browser = service();
    const task = browserTools(browser).find((tool) => tool.name === "browser_task")!;
    await task.execute({ task: "summarize example.com", max_steps: 500 }, tenant);
    expect(browser.action).toHaveBeenCalledWith(
      tenant,
      "task",
      { task: "summarize example.com", max_steps: 25, confirmed: false },
      undefined
    );
  });
});
