const HUB_URL = "http://127.0.0.1:9199/events";

export interface NotificationHubEvent {
	source: string; // always "notion-os"
	level: "info" | "warn" | "urgent";
	title: string;
	body: string;
	project?: string;
}

/**
 * Fire-and-forget POST to notification-hub. Never throws.
 * If the hub is unreachable, silently skips.
 */
export function postNotificationHubEvent(event: NotificationHubEvent): void {
	const body = JSON.stringify({
		...event,
		source: "notion-os",
		timestamp: new Date().toISOString(),
	});
	fetch(HUB_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		signal: AbortSignal.timeout(2000),
	}).catch(() => {
		// Silent — hub may not be running
	});
}
