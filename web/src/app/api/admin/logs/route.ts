import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const LOG_FILES: Record<string, string> = {
  drift: "/var/log/fundamental-daily-drift.log",
  sunday: "/var/log/fundamental-sunday-calls.log",
  ltp: "/var/log/fundamental-refresh-ltp.log",
  compute: "/var/log/fundamental-weekly-compute.log",
  scanner: "/var/log/fundamental-momentum-scanner.log",
  backup: "/var/log/fundamental-db-backup.log",
  reload: "/var/log/fundamental-pm2-reload.log",
  monitor: "/var/log/fundamental-monitor.log",
};

const CRON_SCRIPTS: Record<string, string> = {
  drift: "scripts/cron-daily-drift.sh",
  sunday: "scripts/cron-sunday-calls.sh",
  ltp: "scripts/cron-refresh-ltp.sh",
  compute: "scripts/cron-weekly-compute.sh",
  scanner: "scripts/cron-momentum-scanner.sh",
  backup: "scripts/cron-db-backup.sh",
  monitor: "scripts/cron-monitor.sh",
};

type ArchiveInfo = {
  fileName: string;
  label: string;
  sizeBytes: number;
  modifiedAt: string;
};

function discoverArchives(baseFilePath: string): ArchiveInfo[] {
  const dir = path.dirname(baseFilePath);
  const base = path.basename(baseFilePath);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir).filter((f) => f === base || f.startsWith(`${base}.`));
  const out: ArchiveInfo[] = [];

  for (const name of entries) {
    try {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;

      let label = "Current";
      if (name !== base) {
        const suffix = name.slice(base.length + 1); // e.g. "1" or "2.gz"
        const num = parseInt(suffix, 10);
        if (num === 1) label = "Previous (.1)";
        else if (!Number.isNaN(num)) label = `Archive #${num} (.${suffix})`;
        else label = suffix;
      }

      out.push({
        fileName: name,
        label,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // ignore unreadable entry
    }
  }

  // Sort: current first, then numeric rotation order (.1, .2.gz, ...)
  out.sort((a, b) => {
    if (a.fileName === base) return -1;
    if (b.fileName === base) return 1;
    const na = parseInt(a.fileName.slice(base.length + 1), 10) || 999;
    const nb = parseInt(b.fileName.slice(base.length + 1), 10) || 999;
    return na - nb;
  });

  return out;
}

function readLogFile(fullPath: string): string {
  if (fullPath.endsWith(".gz")) {
    const buf = fs.readFileSync(fullPath);
    return zlib.gunzipSync(buf).toString("utf-8");
  }
  return fs.readFileSync(fullPath, "utf-8");
}

export async function GET(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "drift";
  const requestedFile = searchParams.get("file");
  const linesParam = parseInt(searchParams.get("lines") || "200", 10);
  const maxLines = Math.min(Math.max(isNaN(linesParam) ? 200 : linesParam, 10), 1000);

  const baseFilePath = LOG_FILES[type] || LOG_FILES.drift;
  const dir = path.dirname(baseFilePath);

  try {
    const archives = discoverArchives(baseFilePath);

    if (archives.length === 0) {
      return NextResponse.json({
        success: true,
        type,
        filePath: path.basename(baseFilePath),
        selectedFile: path.basename(baseFilePath),
        archives: [],
        content: `Log file not found at ${baseFilePath}. Logs will be created when the cron job runs on the Droplet.`,
        linesCount: 0,
        totalLines: 0,
        modifiedAt: null,
        sizeBytes: 0,
      });
    }

    // Strict allowlist against discovered archives prevents path traversal
    let chosen = requestedFile ? archives.find((a) => a.fileName === requestedFile) : undefined;
    if (!chosen) {
      // If current file is 0 bytes (just rotated at midnight), auto-select the newest non-empty archive
      const current = archives[0];
      const nonEmpty = archives.find((a) => a.sizeBytes > 0);
      chosen = current.sizeBytes === 0 && nonEmpty ? nonEmpty : current;
    }

    const targetPath = path.join(dir, chosen.fileName);
    const fileContent = readLogFile(targetPath);
    const allLines = fileContent.split("\n");
    const tailLines = allLines.slice(-maxLines);

    return NextResponse.json({
      success: true,
      type,
      filePath: chosen.fileName,
      selectedFile: chosen.fileName,
      archives,
      content: tailLines.join("\n"),
      linesCount: tailLines.length,
      totalLines: allLines.length,
      modifiedAt: chosen.modifiedAt,
      sizeBytes: chosen.sizeBytes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to read log file" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const type = String(body?.type || "ltp");
    const mode = String(body?.mode || "today");
    const customDate = body?.customDate ? String(body.customDate).trim() : "";

    const baseLogPath = LOG_FILES[type];
    const cronScript = CRON_SCRIPTS[type];
    if (!baseLogPath || !cronScript) {
      return NextResponse.json({ error: `Unsupported job type: ${type}` }, { status: 400 });
    }

    const repoRoot = fs.existsSync("/var/www/Fundamental/scripts")
      ? "/var/www/Fundamental"
      : path.resolve(process.cwd(), "..");

    let cmd = "bash";
    let args = [path.join(repoRoot, cronScript)];
    let description = `Triggered ${cronScript}`;

    if (type === "ltp" && mode !== "today") {
      const venvPython = path.join(repoRoot, ".venv", "bin", "python");
      const etlPython = path.join(repoRoot, "etl", ".venv", "bin", "python");
      cmd = fs.existsSync(venvPython)
        ? venvPython
        : fs.existsSync(etlPython)
          ? etlPython
          : "python3";

      const scriptPath = path.join(repoRoot, "scripts", "refresh-ltp.py");
      if (mode === "yesterday") {
        const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
        args = [scriptPath, "--date", y];
        description = `Historical Bhavcopy backfill for ${y}`;
      } else if (mode === "7d" || mode === "14d" || mode === "30d") {
        const days = mode.replace("d", "");
        args = [scriptPath, "--days", days];
        description = `Historical Bhavcopy backfill for last ${days} days`;
      } else if (mode === "custom") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
          return NextResponse.json({ error: "Invalid customDate (expected YYYY-MM-DD)" }, { status: 400 });
        }
        args = [scriptPath, "--date", customDate];
        description = `Historical Bhavcopy backfill for ${customDate}`;
      } else {
        return NextResponse.json({ error: `Unsupported mode: ${mode}` }, { status: 400 });
      }
    }

    const logDir = path.dirname(baseLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const header = `\n[${new Date().toISOString()}] ▶ Manual trigger from /admin/logs: ${description}\n`;
    fs.appendFileSync(baseLogPath, header);
    const outFd = fs.openSync(baseLogPath, "a");

    const child = spawn(cmd, args, {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", outFd, outFd],
      env: {
        ...process.env,
        FUNDAMENTAL_ALLOW_REMOTE_DB: "1",
        PYTHONUNBUFFERED: "1",
      },
    });
    child.unref();
    fs.closeSync(outFd);

    return NextResponse.json({
      success: true,
      message: `${description} (PID ${child.pid ?? "started"})`,
      type,
      mode,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to start job" },
      { status: 500 },
    );
  }
}
