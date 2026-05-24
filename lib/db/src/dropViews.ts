import { Client } from "pg";

const VIEWS_TO_DROP = ["partner_financial_position_v"];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; cannot drop views.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const view of VIEWS_TO_DROP) {
      console.log(`[dropViews] DROP VIEW IF EXISTS ${view} CASCADE`);
      await client.query(`DROP VIEW IF EXISTS ${view} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[dropViews] FAILED:", err);
  process.exit(1);
});
