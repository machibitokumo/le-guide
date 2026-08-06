import { reOcrReceipt, type OCRResponseItem } from "@/lib/qwen-vl";
import { judge } from "@/lib/judge";
import type { OCRItemType } from "@/types/receipt";

export interface VerifyLoopAttempt {
  attempt: number;
  verdict: "PASS" | "FAIL";
  bailout: boolean;
  diffSummary: string;
  correction: string | null;
  confidence: number;
  actualMd: string;
  reocrUsage: { inputTokens: number; outputTokens: number };
  judgeUsage: { inputTokens: number; outputTokens: number };
  generateUsage?: { inputTokens: number; outputTokens: number };
}

export interface VerifyLoopResult {
  finalImage: Buffer;
  passed: boolean;
  bailedOut: boolean;
  attempts: VerifyLoopAttempt[];
}

export interface VerifyLoopArgs {
  initialImage: Buffer;
  targetMd: string;
  // Receives the latest image so retries can perform edit-on-edit (per spec: loop returns to image-gen with currentImage).
  generate: (correction: string, image: Buffer) => Promise<{ image: Buffer; usage: { inputTokens: number; outputTokens: number } }>;
  maxAttempts?: number;
}

const TYPE_ORDER: OCRItemType[] = [
  "org", "seller_name", "seller_org_nr", "seller_bankgiro", "seller_plusgiro",
  "invoice_number", "invoice_date", "due_date", "payment_reference",
  "customer_name", "customer_org_nr", "customer_address",
  "date", "item", "line_description", "line_unit_price", "line_quantity", "line_total",
  "quantity", "price", "vat", "total", "unknown",
];

const SECTION_HEADINGS: Record<OCRItemType, string> = {
  org: "## Org",
  date: "## Date",
  item: "## Items",
  quantity: "## Quantities",
  price: "## Prices",
  vat: "## VAT",
  total: "## Total",
  unknown: "## Other",
  invoice_number: "## Invoice number",
  invoice_date: "## Invoice date",
  due_date: "## Due date",
  payment_reference: "## Payment reference",
  customer_name: "## Customer name",
  customer_org_nr: "## Customer org nr",
  customer_address: "## Customer address",
  seller_name: "## Seller name",
  seller_org_nr: "## Seller org nr",
  seller_bankgiro: "## Seller bankgiro",
  seller_plusgiro: "## Seller plusgiro",
  line_description: "## Line descriptions",
  line_unit_price: "## Line unit prices",
  line_quantity: "## Line quantities",
  line_total: "## Line totals",
};

function isOCRItemType(value: string): value is OCRItemType {
  return (TYPE_ORDER as readonly string[]).includes(value);
}

function renderItem(item: OCRResponseItem): string {
  const text = item.text.trim();
  if (item.value !== undefined && Number.isFinite(item.value) && !text.includes(String(item.value))) {
    return `- ${text} (${item.value})`;
  }
  return `- ${text}`;
}

function formatActualMd(items: OCRResponseItem[]): string {
  const groups = new Map<OCRItemType, OCRResponseItem[]>();
  for (const item of items) {
    const t: OCRItemType = isOCRItemType(item.type) ? item.type : "unknown";
    const arr = groups.get(t) ?? [];
    arr.push(item);
    groups.set(t, arr);
  }

  const sections: string[] = [];
  for (const type of TYPE_ORDER) {
    const list = groups.get(type);
    if (!list || list.length === 0) continue;
    const lines = [SECTION_HEADINGS[type], ...list.map(renderItem)];
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

export async function runVerifyLoop(args: VerifyLoopArgs): Promise<VerifyLoopResult> {
  const maxAttempts = args.maxAttempts ?? 3;
  const attempts: VerifyLoopAttempt[] = [];
  let currentImage = args.initialImage;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const actual = await reOcrReceipt(currentImage.toString("base64"));
    const actualMd = formatActualMd(actual.items);
    const verdict = await judge({
      targetMd: args.targetMd,
      actualMd,
      attempt,
      maxAttempts,
    });

    const record: VerifyLoopAttempt = {
      attempt,
      verdict: verdict.verdict,
      bailout: verdict.bailout,
      diffSummary: verdict.diffSummary,
      correction: verdict.correction,
      confidence: verdict.confidence,
      actualMd,
      reocrUsage: actual.usage,
      judgeUsage: verdict.usage,
    };
    attempts.push(record);

    if (verdict.verdict === "PASS") {
      return { finalImage: currentImage, passed: true, bailedOut: false, attempts };
    }

    if (verdict.bailout || attempt === maxAttempts || !verdict.correction) {
      return { finalImage: currentImage, passed: false, bailedOut: verdict.bailout, attempts };
    }

    const next = await args.generate(verdict.correction, currentImage);
    currentImage = next.image;
    record.generateUsage = next.usage;
  }

  return { finalImage: currentImage, passed: false, bailedOut: false, attempts };
}
