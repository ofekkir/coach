import { Buffer } from 'node:buffer';
import { z } from 'zod';

const b64SpanId = z.string().refine((s) => {
  try {
    return Buffer.from(s, 'base64').length === 8;
  } catch {
    return false;
  }
}, 'must be base64-encoded 8 bytes');

const b64TraceId = z.string().refine((s) => {
  try {
    return Buffer.from(s, 'base64').length === 16;
  } catch {
    return false;
  }
}, 'must be base64-encoded 16 bytes');

const OtlpAttributeValueSchema = z.union([
  z.object({ stringValue: z.string() }),
  z.object({ boolValue: z.boolean() }),
  z.object({ intValue: z.string() }),
  z.object({ doubleValue: z.number() }),
  z.object({ arrayValue: z.object({ values: z.array(z.unknown()) }) }),
]);

const OtlpSpanSchema = z
  .object({
    traceId: b64TraceId,
    spanId: b64SpanId,
    parentSpanId: b64SpanId.optional(),
    name: z.string().min(1),
    startTimeUnixNano: z.string().regex(/^\d+$/, 'must be a numeric string'),
    endTimeUnixNano: z.string().regex(/^\d+$/, 'must be a numeric string'),
    attributes: z.array(z.object({ key: z.string(), value: OtlpAttributeValueSchema })),
  })
  .refine(
    (s) => BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano),
    'endTimeUnixNano must be >= startTimeUnixNano',
  );

export const TempoTraceSchema = z
  .object({
    batches: z.array(
      z.object({
        scopeSpans: z.array(z.object({ spans: z.array(OtlpSpanSchema) })),
      }),
    ),
  })
  .superRefine((trace, ctx) => {
    const allSpanIds = new Set<string>();
    for (const batch of trace.batches) {
      for (const ss of batch.scopeSpans) {
        for (const span of ss.spans) allSpanIds.add(span.spanId);
      }
    }

    const seen = new Set<string>();
    for (const batch of trace.batches) {
      for (const ss of batch.scopeSpans) {
        for (const span of ss.spans) {
          if (seen.has(span.spanId)) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate spanId: ${span.spanId}`,
            });
          }
          seen.add(span.spanId);

          if (span.parentSpanId != null && !allSpanIds.has(span.parentSpanId)) {
            ctx.addIssue({
              code: 'custom',
              message: `parentSpanId ${span.parentSpanId} references unknown span`,
            });
          }
        }
      }
    }
  });
