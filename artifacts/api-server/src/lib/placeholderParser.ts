/**
 * Placeholder Parser
 *
 * Extracts {{VARIABLE_NAME}} tokens from any text string.
 * Handles DOCX extracted XML text or plain text.
 *
 * Rules:
 *   - Delimiter: {{ and }}
 *   - Variable names: UPPERCASE_WITH_UNDERSCORES only
 *   - Duplicates are deduplicated
 *   - Unknown variables are returned in a separate list
 */

import { VARIABLE_REGISTRY } from "./variableRegistry";

const PLACEHOLDER_REGEX = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export interface ParseResult {
  all: string[];
  known: string[];
  unknown: string[];
}

/**
 * Parse all unique {{VARIABLE}} tokens from a text string.
 * Returns three lists: all tokens found, known (in registry), and unknown.
 */
export function parsePlaceholders(text: string): ParseResult {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_REGEX.source, "g");
  while ((match = re.exec(text)) !== null) {
    found.add(match[1]);
  }
  const all = Array.from(found);
  const known = all.filter((v) => v in VARIABLE_REGISTRY);
  const unknown = all.filter((v) => !(v in VARIABLE_REGISTRY));
  return { all, known, unknown };
}

/**
 * Replace all {{VARIABLE}} tokens in text with values from the provided map.
 * Tokens with no matching value are left as-is (or replaced with a fallback).
 */
export function replacePlaceholders(
  text: string,
  values: Record<string, string>,
  fallback: (name: string) => string = (n) => `{{${n}}}`,
): string {
  return text.replace(PLACEHOLDER_REGEX, (_match, name: string) => {
    return values[name] !== undefined ? values[name] : fallback(name);
  });
}
