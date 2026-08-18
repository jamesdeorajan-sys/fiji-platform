export type AIEnv = {
  AI: Ai;
  DB: D1Database;
};

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

export type CandidateEnrichmentInput = {
  candidate_id: string;
  canonical_name: string;
  source_text: string;
  source_url?: string;
};

export async function enrichCandidate(env: AIEnv, input: CandidateEnrichmentInput) {
  const prompt = `You are the Vakaviti Fiji tourism inventory analyst.\n\nYour job is to turn PUBLICLY OBSERVED information into CANDIDATE structured facts only. Never claim verification, legal compliance, live availability, or price accuracy. Never invent missing data.\n\nReturn valid JSON with these keys: summary, probable_categories, probable_locations, probable_products, contact_candidates, price_claims, review_claims, transport_opportunities, missing_information, risk_flags, confidence. Every extracted claim must be traceable to the supplied text. Use null or [] when unknown.\n\nOperator: ${input.canonical_name}\nSource URL: ${input.source_url || 'unknown'}\nSource text:\n${input.source_text}`;

  const output = await env.AI.run(DEFAULT_MODEL, {
    messages: [
      { role: 'system', content: 'Facts have one authority. AI creates candidate evidence, not verified truth.' },
      { role: 'user', content: prompt }
    ]
  });

  const jobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO ai_jobs(id,job_type,entity_type,entity_id,input_json,output_json,status,model,completed_at) VALUES(?,?,?,?,?,?, 'COMPLETED', ?, CURRENT_TIMESTAMP)`)
    .bind(jobId, 'CANDIDATE_ENRICHMENT', 'CANDIDATE_OPERATOR', input.candidate_id, JSON.stringify(input), JSON.stringify(output), DEFAULT_MODEL)
    .run();

  return { job_id: jobId, output };
}

export type ProviderCopilotInput = {
  session_id: string;
  operator_name: string;
  current_step: string;
  verified_context: Record<string, unknown>;
  candidate_context: Record<string, unknown>;
  provider_message: string;
};

export async function providerCopilot(env: AIEnv, input: ProviderCopilotInput) {
  const prompt = `You are the Vakaviti Provider Onboarding Copilot for Fiji tourism operators. Minimise the provider's effort. Ask only for information that is genuinely missing and cannot be safely derived from verified evidence already present.\n\nRules:\n- Never declare the operator licensed, insured, compliant, verified, available, or bookable.\n- Never invent prices, schedules, pickup coverage, bank details, or commission terms.\n- Never ask again for a fact already present in verified_context.\n- Candidate context may be suggested back to the provider for confirmation, but must be labelled as candidate/unconfirmed.\n- If the next step affects legal/compliance status, bank/payout activation, binding commercial terms, or Vakaviti Verified status, set needs_human_gate=true.\n- Respond as JSON: assistant_message, extracted_confirmations, requested_fields, suggested_next_step, needs_human_gate, human_gate_reason.\n\nOperator: ${input.operator_name}\nCurrent step: ${input.current_step}\nVerified context: ${JSON.stringify(input.verified_context)}\nCandidate context: ${JSON.stringify(input.candidate_context)}\nProvider message: ${input.provider_message}`;

  const output = await env.AI.run(DEFAULT_MODEL, {
    messages: [
      { role: 'system', content: 'Minimise human labour, but never cross trust, legal, money, or verification gates autonomously.' },
      { role: 'user', content: prompt }
    ]
  });

  const jobId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO ai_jobs(id,job_type,entity_type,entity_id,input_json,output_json,status,model,completed_at) VALUES(?,?,?,?,?,?, 'COMPLETED', ?, CURRENT_TIMESTAMP)`)
    .bind(jobId, 'PROVIDER_COPILOT', 'PROVIDER_SESSION', input.session_id, JSON.stringify(input), JSON.stringify(output), DEFAULT_MODEL)
    .run();

  return { job_id: jobId, output };
}

export async function createHumanGate(env: AIEnv, args: { gate_type: string; entity_type: string; entity_id: string; reason: string; recommended_action?: string; evidence?: unknown }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO human_gates(id,gate_type,entity_type,entity_id,reason,recommended_action,evidence_json) VALUES(?,?,?,?,?,?,?)`)
    .bind(id, args.gate_type, args.entity_type, args.entity_id, args.reason, args.recommended_action || null, args.evidence ? JSON.stringify(args.evidence) : null)
    .run();
  return id;
}
