import type { SosAlertNotification } from "./sosRealtime.js";

let adminNotifier: ((alert: SosAlertNotification) => void) | undefined;

export function setAdminSosNotifier(notifier: ((alert: SosAlertNotification) => void) | undefined) {
  adminNotifier = notifier;
}

export function notifyAdminSosAlert(alert: SosAlertNotification) {
  adminNotifier?.(alert);
}
