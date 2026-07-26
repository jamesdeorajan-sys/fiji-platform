import { ApplicationError } from "./errors.ts";
import type { ValidationResult } from "../../validation/src/index.ts";

export interface CommandStages<Input, Parsed, Authorized, Output> {
  parse(input: Input): Parsed;
  validate(parsed: Parsed): ValidationResult<Parsed>;
  authorize(value: Parsed): Promise<Authorized>;
  execute(value: Authorized): Promise<Output>;
}
/** Transaction, audit, and idempotency belong inside execute so they share one atomic boundary. */
export async function runCommand<Input, Parsed, Authorized, Output>(
  stages: CommandStages<Input, Parsed, Authorized, Output>,
  input: Input,
): Promise<Output> {
  const parsed = stages.parse(input);
  const validation = stages.validate(parsed);
  if (!validation.ok)
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "Request validation failed",
      400,
    );
  return stages.execute(await stages.authorize(validation.value));
}
