import { ApplicationError } from "./errors.ts";
import type { Persistence, SqlStatement } from "./database.ts";
import type { Clock } from "./clock.ts";
import type { IdGenerator } from "./id.ts";

export const canonicalRequestJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new ApplicationError(
        "VALIDATION_ERROR",
        "Request contains a non-finite number",
        400,
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalRequestJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined)
          throw new ApplicationError(
            "VALIDATION_ERROR",
            "Request contains undefined",
            400,
          );
        return `${JSON.stringify(key)}:${canonicalRequestJson(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new ApplicationError(
    "VALIDATION_ERROR",
    "Request is not canonical JSON data",
    400,
  );
};

export const requestFingerprint = async (request: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalRequestJson(request)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
interface RecordRow {
  request_fingerprint: string;
  result_json: string;
}
interface ClaimRow {
  request_fingerprint: string;
}
export interface IdempotentCommand<T> {
  readonly result: T;
  readonly statements: readonly SqlStatement[];
}
export class IdempotencyStore {
  private readonly persistence: Persistence;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  constructor(persistence: Persistence, ids: IdGenerator, clock: Clock) {
    this.persistence = persistence;
    this.ids = ids;
    this.clock = clock;
  }
  async replay<T>(
    scope: string,
    key: string,
    fingerprint: string,
  ): Promise<T | undefined> {
    const row = await this.persistence.one<RecordRow>(
      `SELECT request_fingerprint,result_json FROM idempotency_records WHERE scope=? AND idempotency_key=?`,
      [scope, key],
    );
    if (!row) return undefined;
    if (row.request_fingerprint !== fingerprint)
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        409,
      );
    return JSON.parse(row.result_json) as T;
  }
  evidence(
    scope: string,
    key: string,
    fingerprint: string,
    result: unknown,
    expiresAt: string,
  ): SqlStatement {
    return {
      sql: `INSERT INTO idempotency_records (id,scope,idempotency_key,request_fingerprint,result_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`,
      params: [
        this.ids.generate(),
        scope,
        key,
        fingerprint,
        JSON.stringify(result),
        this.clock.now(),
        expiresAt,
      ],
    };
  }

  /**
   * Reserves the key before invoking the command factory. A racing caller waits
   * for and replays the winner's evidence instead of exposing a uniqueness error.
   * Expiry is cleanup eligibility: evidence remains replayable until deleted.
   */
  async execute<T>(
    scope: string,
    key: string,
    fingerprint: string,
    expiresAt: string,
    command: () => Promise<IdempotentCommand<T>>,
  ): Promise<T> {
    const replay = await this.replay<T>(scope, key, fingerprint);
    if (replay !== undefined) return replay;
    let winner = false;
    try {
      await this.persistence.insert(
        "INSERT INTO idempotency_claims (scope,idempotency_key,request_fingerprint,claimed_at) VALUES (?,?,?,?)",
        [scope, key, fingerprint, this.clock.now()],
      );
      winner = true;
    } catch {
      const claim = await this.persistence.one<ClaimRow>(
        "SELECT request_fingerprint FROM idempotency_claims WHERE scope=? AND idempotency_key=?",
        [scope, key],
      );
      if (!claim) {
        const completed = await this.replay<T>(scope, key, fingerprint);
        if (completed !== undefined) return completed;
        throw new ApplicationError(
          "DATABASE_ERROR",
          "Database operation failed",
          500,
        );
      }
      if (claim.request_fingerprint !== fingerprint)
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was used with a different request",
          409,
        );
    }
    if (!winner) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const completed = await this.replay<T>(scope, key, fingerprint);
        if (completed !== undefined) return completed;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new ApplicationError(
        "CONFLICT",
        "Idempotent operation is still in progress",
        409,
      );
    }
    try {
      const prepared = await command();
      await this.persistence.transaction([
        ...prepared.statements,
        this.evidence(scope, key, fingerprint, prepared.result, expiresAt),
      ]);
      return prepared.result;
    } catch (error) {
      await this.persistence.execute(
        "DELETE FROM idempotency_claims WHERE scope=? AND idempotency_key=?",
        [scope, key],
      );
      throw error;
    }
  }
}
