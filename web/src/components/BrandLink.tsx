"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session-client";
import { SIGNED_IN_HOME } from "@/lib/homePath";

/**
 * Logo target: marketing `/` while signed out (and while session is unknown,
 * so anonymous visitors never flash a private route). Signed-in → /dashboard,
 * which redirects to portfolio or watchlist. Footer should keep `/`.
 */
export function BrandLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { user, loading } = useSession();
  const href = !loading && user ? SIGNED_IN_HOME : "/";
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
