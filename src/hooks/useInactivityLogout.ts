"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

export function useInactivityLogout() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/");
      }, TIMEOUT_MS);
    };

    // Start timer and attach listeners
    reset();
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));

    return () => {
      if (timer.current) clearTimeout(timer.current);
      EVENTS.forEach(e => window.removeEventListener(e, reset));
    };
  }, [router]);
}
