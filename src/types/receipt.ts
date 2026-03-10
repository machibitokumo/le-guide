export interface BoundingBox {
  x: number;      // normalized 0-1
  y: number;      // normalized 0-1
  width: number;  // normalized 0-1
  height: number; // normalized 0-1
}

export type OCRItemType = "item" | "price" | "total" | "vat" | "date" | "org" | "quantity" | "unknown";

export interface OCRItem {
  id: string;
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
  type: OCRItemType;
  value?: number; // parsed numeric value for prices/totals
}

export interface OCRResult {
  items: OCRItem[];
  rawText: string;
  imageWidth: number;
  imageHeight: number;
}

export interface TargetRequest {
  targetTotal: number;
  date: string; // YYYY-MM-DD
}

export interface StructuredItem {
  name: string;
  type: "A" | "B"; // A = has "N st x price" line, B = price only
  unitPrice: number;
  currentQty?: number; // Type A only
  currentPrice: number;
  qtyUnit?: string; // "st", "l", "kg" etc
}

export interface ReceiptStructure {
  items: StructuredItem[];
}

export type VATRate = 25 | 12 | 6;

export interface VATBreakdown {
  rate: VATRate;
  net: number;
  vat: number;
  gross: number;
}

export interface LedgerResult {
  adjustedItems: OCRItem[];
  newTotal: number;
  vatBreakdown: VATBreakdown[];
  warnings: string[];
}

export type PipelineState =
  | { step: "idle" }
  | { step: "uploading" }
  | { step: "processing"; progress?: number }
  | { step: "targeting"; ocrResult: OCRResult; imageUrl: string; receiptStructure: ReceiptStructure }
  | { step: "generating"; targetTotal: number; date: string }
  | { step: "done"; editedImageUrl: string; ledgerResult: LedgerResult; originalImageUrl: string }
  | { step: "error"; message: string; previousStep?: string };
