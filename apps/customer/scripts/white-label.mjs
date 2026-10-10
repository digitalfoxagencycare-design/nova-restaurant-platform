#!/usr/bin/env node
// Stamp a restaurant's identity into the Android project before building it in CI.
//   VITE_TENANT=my-place APP_NAME="My Place" node scripts/white-label.mjs
// Edits capacitor.config.json, android/app/build.gradle (applicationId only; the Java namespace stays) and strings.xml.
// Run it on a CI checkout, never commit the result.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = (process.env.VITE_TENANT || "").trim().toLowerCase();
const name = (process.env.APP_NAME || process.env.VITE_APP_NAME || "Restaurant").trim();
if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(code)) {
  console.error("Set VITE_TENANT to the restaurant code (letters, digits, dashes).");
  process.exit(1);
}
// Android application ids: dot separated segments that start with a letter; digits-only codes get a prefix.
const seg = code.replace(/[^a-z0-9]/g, "");
const appId = `com.nova.${/^[a-z]/.test(seg) ? seg : "r" + seg}`;

const capFile = join(root, "capacitor.config.json");
const cap = JSON.parse(readFileSync(capFile, "utf8"));
cap.appId = appId;
cap.appName = name;
writeFileSync(capFile, JSON.stringify(cap, null, 2) + "\n");

const gradle = join(root, "android/app/build.gradle");
writeFileSync(gradle, readFileSync(gradle, "utf8").replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`));

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const strings = join(root, "android/app/src/main/res/values/strings.xml");
let s = readFileSync(strings, "utf8");
s = s.replace(/(<string name="app_name">)[^<]*/, `$1${xml(name)}`).replace(/(<string name="title_activity_main">)[^<]*/, `$1${xml(name)}`)
  .replace(/(<string name="package_name">)[^<]*/, `$1${appId}`).replace(/(<string name="custom_url_scheme">)[^<]*/, `$1${appId}`);
writeFileSync(strings, s);
console.log(`Android project stamped: ${appId} / "${name}"`);
