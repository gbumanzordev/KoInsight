import { z } from 'zod';

// Narrow schema: only the fields this milestone reads (P27 for nationality, P297 for ISO alpha-2).
// Per 03-RESEARCH §Pitfall 4: full entity response can be 200KB; we ignore everything else.
// Per Pitfall 7: datavalue is optional (snaktype may be 'novalue'/'somevalue').

const ClaimRankSchema = z.enum(['preferred', 'normal', 'deprecated']);

export const P27ClaimSchema = z.object({
  mainsnak: z.object({
    snaktype: z.string(),
    property: z.literal('P27'),
    datavalue: z
      .object({
        value: z.object({
          id: z.string().regex(/^Q[0-9]+$/),
        }),
        type: z.literal('wikibase-entityid'),
      })
      .optional(),
  }),
  rank: ClaimRankSchema,
  qualifiers: z
    .object({
      // Presence is what matters per WD-03; we don't inspect the time value.
      P582: z.array(z.unknown()).optional(),
    })
    .partial()
    .optional(),
});
export type P27Claim = z.infer<typeof P27ClaimSchema>;

const P297ClaimSchema = z.object({
  mainsnak: z.object({
    snaktype: z.string(),
    datavalue: z
      .object({
        // Wikidata stores alpha-2 as a plain string value for P297.
        value: z.string(),
      })
      .optional(),
  }),
});

export const WikidataEntitySchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      id: z.string(),
      claims: z
        .object({
          P27: z.array(P27ClaimSchema).optional(),
          P297: z.array(P297ClaimSchema).optional(),
        })
        .partial()
        .optional(),
    })
  ),
});
export type WikidataEntity = z.infer<typeof WikidataEntitySchema>;
