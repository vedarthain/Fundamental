"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Logo always targets the marketing `/`. `/dashboard` is unfinished and
 * lives in the account menu — do not steal the public land for it.
 */
export function BrandLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href="/" className={className}>
      {children}
    </Link>
  );
}
