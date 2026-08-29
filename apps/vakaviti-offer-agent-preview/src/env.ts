// Isolated preview bindings only - every one of these is a dedicated resource created for this
// system (see wrangler.toml). No production D1/Queue/route/secret is bound here.
export type Env = {
  DB: D1Database;
  AI: Ai;
  DISCOVERY_QUEUE: Queue;
  FETCH_EXTRACT_QUEUE: Queue;
  RECHECK_QUEUE: Queue;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  FORCE_DISABLE_ALL_AGENTS: string;
  CF_VERSION_METADATA: { id: string; tag: string };
  ADMIN_TOKEN?: string;
};

export function isGloballyForceDisabled(env: Env): boolean {
  return env.FORCE_DISABLE_ALL_AGENTS === 'true';
}
