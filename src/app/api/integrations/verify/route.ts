import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── GET /api/integrations/verify?service=github|supabase|slack ──────────────
export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get("service");

  // ── 1. GitHub PAT Verification ────────────────────────────────────────────
  if (service === "github") {
    try {
      const pat = process.env.GITHUB_PAT;
      if (!pat) {
        return NextResponse.json(
          { ok: false, message: "GITHUB_PAT is not configured in environment variables." },
          { status: 400 }
        );
      }

      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${pat}`,
          "User-Agent": "AEL-Agent/1.0",
        },
      });

      if (res.ok) {
        const user = await res.json();
        const rateLimit = res.headers.get("x-ratelimit-remaining");
        const rateMax = res.headers.get("x-ratelimit-limit");
        return NextResponse.json({
          ok: true,
          message: `Authenticated as @${user.login}. Rate limit: ${rateLimit}/${rateMax} remaining.`,
        });
      } else {
        const err = await res.json();
        return NextResponse.json(
          { ok: false, message: `GitHub rejected the token: ${err.message}` },
          { status: 401 }
        );
      }
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, message: `Network error: ${err.message}` },
        { status: 500 }
      );
    }
  }

  // ── 2. Supabase Connection Ping ───────────────────────────────────────────
  if (service === "supabase") {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Simple lightweight query — count active_projects rows
      const start = Date.now();
      const { count, error } = await supabase
        .from("active_projects")
        .select("*", { count: "exact", head: true });
      const latencyMs = Date.now() - start;

      if (error) throw new Error(error.message);

      return NextResponse.json({
        ok: true,
        message: `Supabase is reachable. Query latency: ${latencyMs}ms. ${count} active project(s) found.`,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, message: `Supabase connection failed: ${err.message}` },
        { status: 500 }
      );
    }
  }

  // ── 3. Slack Test Webhook ─────────────────────────────────────────────────
  if (service === "slack") {
    try {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "SLACK_WEBHOOK_URL is not configured. Add it to .env.local to enable Slack alerts.",
          },
          { status: 400 }
        );
      }

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "✅ *AEL Agent — Integration Test*\nSlack webhook connection verified successfully from the AEL workspace dashboard.",
        }),
      });

      if (res.ok) {
        return NextResponse.json({
          ok: true,
          message: "Test alert delivered to Slack channel successfully.",
        });
      } else {
        const text = await res.text();
        return NextResponse.json(
          { ok: false, message: `Slack webhook responded: ${text}` },
          { status: 400 }
        );
      }
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, message: `Slack network error: ${err.message}` },
        { status: 500 }
      );
    }
  }

  // ── 4. Jira Connection Ping ───────────────────────────────────────────────
  if (service === "jira") {
    try {
      const { JiraService } = require("../../../../lib/services/jira.service");
      const jira = new JiraService();
      const connected = await jira.verifyConnection();
      if (connected) {
        return NextResponse.json({
          ok: true,
          message: "Jira connection verified successfully.",
        });
      } else {
        return NextResponse.json(
          { ok: false, message: "Jira connection failed. Please check your credentials." },
          { status: 401 }
        );
      }
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, message: `Jira connection error: ${err.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { ok: false, message: "Unknown service. Use ?service=github|supabase|slack|jira" },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { service, host, email, apiToken } = body;

    if (service === "jira") {
      if (!host || !email || !apiToken) {
        return NextResponse.json(
          { ok: false, message: "Missing required Jira configuration fields (host, email, apiToken)." },
          { status: 400 }
        );
      }

      const { JiraService } = require("../../../../lib/services/jira.service");
      const jira = new JiraService();
      const testConfig = { host, email, apiToken };
      const connected = await jira.verifyConnection(testConfig);

      if (!connected) {
        return NextResponse.json(
          { ok: false, message: "Jira connection check failed with these credentials." },
          { status: 400 }
        );
      }

      // Save to system_settings
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { error } = await supabase
        .from("system_settings")
        .upsert(
          { key: "jira_config", value: testConfig, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );

      if (error) {
        throw new Error(`Failed to save settings: ${error.message}`);
      }

      return NextResponse.json({
        ok: true,
        message: "Jira credentials verified and saved successfully to database.",
      });
    }

    return NextResponse.json(
      { ok: false, message: "Unsupported service in POST request." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("POST /api/integrations/verify error:", err);
    return NextResponse.json(
      { ok: false, message: `Error: ${err.message}` },
      { status: 500 }
    );
  }
}
