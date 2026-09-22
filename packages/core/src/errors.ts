/**
 * Error types thrown by Clango. All framework errors extend {@link ClangoError} so callers can
 * distinguish them from unexpected runtime failures.
 */

/** Base class for every error raised by Clango. */
export class ClangoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClangoError";
  }
}

/** Thrown when a model, field or app definition is invalid. */
export class ModelDefinitionError extends ClangoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelDefinitionError";
  }
}

/** Thrown when a schema snapshot cannot be built or diffed. */
export class MigrationError extends ClangoError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}
