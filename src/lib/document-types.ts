import type { VATBreakdown } from "@/types/receipt";

export type DocType = "kvitto" | "faktura";

export type InvoiceFieldType =
  | "invoice_number"
  | "invoice_date"
  | "due_date"
  | "payment_reference"
  | "customer_name"
  | "customer_org_nr"
  | "customer_address"
  | "seller_name"
  | "seller_org_nr"
  | "seller_bankgiro"
  | "seller_plusgiro"
  | "line_description"
  | "line_unit_price"
  | "line_quantity"
  | "line_total";

export type EditOperation =
  | { op: "MODIFY_ITEM"; id: string; field: "price" | "qty" | "name"; newValue: string | number }
  | { op: "MULTIPLY_QTY"; id: string; factor: number }
  | { op: "ADD_ITEM"; name: string; qty: number; unitPrice: number; vatRate: 6 | 12 | 25 }
  | { op: "DELETE_ITEM"; id: string }
  | { op: "SET_FIELD"; field: InvoiceFieldType | "date" | "time" | "total"; newValue: string };

export interface EditPlan {
  docType: DocType;
  operations: EditOperation[];
  vatBreakdown: VATBreakdown[];
  warnings: string[];
}

export interface KvittoTarget {
  docType: "kvitto";
  total: number;
  date: string;
  time?: string;
}

export interface FakturaTarget {
  docType: "faktura";
  total: number;
  invoiceDate: string;
  dueDate: string;
  invoiceNumber?: string;
  paymentReference?: string;
  customer?: {
    name?: string;
    orgNr?: string;
    address?: string;
  };
}

export type EditTarget = KvittoTarget | FakturaTarget;

export const KVITTO_EDITABLE_FIELDS = ["total", "date", "time"] as const;

export const FAKTURA_EDITABLE_FIELDS = [
  "total",
  "invoice_number",
  "invoice_date",
  "due_date",
  "payment_reference",
  "customer_name",
  "customer_org_nr",
  "customer_address",
] as const;

export const FAKTURA_PROTECTED_FIELDS = [
  "seller_name",
  "seller_org_nr",
  "seller_bankgiro",
  "seller_plusgiro",
] as const;

export const RANDOMIZED_FIELDS = [
  "receipt_number",
  "transaction_id",
  "aid_code",
  "barcode",
  "invoice_number",
  "payment_reference",
] as const;

export function isFakturaTarget(t: EditTarget): t is FakturaTarget {
  return t.docType === "faktura";
}
