/**
 * A single deterministic, dollar-quantified candidate for the weekly advisor digest.
 * All figures are computed in code (the math engine); the LLM only ranks and narrates.
 */
export interface DigestSignal {
  /** Coarse signal family, used for grouping/telemetry. */
  kind:
    | 'category_delta'
    | 'top_driver'
    | 'upcoming_bill'
    | 'subscription_change'
    | 'anomaly';
  /** Short human label, e.g. "Dining up week-over-week". */
  label: string;
  /** Absolute dollar magnitude (cents) used to rank candidates. */
  amountCents: number;
  /** One factual sentence with the concrete figure(s) — the LLM must reuse these numbers verbatim. */
  detail: string;
  /** Where the number came from, e.g. "category spending, last week vs the week before". */
  provenance: string;
}

/** The assembled weekly digest ready for delivery. */
export interface AdvisorDigest {
  title: string;
  /** Markdown body: the ranked, narrated top items. */
  message: string;
  /** Short spoken summary for the Home Assistant / voice surface. */
  voiceSummary: string;
  /** The ranked signals the narration was built from (for provenance in metadata). */
  signals: DigestSignal[];
}
