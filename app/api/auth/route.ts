import { NextRequest, NextResponse } from "next/server";
import { ACCESS_PASSWORD } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ required: !!ACCESS_PASSWORD });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!ACCESS_PASSWORD) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: body?.password === ACCESS_PASSWORD });
}
