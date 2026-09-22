import { createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  clearTaskRegistry,
  createEnqueuer,
  defineTask,
  handleQueueBatch,
  handleTaskMessage,
  registeredTasks,
  type TaskDefinition,
} from "../src/index";

const payload = z.object({ id: z.string(), count: z.number().int().positive() });

function message(body: unknown, attempts = 0) {
  const state = {
    settled: "none" as string,
    retryDelay: undefined as number | undefined,
    attempts,
    body,
    ack() {
      state.settled = "ack";
    },
    retry(options?: { delaySeconds?: number }) {
      state.settled = "retry";
      state.retryDelay = options?.delaySeconds;
    },
  };
  return state;
}

beforeEach(() => {
  clearTaskRegistry();
});

describe("defineTask", () => {
  it("registers a task with defaults", () => {
    const task = defineTask("blog.publish", payload, () => {});
    expect(task.options).toEqual({ maxRetries: 3, retryDelaySeconds: 60 });
    expect(registeredTasks().get("blog.publish")).toBe(task);
  });

  it("rejects a name that is not namespaced", () => {
    expect(() => defineTask("publish", payload, () => {})).toThrow();
  });

  it("rejects a duplicate name", () => {
    defineTask("blog.publish", payload, () => {});
    expect(() => defineTask("blog.publish", payload, () => {})).toThrow();
  });
});

describe("handleTaskMessage", () => {
  it("runs the handler and acknowledges", async () => {
    const seen: unknown[] = [];
    defineTask("blog.publish", payload, (data) => {
      seen.push(data);
    });

    const entry = message({ task: "blog.publish", payload: { id: "p1", count: 2 } });
    expect(await handleTaskMessage(entry, env, "clango-tasks")).toBe("ack");
    expect(entry.settled).toBe("ack");
    expect(seen).toEqual([{ id: "p1", count: 2 }]);
  });

  it("passes the attempt count and queue name", async () => {
    let attempts = 0;
    let queue = "";
    defineTask("blog.publish", payload, (_data, context) => {
      attempts = context.attempt;
      queue = context.queue;
    });

    await handleTaskMessage(
      message({ task: "blog.publish", payload: { id: "p1", count: 1 } }, 2),
      env,
      "clango-tasks",
    );
    expect(attempts).toBe(3);
    expect(queue).toBe("clango-tasks");
  });

  it("retries with the task's delay when the handler throws", async () => {
    defineTask(
      "blog.publish",
      payload,
      () => {
        throw new Error("upstream down");
      },
      { retryDelaySeconds: 30 },
    );

    const entry = message({ task: "blog.publish", payload: { id: "p1", count: 1 } });
    expect(await handleTaskMessage(entry, env, "q")).toBe("retry");
    expect(entry.settled).toBe("retry");
    expect(entry.retryDelay).toBe(30);
  });

  it("acknowledges an unregistered task instead of retrying forever", async () => {
    const entry = message({ task: "blog.gone", payload: {} });
    expect(await handleTaskMessage(entry, env, "q")).toBe("unhandled");
    expect(entry.settled).toBe("ack");
  });

  it("acknowledges a malformed envelope", async () => {
    const entry = message("not-a-task");
    expect(await handleTaskMessage(entry, env, "q")).toBe("unhandled");
    expect(entry.settled).toBe("ack");
  });

  it("acknowledges a payload that fails validation", async () => {
    defineTask("blog.publish", payload, () => {});
    const entry = message({ task: "blog.publish", payload: { id: "p1", count: -1 } });
    expect(await handleTaskMessage(entry, env, "q")).toBe("unhandled");
    expect(entry.settled).toBe("ack");
  });

  it("keeps processing the batch when one message fails", async () => {
    const succeeded: string[] = [];
    defineTask("blog.publish", payload, (data) => {
      if (data.id === "bad") throw new Error("boom");
      succeeded.push(data.id);
    });

    const batch = createMessageBatch("clango-tasks", [
      {
        id: "1",
        timestamp: new Date(0),
        attempts: 1,
        body: { task: "blog.publish", payload: { id: "good", count: 1 } },
      },
      {
        id: "2",
        timestamp: new Date(0),
        attempts: 1,
        body: { task: "blog.publish", payload: { id: "bad", count: 1 } },
      },
      {
        id: "3",
        timestamp: new Date(0),
        attempts: 1,
        body: { task: "blog.publish", payload: { id: "also-good", count: 1 } },
      },
    ]);
    const context = createExecutionContext();
    await handleQueueBatch(batch, env);
    const result = await getQueueResult(batch, context);

    expect(succeeded).toEqual(["good", "also-good"]);
    expect(result.explicitAcks).toEqual(["1", "3"]);
    expect(result.retryMessages.map((entry) => entry.msgId)).toEqual(["2"]);
  });
});

describe("createEnqueuer", () => {
  function queue(): { sent: unknown[]; send: (body: unknown, options?: unknown) => Promise<void> } {
    const sent: unknown[] = [];
    return {
      sent,
      send: async (body: unknown, options?: unknown) => {
        sent.push(options === undefined ? body : { body, options });
      },
    };
  }

  it("validates before sending", async () => {
    const producer = queue();
    const task: TaskDefinition<{ id: string; count: number }> = defineTask(
      "blog.publish",
      payload,
      () => {},
    );
    const enqueue = createEnqueuer(producer as unknown as Queue);

    await enqueue(task, { id: "p1", count: 3 });
    expect(producer.sent).toEqual([{ task: "blog.publish", payload: { id: "p1", count: 3 } }]);

    await expect(enqueue(task, { id: "p1", count: 0 })).rejects.toThrow(/invalid/i);
    expect(producer.sent).toHaveLength(1);
  });

  it("passes a delay through", async () => {
    const producer = queue();
    const task = defineTask("blog.publish", payload, () => {});
    const enqueue = createEnqueuer(producer as unknown as Queue);

    await enqueue(task, { id: "p1", count: 1 }, { delaySeconds: 900 });
    expect(producer.sent).toEqual([
      {
        body: { task: "blog.publish", payload: { id: "p1", count: 1 } },
        options: { delaySeconds: 900 },
      },
    ]);
  });
});
