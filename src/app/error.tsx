"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-8 text-slate-100 antialiased selection:bg-red-500/30">
      {/* Background visual details */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,0.07),transparent_50%)]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-red-650/5 blur-[120px] pointer-events-none" />

      <div className="relative z-10 flex max-w-md w-full flex-col items-center border border-slate-900/80 bg-slate-900/30 backdrop-blur-md rounded-2xl p-8 shadow-2xl text-center">
        {/* Sleek icon / warning mark */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-950/40 border border-red-500/20 text-red-500 mb-6 shadow-inner">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6 animate-pulse"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-bold tracking-tight text-slate-50 mb-2">
          System Diagnostics Triggered
        </h2>
        
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          An unexpected application crash has occurred. The error trace was intercepted and forwarded to the **Autonomous Engineering Lead** for immediate triage.
        </p>

        <div className="flex w-full flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => reset()}
            className="w-full sm:w-auto bg-slate-100 text-slate-900 hover:bg-slate-200 transition-colors"
          >
            Try Recovery
          </Button>
          <Button
            onClick={() => window.location.href = "/"}
            variant="outline"
            className="w-full sm:w-auto border-slate-800 text-slate-350 hover:bg-slate-900/50 hover:text-slate-200 transition-colors"
          >
            Return Home
          </Button>
        </div>
      </div>
    </div>
  );
}
