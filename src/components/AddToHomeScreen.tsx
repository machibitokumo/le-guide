"use client";

import { useEffect, useState } from "react";

type InstallState = "hidden" | "android" | "ios" | "installed";

export default function AddToHomeScreen() {
  const [state, setState] = useState<InstallState>("hidden");
  const [showIOSModal, setShowIOSModal] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);

    if (isIOS) {
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
    <>
      <div className="fixed bottom-0 left-0 right-0 flex justify-center z-40 pb-6 px-4 pointer-events-none">
        <button
          onClick={state === "android" ? handleAndroidInstall : () => setShowIOSModal(true)}
          className="pointer-events-auto flex items-center gap-2.5 px-5 py-3 rounded-full bg-foreground text-background text-xs font-mono font-semibold shadow-lg active:scale-95 transition-transform"
        >
          {/* Add-to-homescreen icon: phone + plus */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <line x1="12" y1="7" x2="12" y2="13" />
            <line x1="9" y1="10" x2="15" y2="10" />
          </svg>
          Add to Home Screen
        </button>
      </div>

      {/* iOS full-screen instruction modal */}
      {showIOSModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setShowIOSModal(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl p-8 flex flex-col items-center gap-5"
            style={{ background: "#f1f1f1" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-foreground/20" />
            <p className="font-mono font-bold text-sm text-foreground">Add to Home Screen</p>

            <div className="w-full space-y-4">
              <div className="flex items-start gap-4">
                <span className="text-2xl">1</span>
                <p className="text-sm font-mono text-foreground/70 pt-1">
                  Tap the <span className="font-bold text-foreground">Share</span> button at the bottom of Safari
                  <span className="ml-1 text-foreground font-bold">↑</span>
                </p>
              </div>
              <div className="flex items-start gap-4">
                <span className="text-2xl">2</span>
                <p className="text-sm font-mono text-foreground/70 pt-1">
                  Scroll down and tap{" "}
                  <span className="font-bold text-foreground">Add to Home Screen</span>
                </p>
              </div>
              <div className="flex items-start gap-4">
                <span className="text-2xl">3</span>
                <p className="text-sm font-mono text-foreground/70 pt-1">
                  Tap <span className="font-bold text-foreground">Add</span> in the top right
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-3 rounded-lg bg-foreground text-background text-sm font-mono font-bold mt-2"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
