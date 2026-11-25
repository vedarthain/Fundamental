"use client";

import React, { useState, useEffect, useRef } from "react";

function timeAgo(dateString: string): string {
  const seconds = Math.floor((new Date().getTime() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type LogType = "drift" | "sunday" | "ltp" | "compute" | "scanner" | "backup" | "reload" | "monitor";

interface ArchiveInfo {
  fileName: string;
  label: string;
  sizeBytes: number;
  modifiedAt: string;
}

interface LogResponse {
  success: boolean;
  type: string;
  filePath: string;
  selectedFile?: string;
  archives?: ArchiveInfo[];
  content: string;
  linesCount: number;
  totalLines: number;
  modifiedAt: string | null;
  sizeBytes: number;
}

const TABS: { id: LogType; label: string }[] = [
  { id: "drift", label: "🌙 Nightly Drift (11:00 PM)" },
  { id: "ltp", label: "📈 Bhavcopy & LTP (7:25 PM)" },
  { id: "scanner", label: "🚀 Momentum Scanners (8:30 PM)" },
  { id: "backup", label: "💾 DB Backup (7:30 AM)" },
  { id: "compute", label: "⚙️ Saturday Compute (8:30 AM)" },
  { id: "sunday", label: "☀️ Sunday Calls (2:00 PM)" },
  { id: "reload", label: "🔄 Weekly Reload (Sun 4:00 AM)" },
  { id: "monitor", label: "🩺 Cron Monitor (6h)" },
];

export function LogsViewerClient() {
  const [activeTab, setActiveTab] = useState<LogType>("drift");
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [lines, setLines] = useState<number>(200);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [logData, setLogData] = useState<LogResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [fetchMode, setFetchMode] = useState<string>("today");
  const [customDate, setCustomDate] = useState<string>(() => {
    const y = new Date(Date.now() - 86400_000);
    return y.toISOString().slice(0, 10);
  });
  const [running, setRunning] = useState<boolean>(false);
  const [runStatus, setRunStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);

  const fetchLog = async (type: LogType = activeTab, lineCount: number = lines, file: string = selectedFile) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type, lines: String(lineCount) });
      if (file) qs.set("file", file);
      const res = await fetch(`/api/admin/logs?${qs.toString()}`);
      if (res.ok) {
        const data: LogResponse = await res.json();
        setLogData(data);
      }
    } catch (err) {
      console.error("Failed to fetch log", err);
    } finally {
      setLoading(false);
    }
  };

  const triggerJob = async () => {
    if (activeTab === "reload") return;
    setRunning(true);
    setRunStatus(null);
    try {
      const res = await fetch("/api/admin/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          mode: activeTab === "ltp" ? fetchMode : "today",
          customDate: activeTab === "ltp" && fetchMode === "custom" ? customDate : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunStatus({ ok: false, text: data?.error || "Failed to start job" });
      } else {
        setRunStatus({ ok: true, text: data.message || "Job started" });
        setSelectedFile("");
        setAutoRefresh(true);
        setTimeout(() => fetchLog(activeTab, lines, ""), 800);
      }
    } catch (err: any) {
      setRunStatus({ ok: false, text: err?.message || "Request failed" });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    fetchLog(activeTab, lines, selectedFile);
  }, [activeTab, lines, selectedFile]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLog(activeTab, lines, selectedFile);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, lines, selectedFile]);

  const scrollToBottom = () => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  const copyToClipboard = () => {
    if (!logData?.content) return;
    navigator.clipboard.writeText(logData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const archives = logData?.archives ?? [];
  const activeFileName = selectedFile || logData?.selectedFile || "";

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 shadow-sm">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-lg flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setSelectedFile("");
                setRunStatus(null);
                setActiveTab(tab.id);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                activeTab === tab.id
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Options */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === "ltp" && (
            <div className="flex items-center gap-1.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-lg px-2 py-1">
              <label className="text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-1.5">
                <span>Fetch Data:</span>
                <select
                  value={fetchMode}
                  onChange={(e) => setFetchMode(e.target.value)}
                  className="bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-800 text-xs rounded px-2 py-0.5 text-zinc-800 dark:text-zinc-200"
                >
                  <option value="today">Today (Latest)</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="14d">Last 14 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="custom">Specific Date</option>
                </select>
              </label>
              {fetchMode === "custom" && (
                <input
                  type="date"
                  value={customDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-800 text-xs rounded px-2 py-0.5 text-zinc-800 dark:text-zinc-200"
                />
              )}
              <button
                onClick={triggerJob}
                disabled={running}
                className="px-2.5 py-0.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
              >
                {running ? "Starting..." : "Fetch"}
              </button>
            </div>
          )}

          {activeTab !== "ltp" && activeTab !== "reload" && (
            <button
              onClick={triggerJob}
              disabled={running}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
            >
              {running ? "Starting..." : "Run Job Now"}
            </button>
          )}

          {archives.length > 0 && (
            <label className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1" title="Switch between rotated log files">
              <span>Log File:</span>
              <select
                value={activeFileName}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-xs rounded px-2 py-1 text-zinc-800 dark:text-zinc-200 font-mono"
              >
                {archives.map((a) => (
                  <option key={a.fileName} value={a.fileName}>
                    {a.label} ({formatFileSize(a.sizeBytes)})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <span>Tail:</span>
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-xs rounded px-2 py-1 text-zinc-800 dark:text-zinc-200"
            >
              <option value={100}>100 lines</option>
              <option value={200}>200 lines</option>
              <option value={500}>500 lines</option>
              <option value={1000}>1000 lines</option>
            </select>
          </label>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1 text-xs rounded font-medium border transition-colors ${
              autoRefresh
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 animate-pulse"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {autoRefresh ? "● Auto-refreshing (6s)" : "Auto-refresh: Off"}
          </button>

          <button
            onClick={() => fetchLog(activeTab, lines)}
            disabled={loading}
            className="px-2.5 py-1 text-xs font-medium rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          <button
            onClick={copyToClipboard}
            className="px-2.5 py-1 text-xs font-medium rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>

          <button
            onClick={scrollToBottom}
            className="px-2.5 py-1 text-xs font-medium rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            Scroll to Bottom ↓
          </button>
        </div>
      </div>

      {runStatus && (
        <div
          className={`px-3 py-2 rounded-lg text-xs font-medium border ${
            runStatus.ok
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
              : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
          }`}
        >
          {runStatus.text}
        </div>
      )}

      {/* Meta stats */}
      {logData && (
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
          <div>
            File: <span className="font-mono text-zinc-700 dark:text-zinc-300">{logData.filePath}</span>
            {" · "}
            Size: <span className="font-mono">{formatFileSize(logData.sizeBytes)}</span>
            {" · "}
            Showing <span className="font-semibold">{logData.linesCount}</span> of <span className="font-semibold">{logData.totalLines}</span> lines
          </div>
          {logData.modifiedAt && (
            <div>
              Updated: <span className="font-medium text-zinc-700 dark:text-zinc-300">{timeAgo(logData.modifiedAt)}</span>
            </div>
          )}
        </div>
      )}

      {/* Terminal View */}
      <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 font-mono text-xs text-zinc-400">
              {logData?.filePath || "fundamental-pipeline.log"}
            </span>
          </div>
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
            {loading ? "Reading..." : "Live Tail"}
          </span>
        </div>

        <pre
          ref={terminalRef}
          className="p-4 font-mono text-xs leading-relaxed text-zinc-200 overflow-x-auto overflow-y-auto max-h-[650px] whitespace-pre-wrap select-text scrollbar-thin scrollbar-thumb-zinc-700"
        >
          {logData?.content || (loading ? "Loading logs from server..." : "No log data available.")}
        </pre>
      </div>
    </div>
  );
}
