import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import fs from "fs";
import path from "path";

const LOG_FILES: Record<string, string> = {
  drift: "/var/log/fundamental-daily-drift.log",
  sunday: "/var/log/fundamental-sunday-calls.log",
};

export async function GET(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "drift";
  const linesParam = parseInt(searchParams.get("lines") || "200", 10);
  const maxLines = Math.min(Math.max(isNaN(linesParam) ? 200 : linesParam, 10), 1000);

  const filePath = LOG_FILES[type] || LOG_FILES.drift;

  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({
        success: true,
        type,
        filePath,
        content: `Log file not found at ${filePath}. Logs will be created when the cron job runs on the Droplet.`,
        linesCount: 0,
        modifiedAt: null,
        sizeBytes: 0,
      });
    }

    const stat = fs.statSync(filePath);
    // Read the file with a buffer window for efficiency if large
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const allLines = fileContent.split("\n");
    const tailLines = allLines.slice(-maxLines);

    return NextResponse.json({
      success: true,
      type,
      filePath: path.basename(filePath),
      content: tailLines.join("\n"),
      linesCount: tailLines.length,
      totalLines: allLines.length,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to read log file" },
      { status: 500 }
    );
  }
}
