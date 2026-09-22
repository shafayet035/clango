import { ClangoError } from "@clango/core";
import type { z } from "zod";

/**
 * Background work.
 *
 * A task is a named, validated message handler. Producers send a task plus its payload; a queue
 * consumer runs it with per-message acknowledgement, so one bad message never takes down the batch
 * (D-011).
 */

/** Context handed to a task handler. */
export interface TaskContext<TEnv extends object = object> {
  readonly env: TEnv;
  /** Name of the task being run, for logging. */
  readonly task: string;
  /** 1-based attempt number, taken from the message's delivery count. */
  readonly attempt: number;
  /** Queue the message arrived on. */
  readonly queue: string;
}

/** Retry behaviour applied before the dead-letter queue takes over. */
export interface TaskOptions {
  /** Attempts before the message is considered failed. Configure the same value on the queue. */
  readonly maxRetries?: number;
  /** Seconds between retries. Configure the same value on the queue's consumer. */
  readonly retryDelaySeconds?: number;
}

/** A registered task. */
export interface TaskDefinition<TPayload = unknown> {
  readonly name: string;
  readonly schema: z.ZodType<TPayload>;
  readonly handler: (payload: TPayload, context: TaskContext) => Promise<void> | void;
  readonly options: Required<TaskOptions>;
}

const registry = new Map<string, TaskDefinition<never>>();

const DEFAULTS: Required<TaskOptions> = { maxRetries: 3, retryDelaySeconds: 60 };

/** The message envelope producers send and consumers unwrap. */
export interface TaskMessage {
  readonly task: string;
  readonly payload: unknown;
}

/**
 * Registers a task.
 *
 * The schema is enforced on both sides: producers validate before sending, so a bad payload fails
 * where it was created rather than in a queue consumer with no request context; consumers validate
 * again because a queue can receive messages from older code.
 */
export function defineTask<TPayload>(
  name: string,
  schema: z.ZodType<TPayload>,
  handler: (payload: TPayload, context: TaskContext) => Promise<void> | void,
  options: TaskOptions = {},
): TaskDefinition<TPayload> {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) {
    throw new ClangoError(
      `Task name "${name}" must be namespaced like "blog.publishPosts" (lower_snake_case segments).`,
    );
  }
  if (registry.has(name)) {
    throw new ClangoError(`Task "${name}" is already registered.`);
  }
  const definition: TaskDefinition<TPayload> = {
    name,
    schema,
    handler,
    options: {
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      retryDelaySeconds: options.retryDelaySeconds ?? DEFAULTS.retryDelaySeconds,
    },
  };
  // The registry is heterogeneous; `never` is the safe reading type because a stored handler
  // cannot be called without a payload cast, which the consumer does after validation.
  registry.set(name, definition as unknown as TaskDefinition<never>);
  return definition;
}

/** Looks up a registered task by name. */
export function taskByName(name: string): TaskDefinition<never> | undefined {
  return registry.get(name);
}

/** Every registered task, keyed by name. */
export function registeredTasks(): ReadonlyMap<string, TaskDefinition<never>> {
  return registry;
}

/** Removes every registration. Intended for tests. */
export function clearTaskRegistry(): void {
  registry.clear();
}

/** The result of handling one message, useful for asserting behaviour in tests. */
export type MessageOutcome = "ack" | "retry" | "unhandled";

function attemptOf(message: { attempts?: number }): number {
  return (message.attempts ?? 0) + 1;
}

/**
 * Runs one message.
 *
 * Exported so the per-message logic can be tested without constructing a whole batch.
 */
export async function handleTaskMessage<TEnv extends object>(
  message: {
    body: unknown;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
    attempts?: number;
  },
  env: TEnv,
  queue: string,
): Promise<MessageOutcome> {
  const body = message.body as Partial<TaskMessage> | null;
  if (body === null || typeof body !== "object" || typeof body.task !== "string") {
    // A malformed envelope can never succeed, so retrying it would burn the whole retry budget.
    message.ack();
    return "unhandled";
  }

  const task = registry.get(body.task);
  if (task === undefined) {
    message.ack();
    return "unhandled";
  }

  const parsed = task.schema.safeParse(body.payload);
  if (!parsed.success) {
    message.ack();
    return "unhandled";
  }

  const attempt = attemptOf(message);
  const context: TaskContext = { env, task: task.name, attempt, queue };

  try {
    await task.handler(parsed.data as never, context);
    message.ack();
    return "ack";
  } catch {
    // Retry with the task's own delay; the queue's max_retries and dead-letter queue decide when to
    // give up, so the consumer never has to distinguish permanent from transient failures.
    message.retry({ delaySeconds: task.options.retryDelaySeconds });
    return "retry";
  }
}

/** Runs a whole batch, one message at a time. */
export async function handleQueueBatch<TEnv extends object>(
  batch: { queue: string; messages: readonly unknown[] },
  env: TEnv,
): Promise<void> {
  for (const message of batch.messages) {
    await handleTaskMessage(message as Parameters<typeof handleTaskMessage>[0], env, batch.queue);
  }
}

/** A queue producer bound to a task registry. */
export interface Enqueuer {
  <TPayload>(
    task: TaskDefinition<TPayload>,
    payload: TPayload,
    options?: { delaySeconds?: number },
  ): Promise<void>;
}

/**
 * Wraps a Queues producer so callers send a task instead of a raw body.
 *
 * The payload is validated before it reaches the queue, which is the only place with enough context
 * to report a useful error.
 */
export function createEnqueuer(queue: Queue): Enqueuer {
  return async function enqueue(task, payload, options) {
    const parsed = task.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ClangoError(
        `Payload for task "${task.name}" is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const message: TaskMessage = { task: task.name, payload: parsed.data };
    if (options?.delaySeconds === undefined) await queue.send(message);
    else await queue.send(message, { delaySeconds: options.delaySeconds });
  };
}
