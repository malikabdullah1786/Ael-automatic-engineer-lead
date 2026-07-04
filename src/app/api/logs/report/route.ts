import { NextRequest, NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { errorTrace, projectId } = await req.json();

    if (!errorTrace) {
      return NextResponse.json({ error: "Missing errorTrace" }, { status: 400 });
    }

    // Call server logger helper to write directly to DB
    await logSystemEvent(errorTrace, projectId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error logger API endpoint failure:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
