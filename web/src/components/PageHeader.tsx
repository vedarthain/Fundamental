import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  eyebrow,
  subtitle,
  right,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={`flex flex-wrap items-center justify-between gap-2 pb-1.5 mb-2.5 border-b hairline max-w-5xl ${className}`}
    >
      <div className="min-w-0 flex items-baseline gap-2 truncate">
        {eyebrow ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] muted-text shrink-0">
            {eyebrow} ·
          </span>
        ) : null}
        <h1 className="font-display text-[17px] md:text-[18px] font-semibold leading-tight tracking-tight shrink-0">
          {title}
        </h1>
        {subtitle ? (
          <span className="text-[12px] muted-text truncate hidden sm:inline">
            — {subtitle}
          </span>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0 flex-wrap">{right}</div> : null}
    </header>
  );
}
