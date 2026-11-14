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
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2.5 mb-3 border-b hairline ${className}`}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] muted-text mb-0.5">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-display text-[18px] md:text-[20px] font-semibold leading-tight tracking-tight truncate">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-[12px] muted-text mt-0.5 line-clamp-1">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0 flex-wrap">{right}</div> : null}
    </header>
  );
}
