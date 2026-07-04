import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: NextRequest) {
  try {
    const { data: sessions, error } = await supabase
      .from("chat_sessions")
      .select("thread_id, title, messages, interruption_reason, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      sessions: (sessions || []).map((s: any) => ({
        threadId: s.thread_id,
        title: s.title,
        messages: s.messages || [],
        interruptionReason: s.interruption_reason || null,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }))
    });
  } catch (error: any) {
    console.error("GET /api/chat error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { threadId, title, messages, interruptionReason } = body;

    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required for saving a session." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("chat_sessions")
      .upsert({
        thread_id: threadId,
        title: title || "New Conversation",
        messages: messages || [],
        interruption_reason: interruptionReason || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "thread_id" })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      session: {
        threadId: data.thread_id,
        title: data.title,
        messages: data.messages || [],
        interruptionReason: data.interruption_reason || null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
    });
  } catch (error: any) {
    console.error("POST /api/chat error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");

    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required for deletion." },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("thread_id", threadId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/chat error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
