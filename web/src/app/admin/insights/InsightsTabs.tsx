"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export type InsightsSection = "all" | "app" | "db" | "web";

export default function InsightsTabs({
  activeSection,
  range,
}: {
  activeSection: InsightsSection;
  range: string;
}) {
  const router = useRouter();

  const tabs: { id: InsightsSection; label: string; icon: string; count?: string }[] = [
    { id: "all", label: "All Insights", icon: "🌐" },
    { id: "web", label: "Website & Traffic", icon: "📊" },
    { id: "app", label: "App Server", icon: "🖥️" },
    { id: "db", label: "DB Server", icon: "🗄️" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border hairline w-fit text-xs font-medium">
      {tabs.map((tab) => {
        const isActive = activeSection === tab.id;
        const href = `/admin/insights?range=${range}&section=${tab.id}`;
        return (
          <Link
            key={tab.id}
            href={href}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              isActive
                ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-semibold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
