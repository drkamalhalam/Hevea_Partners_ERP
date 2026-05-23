/**
 * backfill_project_parcels.ts
 *
 * One-shot, idempotent backfill that materialises one `project_parcels` row
 * per legacy project whose Schedule-A data still lives in the inlined survey
 * columns on `projects` (khatianNumber, plotNumber, mouja, landArea, …).
 *
 * Safe to re-run: it only inserts a parcel for projects that currently have
 * ZERO rows in `project_parcels`, so subsequent runs are no-ops once a
 * project's Schedule A has been populated by either this script or the
 * wizard.
 *
 * Behaviour:
 *   - landType defaults to whatever is on the legacy column; falls back to
 *     "recorded" when null (matches the pre-Prompt-6 wizard default).
 *   - landArea / landAreaUnit are required; rows with NULL/zero legacy
 *     landArea are skipped and logged so they remain visible for manual
 *     follow-up rather than silently inserting bogus zero-area parcels.
 *   - position is hard-coded to 1 (single inherited parcel).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill:parcels
 */
import { db, projectsTable, projectParcelsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

async function main() {
  const projects = await db.select().from(projectsTable);
  let created = 0;
  let skippedExisting = 0;
  let skippedNoArea = 0;

  for (const p of projects) {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(projectParcelsTable)
      .where(eq(projectParcelsTable.projectId, p.id));

    if (Number(c) > 0) {
      skippedExisting += 1;
      continue;
    }

    if (!p.landArea || Number(p.landArea) <= 0) {
      skippedNoArea += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] project ${p.id} (${p.name}) has no legacy landArea — skipping; please add a parcel manually.`,
      );
      continue;
    }

    await db.insert(projectParcelsTable).values({
      projectId: p.id,
      position: 1,
      landType: (p.landType as string | null) ?? "recorded",
      khatianNumber: p.khatianNumber ?? null,
      plotNumber: p.plotNumber ?? null,
      mouja: p.mouja ?? null,
      tahsil: p.tahsil ?? null,
      landAreaName: p.landAreaName ?? null,
      postOffice: p.postOffice ?? null,
      policeStation: p.policeStation ?? null,
      landBoundaryDescription: p.landBoundaryDescription ?? null,
      gpsCoordinates: p.gpsCoordinates ?? null,
      landArea: Number(p.landArea),
      landAreaUnit: p.landAreaUnit ?? "kani",
      notes: "Auto-backfilled from legacy inlined Schedule A fields.",
    });
    created += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[backfill_project_parcels] done · created=${created} · skipped_existing=${skippedExisting} · skipped_no_area=${skippedNoArea} · total_projects=${projects.length}`,
  );
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[backfill_project_parcels] failed", err);
  process.exit(1);
});
