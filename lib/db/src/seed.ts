/**
 * Comprehensive seed: projects → partners → agreements → production records
 * → sample users → project assignments → activity log.
 *
 * Run with: pnpm --filter @workspace/db run seed
 *
 * Idempotent: uses onConflictDoUpdate / onConflictDoNothing throughout.
 * Clerk user IDs use "user_sample_" prefix for easy identification in Admin.
 */
import {
  db,
  usersTable,
  projectsTable,
  partnersTable,
  agreementsTable,
  productionRecordsTable,
  userProjectAssignmentsTable,
  activityTable,
} from "./index.js";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding Hevea Partners sample data…");

  // ── 1. Projects ────────────────────────────────────────────────────────

  const projectRows = await db
    .insert(projectsTable)
    .values([
      {
        name: "Manu Valley Plantation",
        description: "Primary rubber plantation in the Manu River valley",
        location: "Manu Valley",
        village: "Manu Bazar",
        district: "West Tripura",
        state: "Tripura",
        landArea: 48,
        landAreaUnit: "kani",
        landNotionalValue: 3200000,
        landValuePerUnit: 66667,
        status: "developing" as const,
        startDate: "2021-03-15",
        expectedMaturityDate: "2028-03-15",
        termYears: 35,
        notes: "Phase 1 planting complete; Phase 2 underway",
      },
      {
        name: "Gandacherra Block B",
        description: "Northern block extension of the Gandacherra estate",
        location: "Gandacherra",
        village: "Gandacherra North",
        district: "Dhalai",
        state: "Tripura",
        landArea: 32,
        landAreaUnit: "kani",
        landNotionalValue: 2100000,
        landValuePerUnit: 65625,
        status: "planning" as const,
        startDate: "2023-07-01",
        expectedMaturityDate: "2030-07-01",
        termYears: 35,
        notes: "Land survey completed; saplings procurement initiated",
      },
      {
        name: "Ambassa Northern Plot",
        description: "Mature plantation approaching tapping stage",
        location: "Ambassa",
        village: "Ambassa",
        district: "Khowai",
        state: "Tripura",
        landArea: 22,
        landAreaUnit: "kani",
        landNotionalValue: 1540000,
        landValuePerUnit: 70000,
        status: "maturing" as const,
        startDate: "2018-01-10",
        expectedMaturityDate: "2025-01-10",
        termYears: 35,
        notes: "First tapping expected Q2 2025",
      },
    ])
    .onConflictDoNothing()
    .returning();

  // If already seeded, fetch existing
  const allProjects =
    projectRows.length > 0
      ? projectRows
      : await db
          .select()
          .from(projectsTable)
          .orderBy(projectsTable.createdAt)
          .limit(3);

  const [p1, p2, p3] = allProjects;

  if (!p1 || !p2 || !p3) {
    console.error("❌ Expected at least 3 projects; aborting.");
    process.exit(1);
  }

  console.log(`  ✓ ${allProjects.length} projects`);

  // ── 2. Partners ────────────────────────────────────────────────────────

  const partnerRows = await db
    .insert(partnersTable)
    .values([
      {
        name: "Ramesh Debbarma",
        role: "developer",
        email: "ramesh@heveapartners.in",
        phone: "+91-9876543210",
        address: "12 Agartala Road, West Tripura",
        clerkUserId: "user_sample_developer",
        notes: "Lead project developer",
      },
      {
        name: "Sukumar Tripura",
        role: "landowner",
        email: "sukumar@example.in",
        phone: "+91-9876543211",
        address: "Manu Valley Village, West Tripura",
        clerkUserId: "user_sample_landowner1",
        notes: "Primary landowner for Manu Valley",
      },
      {
        name: "Birendra Reang",
        role: "landowner",
        email: "birendra@example.in",
        phone: "+91-9876543212",
        address: "Gandacherra North, Dhalai",
        clerkUserId: "user_sample_landowner2",
        notes: "Landowner for Gandacherra Block B",
      },
      {
        name: "Dilip Jamatia",
        role: "investor",
        email: "dilip@example.in",
        phone: "+91-9876543213",
        address: "Udaipur, South Tripura",
        clerkUserId: "user_sample_investor",
        notes: "Financial investor in Ambassa plot",
      },
    ])
    .onConflictDoNothing()
    .returning();

  const allPartners =
    partnerRows.length > 0
      ? partnerRows
      : await db
          .select()
          .from(partnersTable)
          .orderBy(partnersTable.createdAt)
          .limit(4);

  const [developer, landowner1, landowner2, investor] = allPartners;

  if (!developer || !landowner1 || !landowner2 || !investor) {
    console.error("❌ Expected at least 4 partners; aborting.");
    process.exit(1);
  }

  console.log(`  ✓ ${allPartners.length} partners`);

  // ── 3. Agreements ──────────────────────────────────────────────────────

  const agreementRows = await db
    .insert(agreementsTable)
    .values([
      {
        projectId: p1.id,
        landOwnerId: landowner1.id,
        projectDeveloperId: developer.id,
        executionDate: "2021-03-15",
        executionPlace: "Agartala, West Tripura",
        termYears: 35,
        landArea: 48,
        landAreaUnit: "kani",
        landNotionalValue: 3200000,
        landValuePerUnit: 66667,
        landContributionAdjustment: 0.15,
        yearlyEscalation: 5,
        ownershipShareLandowner: 40,
        ownershipShareDeveloper: 60,
        revenueModel: "fifty_percent_revenue",
        status: "active",
        northBoundary: "Manu River",
        southBoundary: "NH-44",
        eastBoundary: "Reserve Forest",
        westBoundary: "Village Road",
        notes: "Primary agreement for Manu Valley Plantation",
      },
      {
        projectId: p2.id,
        landOwnerId: landowner2.id,
        projectDeveloperId: developer.id,
        executionDate: "2023-07-01",
        executionPlace: "Gandacherra, Dhalai",
        termYears: 35,
        landArea: 32,
        landAreaUnit: "kani",
        landNotionalValue: 2100000,
        landValuePerUnit: 65625,
        landContributionAdjustment: 0.12,
        yearlyEscalation: 5,
        ownershipShareLandowner: 45,
        ownershipShareDeveloper: 55,
        revenueModel: "fifty_percent_revenue",
        status: "active",
        notes: "Gandacherra Block B agreement",
      },
      {
        projectId: p3.id,
        landOwnerId: investor.id,
        projectDeveloperId: developer.id,
        executionDate: "2018-01-10",
        executionPlace: "Khowai, Tripura",
        termYears: 35,
        landArea: 22,
        landAreaUnit: "kani",
        landNotionalValue: 1540000,
        landValuePerUnit: 70000,
        landContributionAdjustment: 0.18,
        yearlyEscalation: 5,
        ownershipShareLandowner: 35,
        ownershipShareDeveloper: 65,
        revenueModel: "contribution",
        status: "active",
        notes: "Ambassa Northern Plot — investor-backed",
      },
    ])
    .onConflictDoNothing()
    .returning();

  const allAgreements =
    agreementRows.length > 0
      ? agreementRows
      : await db
          .select()
          .from(agreementsTable)
          .orderBy(agreementsTable.createdAt)
          .limit(3);

  console.log(`  ✓ ${allAgreements.length} agreements`);

  // ── 4. Production records ──────────────────────────────────────────────

  const prodRows = await db
    .insert(productionRecordsTable)
    .values([
      {
        projectId: p3.id,
        recordedAt: new Date("2024-06-15"),
        productionKg: 280,
        soldKg: 280,
        sellingPricePerKg: 185,
        revenue: 51800,
        notes: "First tapping batch, Ambassa",
      },
      {
        projectId: p3.id,
        recordedAt: new Date("2024-07-20"),
        productionKg: 320,
        soldKg: 300,
        sellingPricePerKg: 190,
        revenue: 57000,
        notes: "Second batch — 20 kg retained for quality testing",
      },
      {
        projectId: p3.id,
        recordedAt: new Date("2024-09-10"),
        productionKg: 410,
        soldKg: 410,
        sellingPricePerKg: 192,
        revenue: 78720,
        notes: "September tapping",
      },
      {
        projectId: p3.id,
        recordedAt: new Date("2024-11-05"),
        productionKg: 375,
        soldKg: 375,
        sellingPricePerKg: 195,
        revenue: 73125,
        notes: "Post-monsoon tapping",
      },
      {
        projectId: p1.id,
        recordedAt: new Date("2024-12-01"),
        productionKg: 140,
        soldKg: 120,
        sellingPricePerKg: 188,
        revenue: 22560,
        notes: "Trial tapping from early-maturing trees, Manu Valley",
      },
      {
        projectId: p1.id,
        recordedAt: new Date("2025-01-15"),
        productionKg: 210,
        soldKg: 210,
        sellingPricePerKg: 193,
        revenue: 40530,
        notes: "January tapping",
      },
    ])
    .onConflictDoNothing()
    .returning();

  const prodCount =
    prodRows.length > 0
      ? prodRows.length
      : (
          await db
            .select({ id: productionRecordsTable.id })
            .from(productionRecordsTable)
        ).length;

  console.log(`  ✓ ${prodCount} production records`);

  // ── 5. Users ───────────────────────────────────────────────────────────

  const sampleUsers = [
    {
      clerkUserId: "user_sample_admin",
      role: "admin" as const,
      displayName: "Ranjit Majumdar",
      email: "admin@heveapartners.in",
    },
    {
      clerkUserId: "user_sample_developer",
      role: "developer" as const,
      displayName: "Ramesh Debbarma",
      email: "ramesh@heveapartners.in",
    },
    {
      clerkUserId: "user_sample_landowner1",
      role: "landowner" as const,
      displayName: "Sukumar Tripura",
      email: "sukumar@example.in",
    },
    {
      clerkUserId: "user_sample_landowner2",
      role: "landowner" as const,
      displayName: "Birendra Reang",
      email: "birendra@example.in",
    },
    {
      clerkUserId: "user_sample_investor",
      role: "investor" as const,
      displayName: "Dilip Jamatia",
      email: "dilip@example.in",
    },
    {
      clerkUserId: "user_sample_employee",
      role: "employee" as const,
      displayName: "Priya Sharma",
      email: "priya@heveapartners.in",
    },
    {
      clerkUserId: "user_sample_staff",
      role: "operational_staff" as const,
      displayName: "Raju Das",
      email: "raju@heveapartners.in",
    },
  ];

  const insertedUsers: Array<{ id: string; clerkUserId: string }> = [];

  for (const u of sampleUsers) {
    const [row] = await db
      .insert(usersTable)
      .values(u)
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
        set: {
          role: u.role,
          displayName: u.displayName,
          email: u.email,
          updatedAt: new Date(),
        },
      })
      .returning({ id: usersTable.id, clerkUserId: usersTable.clerkUserId });
    if (row) insertedUsers.push(row);
  }

  console.log(`  ✓ ${insertedUsers.length} users`);

  // ── 6. Project assignments ─────────────────────────────────────────────

  const userMap = new Map(insertedUsers.map((u) => [u.clerkUserId, u.id]));

  const assignmentSpecs = [
    { clerkUserId: "user_sample_developer", projectId: p1.id },
    { clerkUserId: "user_sample_developer", projectId: p2.id },
    { clerkUserId: "user_sample_developer", projectId: p3.id },
    { clerkUserId: "user_sample_landowner1", projectId: p1.id },
    { clerkUserId: "user_sample_landowner2", projectId: p2.id },
    { clerkUserId: "user_sample_investor", projectId: p3.id },
    { clerkUserId: "user_sample_employee", projectId: p1.id },
    { clerkUserId: "user_sample_staff", projectId: p1.id },
  ];

  let assignCount = 0;
  for (const a of assignmentSpecs) {
    const userId = userMap.get(a.clerkUserId);
    if (!userId) continue;
    await db
      .insert(userProjectAssignmentsTable)
      .values({ userId, projectId: a.projectId })
      .onConflictDoNothing();
    assignCount++;
  }

  console.log(`  ✓ ${assignCount} project assignments`);

  // ── 7. Activity log ────────────────────────────────────────────────────

  await db
    .insert(activityTable)
    .values([
      {
        type: "project_created",
        description: `New project "${p1.name}" created`,
        entityId: p1.id,
        entityType: "project",
      },
      {
        type: "project_created",
        description: `New project "${p2.name}" created`,
        entityId: p2.id,
        entityType: "project",
      },
      {
        type: "project_created",
        description: `New project "${p3.name}" created`,
        entityId: p3.id,
        entityType: "project",
      },
      {
        type: "partner_registered",
        description: `Partner "${developer.name}" (developer) registered`,
        entityId: developer.id,
        entityType: "partner",
      },
      {
        type: "partner_registered",
        description: `Partner "${landowner1.name}" (landowner) registered`,
        entityId: landowner1.id,
        entityType: "partner",
      },
      {
        type: "partner_registered",
        description: `Partner "${landowner2.name}" (landowner) registered`,
        entityId: landowner2.id,
        entityType: "partner",
      },
      {
        type: "partner_registered",
        description: `Partner "${investor.name}" (investor) registered`,
        entityId: investor.id,
        entityType: "partner",
      },
      {
        type: "agreement_created",
        description: `New agreement created for project "${p1.name}"`,
        entityId: allAgreements[0]?.id ?? p1.id,
        entityType: "agreement",
      },
      {
        type: "agreement_created",
        description: `New agreement created for project "${p2.name}"`,
        entityId: allAgreements[1]?.id ?? p2.id,
        entityType: "agreement",
      },
      {
        type: "agreement_created",
        description: `New agreement created for project "${p3.name}"`,
        entityId: allAgreements[2]?.id ?? p3.id,
        entityType: "agreement",
      },
    ])
    .onConflictDoNothing();

  console.log("  ✓ Activity log seeded");

  console.log("\n✅ Hevea Partners seed complete.");
  console.log(`   Projects: ${allProjects.map((p) => p.name).join(", ")}`);
  console.log("   Roles: admin, developer, landowner (×2), investor, employee, operational_staff");
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
