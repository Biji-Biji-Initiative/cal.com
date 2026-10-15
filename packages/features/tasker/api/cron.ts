import process from "node:process";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { TaskProcessor } from "../task-processor";
import { isTaskCronAuthorized } from "./authorization";

async function handler(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!isTaskCronAuthorized(authHeader, process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const processor = new TaskProcessor();
  const processing = await processor.processQueue();
  return NextResponse.json({
    success: true,
    processing,
    attentionRequired: processing.pendingReconciliation > 0 || processing.exhaustedTotal > 0,
  });
}

export async function GET(request: NextRequest) {
  return await handler(request);
}

export async function POST(request: NextRequest) {
  return await handler(request);
}
