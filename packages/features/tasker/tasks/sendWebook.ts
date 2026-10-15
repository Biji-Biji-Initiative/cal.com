import { WebhookVersion } from "@calcom/features/webhooks/lib/interface/IWebhookRepository";
import sendPayload from "@calcom/features/webhooks/lib/sendPayload";
import { z } from "zod";
import type { TaskExecutionContext } from "../execution";
import { TaskOutcomeUnknownError } from "../execution";

const sendWebhookPayloadSchema = z.object({
  secretKey: z.string().nullable(),
  triggerEvent: z.string(),
  createdAt: z.string(),
  webhook: z.object({
    subscriberUrl: z.string().url(),
    appId: z.string().nullable(),
    payloadTemplate: z.string().nullable(),
    version: z.nativeEnum(WebhookVersion),
  }),
  // TODO: Define the data schema
  data: z.any(),
});

export async function sendWebhook(
  payload: string,
  _taskId?: string,
  execution?: TaskExecutionContext
): Promise<void> {
  const { secretKey, triggerEvent, createdAt, webhook, data } = sendWebhookPayloadSchema.parse(
    JSON.parse(payload)
  );
  try {
    const receipt = await sendPayload(secretKey, triggerEvent, createdAt, webhook, data, execution?.signal);
    if (
      !receipt ||
      !receipt.ok ||
      !Number.isInteger(receipt.status) ||
      receipt.status < 200 ||
      receipt.status >= 300
    ) {
      throw new TaskOutcomeUnknownError();
    }
  } catch {
    // A failed HTTP acknowledgement does not establish that the receiver did
    // nothing. Preserve uncertainty rather than replaying a possible effect or
    // logging a raw exception that may carry its URL, signing key or payload.
    throw new TaskOutcomeUnknownError();
  }
}
