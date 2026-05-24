import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, "views");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; cannot apply views.");
  }

  const sqlFiles = readdirSync(VIEWS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (sqlFiles.length === 0) {
    console.log("[applyViews] No .sql files found in", VIEWS_DIR);
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of sqlFiles) {
      const sql = readFileSync(join(VIEWS_DIR, file), "utf8");
      console.log(`[applyViews] Applying ${file} …`);
      await client.query(sql);
    }
    console.log(`[applyViews] Applied ${sqlFiles.length} view file(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[applyViews] FAILED:", err);
  process.exit(1);
});
