/**
 * Home Assistant notification service
 * Sends portfolio alerts to Home Assistant webhook for mobile notifications
 */

const HOME_ASSISTANT_WEBHOOK_URL = process.env.HOME_ASSISTANT_WEBHOOK_URL;

interface NotificationPayload {
  title: string;
  message: string;
}

export async function sendHomeAssistantNotification(
  title: string,
  message: string
): Promise<void> {
  if (!HOME_ASSISTANT_WEBHOOK_URL) {
    console.warn(
      'HOME_ASSISTANT_WEBHOOK_URL environment variable not set. Notification not sent.'
    );
    return;
  }

  try {
    const payload: NotificationPayload = {
      title,
      message,
    };

    const response = await fetch(HOME_ASSISTANT_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Home Assistant webhook failed with status ${response.status}: ${response.statusText}`
      );
    } else {
      console.log(`Home Assistant notification sent: ${title}`);
    }
  } catch (error) {
    console.error('Failed to send Home Assistant notification:', error);
  }
}

export async function sendAlertNotification(alert: {
  symbol: string;
  alert_type: string;
  threshold: number;
  condition: string;
  currentPrice: number;
  percentageChange?: number | null;
}): Promise<void> {
  let message = '';

  if (alert.alert_type === 'value') {
    message = `${alert.symbol} price is now $${alert.currentPrice.toFixed(2)} (${alert.condition} threshold of $${alert.threshold.toFixed(2)})`;
  } else if (alert.alert_type === 'percentage') {
    const changeStr = alert.percentageChange ? alert.percentageChange.toFixed(2) : 'unknown';
    message = `${alert.symbol} changed ${changeStr}% (${alert.condition} threshold of ${alert.threshold}%)`;
  }

  await sendHomeAssistantNotification('Portfolio Alert', message);
}
