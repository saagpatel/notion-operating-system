import { describe, expect, test } from "vitest";

import {
  findWebhookDeliveriesNeedingReconcile,
  parseWebhookReconcileFlags,
} from "../src/notion/webhook-reconcile.js";
import type { WebhookDeliveryRecord } from "../src/notion/local-portfolio-governance.js";

describe("webhook reconcile hardening", () => {
  test("parses the provider flag while keeping github as the default", () => {
    expect(parseWebhookReconcileFlags([])).toEqual({ provider: "github" });
    expect(parseWebhookReconcileFlags(["--provider", "vercel"])).toEqual({ provider: "vercel" });
  });

  test("filters only the deliveries that still need reconcile for the selected provider", () => {
    const deliveries = [
      baseDelivery({
        id: "github-failed",
        provider: "GitHub",
        status: "Failed",
      }),
      baseDelivery({
        id: "github-duplicate",
        provider: "GitHub",
        verificationResult: "Duplicate",
      }),
      baseDelivery({
        id: "github-processed",
        provider: "GitHub",
        status: "Processed",
      }),
      baseDelivery({
        id: "vercel-failed",
        provider: "Vercel",
        status: "Failed",
      }),
    ];

    const github = findWebhookDeliveriesNeedingReconcile(deliveries, "github");
    const vercel = findWebhookDeliveriesNeedingReconcile(deliveries, "vercel");

    expect(github.map((delivery) => delivery.id)).toEqual(["github-failed", "github-duplicate"]);
    expect(vercel.map((delivery) => delivery.id)).toEqual(["vercel-failed"]);
  });
});

function baseDelivery(overrides: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord {
  return {
    id: overrides.id ?? "delivery-1",
    url: overrides.url ?? "https://notion.so/delivery-1",
    title: overrides.title ?? "Webhook delivery",
    provider: overrides.provider ?? "GitHub",
    endpointIds: overrides.endpointIds ?? [],
    localProjectIds: overrides.localProjectIds ?? [],
    externalSignalEventIds: overrides.externalSignalEventIds ?? [],
    status: overrides.status ?? "Received",
    eventType: overrides.eventType ?? "issues",
    deliveryId: overrides.deliveryId ?? "delivery-id",
    receivedAt: overrides.receivedAt ?? "2026-03-29",
    verificationResult: overrides.verificationResult ?? "Valid",
    eventKey: overrides.eventKey ?? "event-key",
    bodyDigest: overrides.bodyDigest ?? "digest",
    headersExcerpt: overrides.headersExcerpt ?? "{}",
    rawExcerpt: overrides.rawExcerpt ?? "{}",
    failureNotes: overrides.failureNotes ?? "",
    firstSeenAt: overrides.firstSeenAt ?? "2026-03-29",
    lastSeenAt: overrides.lastSeenAt ?? "2026-03-29",
    receiptCount: overrides.receiptCount ?? 1,
  };
}
