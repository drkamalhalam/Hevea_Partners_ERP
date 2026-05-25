/**
 * entitlement/blockedPartners.ts
 *
 * V3 Wave 3 — Resolve the set of partner IDs that are currently blocked from
 * receiving a revenue_credit for a given project. Three independent block
 * sources are checked and merged:
 *
 *   1. Open inheritance claims (status='open'): the named partner's stake is
 *      under active succession dispute — credit withheld until claim resolves.
 *
 *   2. Disputed prematurity-succession participation records
 *      (participationStatus='disputed'): the partner is in active arbitration
 *      over prematurity contributions — revenue attribution held as a hold.
 *
 *   3. Governance override extension point: rows in governance_overrides where
 *      metadata->>'blocked_partner_id' is a non-null UUID. This column is
 *      intentionally unused today; it provides a zero-schema-change path for
 *      operators to block a partner via a governance override record.
 *
 * Returns a Set of partner UUIDs (string). Empty set = no blocks.
 */

import { eq, and, sql } from "drizzle-orm";
import {
  db as appDb,
  inheritanceClaimsTable,
  governanceOverridesTable,
  claimantParticipationRecordsTable,
} from "@workspace/db";

type AppDb = typeof appDb;

export async function getBlockedPartnerIds(
  db: AppDb,
  projectId: string,
): Promise<Set<string>> {
  const blocked = new Set<string>();

  // ── Source 1: Open inheritance claims ─────────────────────────────────────
  const inheritanceRows = await db
    .select({ partnerId: inheritanceClaimsTable.partnerId })
    .from(inheritanceClaimsTable)
    .where(
      and(
        eq(inheritanceClaimsTable.projectId, projectId),
        eq(inheritanceClaimsTable.status, "open"),
      ),
    );
  for (const row of inheritanceRows) {
    blocked.add(row.partnerId);
  }

  // ── Source 2: Disputed prematurity succession participation ───────────────
  const successionRows = await db
    .select({ partnerId: claimantParticipationRecordsTable.partnerId })
    .from(claimantParticipationRecordsTable)
    .where(
      and(
        eq(claimantParticipationRecordsTable.projectId, projectId),
        eq(claimantParticipationRecordsTable.participationStatus, "disputed"),
      ),
    );
  for (const row of successionRows) {
    blocked.add(row.partnerId);
  }

  // ── Source 3: Governance override extension point ─────────────────────────
  const overrideRows = await db
    .select({
      blockedPartnerId: sql<string | null>`${governanceOverridesTable.metadata}->>'blocked_partner_id'`,
    })
    .from(governanceOverridesTable)
    .where(
      and(
        eq(governanceOverridesTable.projectId, projectId),
        sql`${governanceOverridesTable.metadata}->>'blocked_partner_id' IS NOT NULL`,
      ),
    );
  for (const row of overrideRows) {
    if (row.blockedPartnerId) blocked.add(row.blockedPartnerId);
  }

  return blocked;
}
