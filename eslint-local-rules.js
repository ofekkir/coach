// @ts-check

// Comment policy: a comment must justify its existence as non-obvious WHY, declared
// with an explicit `Why:` marker. WHAT-comments — ones that restate or label the code
// — carry information a NAME should carry (extract a constant/function, rename a var),
// so they are a defect, the same class as dead code. The marker is the deterministic
// signal: the rule cannot read intent, so it requires the author to assert it. Tooling
// directives (eslint/ts/prettier/reference), JSDoc `/** */`, and TODO/FIXME/HACK are
// exempt — they are not narration. The Why: text itself is not graded; the friction of
// typing the marker is what pushes a WHAT-comment toward a name instead. Only the HEAD
// of a consecutive `//` run needs the marker — continuation lines inherit it, so a
// multi-line WHY reads naturally without `Why:` repeated on every line.
const ALLOWED_LINE_COMMENT =
  /^\s*(Why:|TODO|FIXME|HACK|eslint-|@ts-|prettier-|global\s|exported\s|c8\s|v8\s|istanbul\s|\/\s*<reference)/;
export const commentPolicyPlugin = {
  rules: {
    'why-marker-only': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Comments must be non-obvious WHY, marked `Why:`.' },
        messages: {
          needsWhy:
            'Comment must explain non-obvious WHY and start with `Why:` — or be removed by encoding the intent in a name. WHAT-comments that restate the code are forbidden.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;
        function reportUnmarkedRuns() {
          const lineComments = sourceCode.getAllComments().filter((c) => c.type === 'Line');
          let prevLine = -2;
          let prevAllowed = false;
          for (const comment of lineComments) {
            const startsRun = ALLOWED_LINE_COMMENT.test(comment.value);
            const continuesRun = prevAllowed && comment.loc.start.line === prevLine + 1;
            const allowed = startsRun || continuesRun;
            if (!allowed) context.report({ node: comment, messageId: 'needsWhy' });
            prevLine = comment.loc.start.line;
            prevAllowed = allowed;
          }
        }
        return { Program: reportUnmarkedRuns };
      },
    },
  },
};

// Named-literal policy: a string literal carrying domain meaning belongs in a NAME,
// not loose in the source — the same principle as the comment rule, applied to values.
// There is no maintained off-the-shelf rule for this (typescript-eslint deprecated
// `no-type-alias` and redirected to `no-restricted-syntax`), so this is the custom
// selector they point at. The tractable, low-noise signal is an enum-like union: when
// FOUR or more string literals are OR-ed into a type, each is a discriminant whose
// spelling rarely reveals its role (`'diamond-filled'` → agent), so each must become a
// named const referenced via `typeof`. Below the threshold (`'ltr' | 'rtl'`) the
// literals are self-evident and naming is pure noise — left alone. A long but obvious
// union (`'GET' | 'POST' | …`) is the expected false positive: disable with a reason,
// the same escape hatch as no-console.
const UNION_LITERAL_THRESHOLD = 4;
export const namedLiteralPlugin = {
  rules: {
    'name-union-members': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Enum-like string-literal union members must be named constants.' },
        messages: {
          nameIt:
            'Name this union member — `const AGENT_GLYPH_KIND = "diamond-filled"`, then `type GlyphKind = typeof AGENT_GLYPH_KIND | …`. A bare literal in a {{count}}-member union carries meaning a name should hold. Disable with a reason for a self-evident union.',
        },
      },
      create(context) {
        function isStringLiteralType(member) {
          return (
            member.type === 'TSLiteralType' &&
            member.literal.type === 'Literal' &&
            typeof member.literal.value === 'string'
          );
        }
        function checkUnion(node) {
          const stringMembers = node.types.filter(isStringLiteralType);
          if (stringMembers.length < UNION_LITERAL_THRESHOLD) return;
          const data = { count: String(stringMembers.length) };
          stringMembers.forEach((member) =>
            context.report({ node: member, messageId: 'nameIt', data }),
          );
        }
        return { TSUnionType: checkUnion };
      },
    },
  },
};
