import type { ReactNode } from "react";

/**
 * Logo always does a full navigation to the marketing landing (`/`).
 * Do not use next/link here: a client Link can keep a signed-in user
 * inside the app shell and land on `/dashboard` (the account-menu Home).
 */
export function BrandLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href="/" className={className}>
      {children}
    </a>
  );
}
