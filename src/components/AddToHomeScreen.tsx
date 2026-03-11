"use client";

import { useEffect, useState } from "react";

type InstallState = "hidden" | "android" | "ios" | "installed";

export default function AddToHomeScreen() {
  const [state, setState] = useState<InstallState>("hidden");
  const [showIOSTip, setShowIOSTip] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !("MSStream" in window);
    const isSafari =
      /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);

    if (isIOS && isSafari) {
      setState("ios");
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setState("android");
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setState("installed");
    setDeferredPrompt(null);
  };

  if (state === "hidden" || state === "installed") return null;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pb-10 pt-6 flex flex-col items-center gap-2">
      <div className="w-full h-px bg-border mb-2" />

      {state === "android" && (
        <button
          onClick={handleAndroidInstall}
          className="w-full py-3 rounded-lg bg-muted hover:bg-border text-sm font-mono text-foreground/60 hover:text-foreground transition-colors"
        >
          + Add to Home Screen
        </button>
      )}

      {state === "ios" && (
        <div className="relative w-full">
          <button
            onClick={() => setShowIOSTip(v => !v)}
            className="w-full py-3 rounded-lg bg-muted hover:bg-border text-sm font-mono text-foreground/60 hover:text-foreground transition-colors"
          >
            + Add to Home Screen
          </button>

          {showIOSTip && (
            <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 bg-foreground text-background text-xs font-mono rounded-xl px-4 py-3 shadow-lg text-center leading-relaxed z-50">
              Tap the <span className="font-bold">Share</span> button{" "}
              <span className="text-foreground/70">( ↑ )</span> in Safari,
              then choose{" "}
              <span className="font-bold">Add to Home Screen</span>.
              <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-foreground rotate-45" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
