"use client";

export default function NoContextMenu({ children }: { children: React.ReactNode }) {
  return <div className="contents" onContextMenu={(e) => e.preventDefault()}>{children}</div>;
}
