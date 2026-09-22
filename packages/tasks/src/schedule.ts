/**
 * Cron expressions.
 *
 * Clango schedules map to Cloudflare Cron Triggers, which wake the Worker with the expression that
 * fired. Matching is implemented here so a schedule can be tested without deploying, and so one
 * Worker can host several schedules.
 */

/** Parsed cron fields, each a set of allowed values. */
export interface CronFields {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
}

const RANGES: readonly [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step in "${part}".`);
    }

    let from = min;
    let to = max;
    if (rangePart !== "*" && rangePart !== undefined) {
      const bounds = rangePart.split("-");
      from = Number(bounds[0]);
      to = bounds.length === 1 ? from : Number(bounds[1]);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
        throw new Error(`Invalid cron range "${rangePart}" (expected ${min}-${max}).`);
      }
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values;
}

/**
 * Parses a five-field cron expression: minute, hour, day of month, month, day of week.
 *
 * Supports `*`, single values, ranges (`1-5`), lists (`1,3,5`) and steps (a bare `*` or a range
 * followed by a slash and an interval, for example every fifteen minutes).
 * Day of week is `0`-`6` with `0` being Sunday, matching Cloudflare and Vixie cron.
 */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression "${expression}" must have five fields.`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const fields = {
    minute: parseField(minute, ...(RANGES[0] as [number, number])),
    hour: parseField(hour, ...(RANGES[1] as [number, number])),
    dayOfMonth: parseField(dayOfMonth, ...(RANGES[2] as [number, number])),
    month: parseField(month, ...(RANGES[3] as [number, number])),
    dayOfWeek: parseField(dayOfWeek, ...(RANGES[4] as [number, number])),
  };
  return fields;
}

/**
 * Returns `true` when `date` (interpreted in UTC) matches the expression.
 *
 * When both day-of-month and day-of-week are restricted, cron treats them as an OR — matching
 * either is enough — which is why `0 0 1 * 1` fires on the first of the month *and* every Monday.
 */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  if (!fields.minute.has(date.getUTCMinutes())) return false;
  if (!fields.hour.has(date.getUTCHours())) return false;
  if (!fields.month.has(date.getUTCMonth() + 1)) return false;

  const dayOfMonthRestricted = fields.dayOfMonth.size !== 31;
  const dayOfWeekRestricted = fields.dayOfWeek.size !== 7;
  const dayMatches = fields.dayOfMonth.has(date.getUTCDate());
  const weekMatches = fields.dayOfWeek.has(date.getUTCDay());

  if (dayOfMonthRestricted && dayOfWeekRestricted) return dayMatches || weekMatches;
  if (dayOfMonthRestricted) return dayMatches;
  if (dayOfWeekRestricted) return weekMatches;
  return true;
}

/** A scheduled handler. */
export interface ScheduleDefinition {
  readonly name: string;
  readonly expression: string;
  readonly handler: (context: {
    env: object;
    scheduledTime: Date;
    cron: string;
  }) => Promise<void> | void;
}

const schedules: ScheduleDefinition[] = [];

/**
 * Registers a cron schedule. The expression must also be declared in `wrangler.jsonc` under
 * `triggers.crons` — Cloudflare decides when to wake the Worker; this only routes the wake-up.
 */
export function defineSchedule(
  name: string,
  expression: string,
  handler: ScheduleDefinition["handler"],
): ScheduleDefinition {
  parseCron(expression);
  if (schedules.some((schedule) => schedule.name === name)) {
    throw new Error(`Schedule "${name}" is already registered.`);
  }
  const definition: ScheduleDefinition = { name, expression, handler };
  schedules.push(definition);
  return definition;
}

/** Every registered schedule. */
export function registeredSchedules(): readonly ScheduleDefinition[] {
  return schedules;
}

/** Removes every registration. Intended for tests. */
export function clearScheduleRegistry(): void {
  schedules.length = 0;
}

/**
 * Runs every schedule matching the fired expression and timestamp.
 *
 * A failure in one schedule does not stop the others: they are independent jobs that happen to
 * share a trigger.
 */
export async function handleScheduled<TEnv extends object>(
  // The runtime hands `ScheduledController.scheduledTime` over as epoch milliseconds, so accept
  // both that and a `Date` rather than making every caller convert.
  event: { cron: string; scheduledTime: Date | number },
  env: TEnv,
): Promise<readonly string[]> {
  const scheduledTime =
    event.scheduledTime instanceof Date ? event.scheduledTime : new Date(event.scheduledTime);
  const ran: string[] = [];
  for (const schedule of schedules) {
    if (schedule.expression !== event.cron) continue;
    if (!cronMatches(schedule.expression, scheduledTime)) continue;
    await schedule.handler({ env, scheduledTime, cron: event.cron });
    ran.push(schedule.name);
  }
  return ran;
}
