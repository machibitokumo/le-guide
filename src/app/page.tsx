"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/app");
        return;
      }

      if (res.status === 429) {
        setError("Too many attempts. Try again later.");
      } else {
        setError("Invalid credentials");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", overscrollBehavior: "none", touchAction: "none" }}>
      {/* Voxel scene background */}
      <iframe
        src="/voxel-bg.html"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        title="background"
      />

      {/* Login card overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <form
          onSubmit={handleSubmit}
          style={{
            width: "100%",
            maxWidth: "360px",
            background: "rgba(11, 22, 38, 0.72)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(252, 249, 238, 0.12)",
            borderRadius: "16px",
            padding: "40px 36px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "4px" }}>
            <h1 style={{
              color: "#fcf9ee",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "1.4rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              margin: 0,
            }}>
              Le Guide
            </h1>
            <p style={{
              color: "rgba(252, 249, 238, 0.35)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.7rem",
              marginTop: "6px",
            }}>
              Brought to you by 見えない技術クラウド
            </p>
          </div>

          {/* Username */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{
              color: "rgba(252, 249, 238, 0.45)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              letterSpacing: "0.08em",
            }}>
              USERNAME
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              style={{
                background: "rgba(252, 249, 238, 0.06)",
                border: "1px solid rgba(252, 249, 238, 0.14)",
                borderRadius: "8px",
                padding: "10px 14px",
                color: "#fcf9ee",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "16px",
                outline: "none",
              }}
            />
          </div>

          {/* Password */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{
              color: "rgba(252, 249, 238, 0.45)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              letterSpacing: "0.08em",
            }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                background: "rgba(252, 249, 238, 0.06)",
                border: "1px solid rgba(252, 249, 238, 0.14)",
                borderRadius: "8px",
                padding: "10px 14px",
                color: "#fcf9ee",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "16px",
                outline: "none",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <p style={{
              color: "#ef4444",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem",
              textAlign: "center",
              margin: 0,
            }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: "4px",
              background: loading ? "rgba(252, 249, 238, 0.5)" : "#fcf9ee",
              color: "#112338",
              border: "none",
              borderRadius: "8px",
              padding: "12px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.82rem",
              fontWeight: 600,
              letterSpacing: "0.06em",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : "ENTER"}
          </button>
        </form>
      </div>
    </div>
  );
}
