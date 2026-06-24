import type { CanonicalNode } from '@coach/pipeline';

/** The failure facts surfaced for a failed tool call: the closed `ErrorKind` and
 *  the ≤500-char summary (each absent when the harness carried none). */
export interface CardError {
  readonly kind?: string;
  readonly message?: string;
}

// Only an `is_error === true` tool yields an error; successes and unmatched calls
// (NULL `is_error`) return undefined, keeping `card.error != null` the predicate.
export function errorOf(node: CanonicalNode): CardError | undefined {
  if (node.type !== 'tool' || node.is_error !== true) return undefined;
  const message =
    node.error_message != null && node.error_message !== '' ? node.error_message : undefined;
  return {
    ...(node.error_kind != null ? { kind: node.error_kind } : {}),
    ...(message != null ? { message } : {}),
  };
}
