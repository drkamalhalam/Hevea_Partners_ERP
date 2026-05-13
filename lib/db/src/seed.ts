/**
 * Seeds sample users with all 6 roles and assigns them to projects.
 * Run with: pnpm --filter @workspace/db run seed
 * These are demo accounts visible in the Admin panel for testing RBAC.
 * Clerk User IDs use a "user_sample_" prefix so they're easily identifiable.
 */
import { db, userRolesTable, userProjectAssignmentsTable, projectsTable } from "./index.js";

async function seed() {
  console.log("🌱 Seeding sample users…");

  const projects = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .orderBy(projectsTable.id);

  if (projects.length === 0) {
    console.error("❌ No projects found. Seed the projects table first.");
    process.exit(1);
  }

  const [p1, p2, p3] = [projects[0], projects[1] ?? projects[0], projects[2] ?? projects[0]];

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

  for (const u of sampleUsers) {
    await db
      .insert(userRolesTable)
      .values(u)
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
        set: {
          role: u.role,
          displayName: u.displayName,
          email: u.email,
          updatedAt: new Date(),
        },
      });
  }

  const assignments: Array<{ clerkUserId: string; projectId: number }> = [
    { clerkUserId: "user_sample_developer", projectId: p1.id },
    { clerkUserId: "user_sample_developer", projectId: p2.id },
    { clerkUserId: "user_sample_developer", projectId: p3.id },
    { clerkUserId: "user_sample_landowner1", projectId: p1.id },
    { clerkUserId: "user_sample_landowner2", projectId: p2.id },
    { clerkUserId: "user_sample_investor", projectId: p3.id },
    { clerkUserId: "user_sample_employee", projectId: p1.id },
    { clerkUserId: "user_sample_staff", projectId: p1.id },
  ];

  for (const a of assignments) {
    await db.insert(userProjectAssignmentsTable).values(a).onConflictDoNothing();
  }

  console.log(`✅ Seeded ${sampleUsers.length} sample users across ${projects.length} projects.`);
  console.log("   Projects assigned:");
  console.log(`   • developer → all ${projects.length} projects`);
  console.log(`   • landowner1, employee, staff → ${p1.name}`);
  console.log(`   • landowner2 → ${p2.name}`);
  console.log(`   • investor → ${p3.name}`);
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
