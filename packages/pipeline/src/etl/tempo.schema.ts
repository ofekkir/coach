import { z } from 'zod';

function b64ByteLength(s: string): number {
  try {
    return atob(s).length;
  } catch {
    return -1;
  }
}

const b64SpanId = z
  .string()
  .refine((s) => b64ByteLength(s) === 8, 'must be base64-encoded 8 bytes');

const b64TraceId = z
  .string()
  .refine((s) => b64ByteLength(s) === 16, 'must be base64-encoded 16 bytes');

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
    const allScopeSpans = trace.batches.flatMap((b) => b.scopeSpans);
    const allSpans = allScopeSpans.flatMap((ss) => ss.spans);
    const allSpanIds = new Set(allSpans.map((s) => s.spanId));

    const seen = new Set<string>();
    for (const span of allSpans) {
      if (seen.has(span.spanId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate spanId: ${span.spanId}` });
      }
      seen.add(span.spanId);

      if (span.parentSpanId != null && !allSpanIds.has(span.parentSpanId)) {
        ctx.addIssue({
          code: 'custom',
          message: `parentSpanId ${span.parentSpanId} references unknown span`,
        });
      }
    }
  });
