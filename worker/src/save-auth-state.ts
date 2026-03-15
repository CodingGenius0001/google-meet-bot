import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const storageStatePath =
  process.env.GOOGLE_MEET_STORAGE_STATE_PATH ??
  path.resolve(process.cwd(), "worker", ".auth", "google-user.json");

async function main() {
  await mkdir(path.dirname(storageStatePath), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1440,960"]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 }
  });

  const page = await context.newPage();
  await page.goto("https://accounts.google.com/");

  console.log("Log into the Google account that should join meetings, then press Enter here.");

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  await context.storageState({ path: storageStatePath });
  await browser.close();

  console.log(`Saved auth state to ${storageStatePath}`);
  console.log("For Railway, convert that file to base64 and store it in GOOGLE_MEET_STORAGE_STATE_BASE64.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
