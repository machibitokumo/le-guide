export interface JudgeVerdict {
  verdict: "PASS" | "FAIL";
  diffSummary: string;
  correction: string | null;
  bailout: boolean;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface JudgeInput {
  targetMd: string;
  actualMd: string;
  attempt: number;
  maxAttempts?: number;
}

export class JudgeError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`judge: HTTP ${status}: ${body}`);
    this.name = "JudgeError";
    this.status = status;
    this.body = body;
  }
}

export const JUDGE_SYSTEM_PROMPT = `You are a strict judge for a Swedish receipt image-editing pipeline. You compare a TARGET (the canonical desired receipt content, in markdown) against ACTUAL (what re-OCR reports the freshly generated image shows, in markdown). Your verdict drives a generate-and-verify loop: PASS ships the image; FAIL either produces a focused correction prompt for the image-editing model (Gemini Nano Banana Pro) or bails out.

Rules:
- Compare totals, dates, times, VAT lines, and item lines.
- Numbers must match EXACTLY. No tolerance on amounts, dates, times, or VAT figures.
- Item text matches fuzzily: minor whitespace, casing, or line-break differences are acceptable.
- If everything matches, return verdict "PASS" with correction null and bailout false.
- If anything is wrong, return verdict "FAIL" and decide:
  - If the issue is a fixable surgical edit (one wrong digit, one wrong item line, wrong date, wrong time) write a SPECIFIC correction prompt aimed at Gemini Nano Banana Pro telling it exactly what to change and what to leave untouched. Example: "Change the total in the bottom right from 247,50 to 295,00. Do not change anything else."
  - If the image is fundamentally broken (garbled text, corrupted layout, multiple compounding errors) or attempt >= maxAttempts, set bailout true and correction null.
- diffSummary is one short human-readable line.
- confidence is your certainty about the verdict, between 0 and 1.

Respond with ONLY a JSON object matching exactly this shape:
{"verdict":"PASS"|"FAIL","diff_summary":string,"correction":string|null,"bailout":boolean,"confidence":number}`;

interface RawVerdict {
  verdict: unknown;
  diff_summary: unknown;
  correction: unknown;
  bailout: unknown;
  confidence: unknown;
}

function isRawVerdict(value: unknown): value is RawVerdict {
  return typeof value === "object" && value !== null
    && "verdict" in value && "diff_summary" in value
    && "correction" in value && "bailout" in value && "confidence" in value;
}

function parseVerdict(raw: unknown, usage: { inputTokens: number; outputTokens: number }): JudgeVerdict {
  if (!isRawVerdict(raw)) throw new Error("judge: response is not an object with required keys");

  const verdict = raw.verdict;
  if (verdict !== "PASS" && verdict !== "FAIL") {
    throw new Error(`judge: invalid verdict ${JSON.stringify(verdict)}`);
  }
  if (typeof raw.diff_summary !== "string") throw new Error("judge: diff_summary must be string");
  if (typeof raw.bailout !== "boolean") throw new Error("judge: bailout must be boolean");
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) {
    throw new Error("judge: confidence must be finite number");
  }

  let correction: string | null;
  if (raw.correction === null) correction = null;
  else if (typeof raw.correction === "string") correction = raw.correction.trim() === "" ? null : raw.correction;
  else throw new Error("judge: correction must be string or null");

  if (verdict === "PASS") correction = null;
  if (verdict === "FAIL" && raw.bailout) correction = null;

  return {
    verdict,
    diffSummary: raw.diff_summary,
    correction,
    bailout: raw.bailout,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
    usage,
  };
}

export async function judge(input: JudgeInput, opts?: { model?: string }): Promise<JudgeVerdict> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("judge: OPENAI_API_KEY is not set");

  const model = opts?.model ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
  const maxAttempts = input.maxAttempts ?? 3;

  const userMessage = [
    `Attempt: ${input.attempt} of ${maxAttempts}`,
    "",
    "## TARGET",
    input.targetMd,
    "",
    "## ACTUAL",
    input.actualMd,
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new JudgeError(res.status, body);
  }

  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null) throw new Error("judge: response is not an object");

  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("judge: response has no choices");

  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content !== "string") throw new Error("judge: choice message content is not a string");

  const usageRaw = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage ?? {};
  const inputTokens = typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : 0;
  const outputTokens = typeof usageRaw.completion_tokens === "number" ? usageRaw.completion_tokens : 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`judge: response content is not valid JSON: ${content.slice(0, 200)}`);
  }

  return parseVerdict(parsed, { inputTokens, outputTokens });
}
