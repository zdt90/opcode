/**
 * Renames the built DMG to include the short git commit hash.
 * e.g. opcode_0.2.1_aarch64.dmg -> opcode_0.2.1_aarch64-abc1234.dmg
 *
 * Run automatically after `tauri build --bundles dmg` via the build:dmg script.
 */
import { execSync } from "node:child_process";
import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const hash = execSync("git rev-parse --short HEAD").toString().trim();
const dmgDir = "src-tauri/target/release/bundle/dmg";

const files = readdirSync(dmgDir).filter(
  (f) => f.endsWith(".dmg") && !f.includes(hash)
);

if (files.length === 0) {
  console.log("No DMG files to rename (already up to date).");
  process.exit(0);
}

for (const file of files) {
  const newName = file.replace(/\.dmg$/, `-${hash}.dmg`);
  renameSync(join(dmgDir, file), join(dmgDir, newName));
  console.log(`✓ ${file} → ${newName}`);
}
