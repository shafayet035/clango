import { beforeEach, describe, expect, it } from "vitest";

import {
  clearScheduleRegistry,
  cronMatches,
  defineSchedule,
  handleScheduled,
  parseCron,
} from "../src/index";

beforeEach(() => {
  clearScheduleRegistry();
});

describe("parseCron", () => {
  it("expands wildcards to the full range", () => {
    const fields = parseCron("* * * * *");
    expect(fields.minute.size).toBe(60);
    expect(fields.hour.size).toBe(24);
    expect(fields.dayOfMonth.size).toBe(31);
    expect(fields.month.size).toBe(12);
    expect(fields.dayOfWeek.size).toBe(7);
  });

  it("parses lists, ranges and steps", () => {
    const fields = parseCron("1,5,10 0-4/2 * * 1-5");
    expect([...fields.minute].sort((a, b) => a - b)).toEqual([1, 5, 10]);
    expect([...fields.hour].sort((a, b) => a - b)).toEqual([0, 2, 4]);
    expect([...fields.dayOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("supports a step on a wildcard", () => {
    expect([...parseCron("*/15 * * * *").minute].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(() => parseCron("60 * * * *")).toThrow();
    expect(() => parseCron("* * * * 8")).toThrow();
    expect(() => parseCron("* * * * */0")).toThrow();
    expect(() => parseCron("5-1 * * * *")).toThrow();
  });
});

describe("cronMatches", () => {
  it("matches an exact minute", () => {
    expect(cronMatches("30 3 * * *", new Date("2026-09-22T03:30:00Z"))).toBe(true);
    expect(cronMatches("30 3 * * *", new Date("2026-09-22T03:31:00Z"))).toBe(false);
    expect(cronMatches("30 3 * * *", new Date("2026-09-22T04:30:00Z"))).toBe(false);
  });

  it("uses UTC", () => {
    // 2026-09-22T03:30:00Z is 23:30 on the 21st in New York; the expression is UTC.
    expect(cronMatches("30 3 * * *", new Date("2026-09-21T23:30:00-04:00"))).toBe(true);
  });

  it("matches the day of week", () => {
    // 2026-09-22 is a Tuesday.
    expect(cronMatches("0 0 * * 2", new Date("2026-09-22T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 * * 1", new Date("2026-09-22T00:00:00Z"))).toBe(false);
  });

  it("treats a restricted day of month and day of week as an OR", () => {
    // The first of the month, or any Monday.
    expect(cronMatches("0 0 1 * 1", new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 1 * 1", new Date("2026-09-07T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 1 * 1", new Date("2026-09-08T00:00:00Z"))).toBe(false);
  });

  it("matches a monthly schedule", () => {
    expect(cronMatches("0 3 1 * *", new Date("2026-10-01T03:00:00Z"))).toBe(true);
    expect(cronMatches("0 3 1 * *", new Date("2026-10-02T03:00:00Z"))).toBe(false);
  });
});

describe("defineSchedule", () => {
  it("registers a schedule and rejects a duplicate name", () => {
    defineSchedule("daily-export", "0 3 * * *", () => {});
    expect(() => defineSchedule("daily-export", "0 4 * * *", () => {})).toThrow();
  });

  it("rejects an invalid expression at definition time", () => {
    expect(() => defineSchedule("bad", "every day", () => {})).toThrow();
  });
});

describe("handleScheduled", () => {
  it("runs only the schedules whose expression fired", async () => {
    const ran: string[] = [];
    defineSchedule("daily", "0 3 * * *", () => {
      ran.push("daily");
    });
    defineSchedule("hourly", "0 * * * *", () => {
      ran.push("hourly");
    });

    const executed = await handleScheduled(
      { cron: "0 3 * * *", scheduledTime: new Date("2026-09-22T03:00:00Z") },
      {},
    );
    expect(executed).toEqual(["daily"]);
    expect(ran).toEqual(["daily"]);
  });

  it("passes the environment and the scheduled time", async () => {
    let seen: { env: unknown; at: Date } | undefined;
    defineSchedule("daily", "0 3 * * *", (context) => {
      seen = { env: context.env, at: context.scheduledTime };
    });

    const at = new Date("2026-09-22T03:00:00Z");
    await handleScheduled({ cron: "0 3 * * *", scheduledTime: at }, { DB: "binding" });
    expect(seen?.at).toBe(at);
    expect(seen?.env).toEqual({ DB: "binding" });
  });

  it("ignores a trigger that matches no schedule", async () => {
    defineSchedule("daily", "0 3 * * *", () => {});
    expect(await handleScheduled({ cron: "0 9 * * *", scheduledTime: new Date(0) }, {})).toEqual(
      [],
    );
  });
});
