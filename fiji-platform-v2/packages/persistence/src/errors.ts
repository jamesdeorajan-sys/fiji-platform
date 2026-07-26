export const applicationErrorCodes = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "DATABASE_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ApplicationErrorCode = (typeof applicationErrorCodes)[number];

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly status: number;
  readonly cause?: unknown;
  constructor(
    code: ApplicationErrorCode,
    message: string,
    status: number,
    cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (cause !== undefined) this.cause = cause;
    this.name = "ApplicationError";
  }
}

export const databaseError = (cause: unknown): ApplicationError =>
  new ApplicationError(
    "DATABASE_ERROR",
    "Database operation failed",
    500,
    cause,
  );

export const safeError = (
  error: unknown,
): {
  status: number;
  body: { error: { code: ApplicationErrorCode; message: string } };
} => {
  const known =
    error instanceof ApplicationError
      ? error
      : new ApplicationError(
          "INTERNAL_ERROR",
          "An internal error occurred",
          500,
        );
  return {
    status: known.status,
    body: { error: { code: known.code, message: known.message } },
  };
};
