import { describe, expect, it } from "vitest";

import { betterAuthAdapter, type BetterAuthInstance } from "../src/index";

function instance(overrides: Partial<BetterAuthInstance> = {}): {
  auth: BetterAuthInstance;
  calls: { handler: Request[]; getSession: Headers[] };
} {
  const calls = { handler: [] as Request[], getSession: [] as Headers[] };
  const auth: BetterAuthInstance = {
    api: {
      getSession: async ({ headers }) => {
        calls.getSession.push(headers);
        const email = headers.get("x-user");
        return email === null ? null : { user: { id: `id:${email}`, email } };
      },
    },
    handler: async (request) => {
      calls.handler.push(request);
      return Response.json({ handled: true });
    },
    ...overrides,
  };
  return { auth, calls };
}

describe("betterAuthAdapter", () => {
  it("maps a session to an identity", async () => {
    const { auth } = instance();
    const adapter = betterAuthAdapter({ auth });
    const identity = await adapter.getUser(
      new Request("https://example.com/", { headers: { "x-user": "ada@example.com" } }),
      {},
    );
    expect(identity).toEqual({ id: "id:ada@example.com", email: "ada@example.com" });
  });

  it("returns null for an anonymous request", async () => {
    const { auth } = instance();
    const adapter = betterAuthAdapter({ auth });
    expect(await adapter.getUser(new Request("https://example.com/"), {})).toBeNull();
  });

  it("passes the request headers straight through", async () => {
    const { auth, calls } = instance();
    const adapter = betterAuthAdapter({ auth });
    await adapter.getUser(
      new Request("https://example.com/", {
        headers: { "x-user": "x@example.com", cookie: "session=1" },
      }),
      {},
    );
    expect(calls.getSession[0]?.get("cookie")).toBe("session=1");
  });

  it("delegates unmounted routes to the provider handler", async () => {
    const { auth, calls } = instance();
    const adapter = betterAuthAdapter({ auth });
    const response = await adapter.handler?.(
      new Request("https://example.com/api/auth/sign-in"),
      {},
    );
    expect(calls.handler).toHaveLength(1);
    await expect(response?.json()).resolves.toEqual({ handled: true });
  });

  it("defaults the mount path to /api/auth", () => {
    const { auth } = instance();
    expect(betterAuthAdapter({ auth }).basePath).toBe("/api/auth");
    expect(betterAuthAdapter({ auth, basePath: "/auth" }).basePath).toBe("/auth");
  });

  it("does not carry staff flags: those belong to Clango", async () => {
    const { auth } = instance();
    const adapter = betterAuthAdapter({ auth });
    const identity = await adapter.getUser(
      new Request("https://example.com/", { headers: { "x-user": "boss@example.com" } }),
      {},
    );
    expect(identity).toEqual({ id: "id:boss@example.com", email: "boss@example.com" });
    expect(identity).not.toHaveProperty("isStaff");
  });
});
