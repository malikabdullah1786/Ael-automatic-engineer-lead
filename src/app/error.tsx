"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Compile error details
    const errorTrace = `[Frontend Crash] ${error.name}: ${error.message}\nDigest: ${error.digest || "N/A"}\n\nStack:\n${error.stack || "No stack trace available."}`;

    // Stream the error telemetry to our custom logging API
    fetch("/api/logs/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ errorTrace }),
    }).catch((err) => {
      console.error("Failed to report client-side error:", err);
    });
  }, [error]);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#fafbfa] px-4 py-8 text-slate-800 antialiased selection:bg-[#3ecf8e]/20">
      {/* Subtle background gradient details to make it feel premium */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(62,207,142,0.04),transparent_60%)] pointer-events-none" />

      <div className="relative z-10 flex max-w-md w-full flex-col items-center border border-[#e5e7eb] bg-white rounded-2xl p-8 shadow-lg text-center">
        {/* Warning Icon Badge */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 border border-red-150 text-red-500 mb-6 shadow-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            className="w-6 h-6 text-red-500 animate-pulse"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        <h2 className="text-base font-bold tracking-tight text-slate-900 mb-2 uppercase">
          System Diagnostics Triggered
        </h2>
        
        <p className="text-xs text-slate-500 leading-relaxed mb-6">
          An unexpected application crash has occurred. The error trace was intercepted and forwarded to the <strong className="font-semibold text-slate-900">Autonomous Engineering Lead</strong> for immediate triage.
        </p>

        <div className="flex w-full flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="w-full sm:w-auto bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs h-9 px-5 rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#3ecf8e]/50"
          >
            Try Recovery
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="w-full sm:w-auto border border-[#e5e7eb] bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs h-9 px-5 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            Return Home
          </button>
        </div>
      </div>
    </div>
  );
}
