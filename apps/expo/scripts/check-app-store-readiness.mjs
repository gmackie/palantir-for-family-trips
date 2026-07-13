import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const appDir = path.resolve(import.meta.dirname, "..");

const checks = [
  {
    file: "app.config.ts",
    placeholder: "change-me.example.com",
    message: "Replace the placeholder associated domain.",
  },
  {
    file: "app.config.ts",
    placeholder: "your-project-id",
    message: "Replace the placeholder Expo project id.",
  },
  {
    file: "fastlane/metadata/en-US/name.txt",
    placeholder: "Your App Name",
    message: "Replace the placeholder App Store name.",
  },
  {
    file: "fastlane/metadata/en-US/privacy_url.txt",
    placeholder: "https://yourapp.com/privacy",
    message: "Replace the placeholder privacy policy URL.",
  },
  {
    file: "fastlane/metadata/en-US/support_url.txt",
    placeholder: "https://yourapp.com/support",
    message: "Replace the placeholder support URL.",
  },
  {
    file: "fastlane/metadata/en-US/subtitle.txt",
    placeholder: "Your app subtitle",
    message: "Replace the placeholder App Store subtitle.",
  },
  {
    file: "fastlane/metadata/en-US/description.txt",
    placeholder: "Your full app description",
    message: "Replace the placeholder App Store description.",
  },
  {
    file: "fastlane/metadata/en-US/keywords.txt",
    placeholder: "keyword1",
    message: "Replace the placeholder App Store keywords.",
  },
  {
    file: "fastlane/metadata/en-US/promotional_text.txt",
    placeholder: "Download our app today!",
    message: "Replace the placeholder promotional text.",
  },
];

const limits = [
  { file: "fastlane/metadata/en-US/subtitle.txt", max: 30 },
  { file: "fastlane/metadata/en-US/keywords.txt", max: 100 },
  { file: "fastlane/metadata/en-US/promotional_text.txt", max: 170 },
  { file: "fastlane/metadata/en-US/description.txt", max: 4000 },
  { file: "fastlane/metadata/en-US/release_notes.txt", max: 4000 },
];

const failures = [];

for (const check of checks) {
  const filePath = path.join(appDir, check.file);
  const content = fs.readFileSync(filePath, "utf8");

  if (content.includes(check.placeholder)) {
    failures.push(`${check.file}: ${check.message}`);
  }
}

for (const limit of limits) {
  const filePath = path.join(appDir, limit.file);
  const content = fs.readFileSync(filePath, "utf8").trim();

  if (content.length > limit.max) {
    failures.push(
      `${limit.file}: ${content.length} characters exceeds the ${limit.max}-character App Store limit.`,
    );
  }
}

if (failures.length > 0) {
  console.error("App Store readiness check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("App Store readiness check passed.");
