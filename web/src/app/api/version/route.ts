import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  let versionInfo: Record<string, unknown> = {
    status: "ok",
    node: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };

  try {
    const versionPath = path.join(process.cwd(), "public", "version.json");
    if (fs.existsSync(versionPath)) {
      const fileData = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
      versionInfo = { ...versionInfo, ...fileData };
    }
  } catch {
    // ignore filesystem read error
  }

  return NextResponse.json(versionInfo, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
