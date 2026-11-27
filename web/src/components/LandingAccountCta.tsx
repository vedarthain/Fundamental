"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Client-side session-aware CTA button for the statically cached landing page.
 * Swaps "Create free account" (/signup) to "Open Portfolio" (/portfolio) once
 * the user is signed in, so signed-in users aren't repeatedly asked to sign up.
 */
export function LandingAccountCta({
  className = "btn-ghost text-[13px] sm:text-[13.5px]",
  signedOutLabel = "Create free account",
  signedInLabel = "Open Portfolio",
}: {
  className?: string;
  signedOutLabel?: string;
  signedInLabel?: string;
}) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => {
      fetch("/api/auth/me", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (active) setSignedIn(Boolean(json?.user));
        })
        .catch(() => {});
    };
    check();
    window.addEventListener("er:session-change", check);
    return () => {
      active = false;
      window.removeEventListener("er:session-change", check);
    };
  }, []);

  return (
    <Link href={signedIn ? "/portfolio" : "/signup"} className={className}>
      {signedIn ? signedInLabel : signedOutLabel}
    </Link>
  );
}
