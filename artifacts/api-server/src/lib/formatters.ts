/**
 * Legal Document Formatting Utilities
 *
 * Pure functions for formatting values for use in Indian legal agreement
 * documents.  No business logic — formatting / display only.
 *
 * Conventions used:
 *   - Currency: Rs. 1,25,000/- (Indian comma style)
 *   - Rupees in words: Indian place-value system (Crore / Lakh / Thousand)
 *   - Date: "13th day of May, 2026"
 *   - Percentage: "85.00% (Eighty-Five Percent)"
 *   - Land area: "2.50 Kani"
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? `-${ONES[u]}` : "");
}

function threeDigitWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  let result = "";
  if (hundreds) result = `${ONES[hundreds]} Hundred`;
  if (remainder) result += (result ? " " : "") + twoDigitWords(remainder);
  return result;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a positive integer to words using the Indian place-value system.
 * Supports values up to 99,99,99,999 (99 crore 99 lakh …).
 *
 * @example amountInWords(125000) → "One Lakh Twenty-Five Thousand"
 */
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const n = Math.floor(amount);
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const remainder = n % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitWords(thousand)} Thousand`);
  if (remainder) parts.push(threeDigitWords(remainder));

  return parts.join(" ");
}

/**
 * Full legal rupee expression used in agreement recitals.
 *
 * @example formatRupeesLegal(125000)
 *   → "Rs. 1,25,000/- (Rupees One Lakh Twenty-Five Thousand Only)"
 */
export function formatRupeesLegal(amount: number): string {
  const figure = `Rs. ${amount.toLocaleString("en-IN")}/-`;
  const words = `Rupees ${amountInWords(amount)} Only`;
  return `${figure} (${words})`;
}

/**
 * Format a rupee amount with Indian comma style and /-  suffix.
 *
 * @example formatINR(125000) → "Rs. 1,25,000/-"
 */
export function formatINR(amount: number | null | undefined): string | null {
  if (amount == null) return null;
  return `Rs. ${amount.toLocaleString("en-IN")}/-`;
}

/**
 * Format a date for Indian legal documents.
 * Accepts ISO date strings ("2026-05-13") or Date objects.
 * Passes through strings it cannot parse.
 *
 * @example legalDate("2026-05-13") → "13th day of May, 2026"
 */
export function legalDate(value: string | Date): string {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const [, y, m, d] = iso.map(Number);
      date = new Date(y, m - 1, d);
    } else {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        date = parsed;
      } else {
        return value;
      }
    }
  }

  const day = date.getDate();
  const month = MONTH_NAMES[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${ordinalSuffix(day)} day of ${month}, ${year}`;
}

/**
 * Format an ownership share percentage with the figure and words.
 *
 * @example ownershipShareLegal(85) → "85.00% (Eighty-Five Percent)"
 */
export function ownershipShareLegal(
  pct: number | null | undefined,
): string | null {
  if (pct == null) return null;
  const words = amountInWords(Math.round(pct));
  return `${pct.toFixed(2)}% (${words} Percent)`;
}

/**
 * Format land area with unit, capitalised.
 *
 * @example landAreaLegal(2.5, "kani") → "2.50 Kani"
 */
export function landAreaLegal(
  area: number | null | undefined,
  unit: string,
): string | null {
  if (area == null) return null;
  const u = unit.charAt(0).toUpperCase() + unit.slice(1).toLowerCase();
  return `${area.toFixed(2)} ${u}`;
}

/**
 * Format an escalation percentage for legal use.
 *
 * @example escalationLegal(5) → "5% per annum"
 */
export function escalationLegal(
  pct: number | null | undefined,
): string | null {
  if (pct == null) return null;
  return `${pct}% per annum`;
}

/**
 * Format a percentage value as a rounded display string.
 *
 * @example formatPercent(85.5) → "85.50%"
 */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${value.toFixed(2)}%`;
}
