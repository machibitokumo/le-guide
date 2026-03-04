import type { VATRate } from "@/types/receipt";

/**
 * Validate Swedish organization number (10 digits, Luhn algorithm).
 * Accepts formats: NNNNNN-NNNN or NNNNNNNNNN
 */
export function validateOrgNumber(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 10) return false;
  return luhnCheck(digits);
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function calculateVAT(gross: number, rate: VATRate): { net: number; vat: number } {
  const net = gross / (1 + rate / 100);
  const vat = gross - net;
  return {
    net: Math.round(net * 100) / 100,
    vat: Math.round(vat * 100) / 100,
  };
}

export function detectVATRate(text: string): VATRate {
  if (/6\s*%/.test(text)) return 6;
  if (/12\s*%/.test(text)) return 12;
  return 25;
}

export function formatSEK(value: number): string {
  return `${value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export function parseSEKAmount(text: string): number | null {
  const cleaned = text
    .replace(/\s*(kr|SEK|:-)\s*/gi, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
