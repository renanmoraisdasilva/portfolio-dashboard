# Home Assistant Integration Setup

This guide explains how to set up portfolio alerts to send notifications to your phone via Home Assistant webhook.

## 1. Create Home Assistant Webhook

First, you need to create a webhook in Home Assistant that will receive the notification requests.

### Using a Home Assistant automation

1. Go to Home Assistant → Settings → Automations → Create Automation
2. Create a new automation with a webhook trigger:

```yaml
alias: Portfolio Alert Notification
trigger:
  platform: webhook
  webhook_id: your-unique-webhook-id-here
  # Generate a unique ID - can use any random string like: f83b7b2c9a4e4d7a9d1f6c2b8e1
action:
  - service: notify.mobile_app_your_phone
    data:
      title: "{{ trigger.json.title }}"
      message: "{{ trigger.json.message }}"
```

3. Note your Home Assistant host and port (for example `homeassistant.local:8123`, or your server's IP address)
4. Note your webhook ID from the automation

## 2. Configure Environment Variable

The value is the full webhook URL — one `/api/webhook/` path segment, then the
webhook ID:

```text
http://<home-assistant-host>:8123/api/webhook/YOUR_WEBHOOK_ID
```

Which file it goes in depends on where the app runs:

### Production (Docker)

The webhook URL is **baked into the image at build time** — it is not read from
a `.env` file at runtime. Store it as the `HOME_ASSISTANT_WEBHOOK_URL` secret in
the GitHub Actions repository settings; `docker-image.yml` passes it to the
`Dockerfile` as `ARG HOME_ASSISTANT_WEBHOOK_URL`, which sets the matching `ENV`.
The production `docker-compose.yml` therefore has no `environment:` entry for
it — redeploy after changing the secret. See `docs/SERVER-SETUP.md` §4.

### Local development

Add to `.env` in the `apps/api` directory:

```text
HOME_ASSISTANT_WEBHOOK_URL=http://<home-assistant-host>:8123/api/webhook/YOUR_WEBHOOK_ID
```

If it is unset, alerts still work in the UI; only the mobile notification is
skipped (the service logs a warning instead of failing).

## 3. Notification Format

When a portfolio alert is triggered, the server sends a POST request with this JSON payload:

```json
{
  "title": "Portfolio Alert",
  "message": "BTC price is now $45,250.00 (above threshold of $45,000.00)"
}
```

For percentage-based alerts:
```json
{
  "title": "Portfolio Alert",
  "message": "ETH changed 5.25% (above threshold of 5%)"
}
```

## 4. Test the Integration

To test your webhook configuration:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"title":"Portfolio Notification","message":"Test notification"}' \
  http://<home-assistant-host>:8123/api/webhook/YOUR_WEBHOOK_ID
```

If successful, you should receive a notification on your phone.

## 5. Alert Triggering

Alerts are checked and triggered automatically every 8 minutes when prices are updated. When an alert condition is met:

1. A triggered alert record is created in the database
2. A notification is sent to Home Assistant
3. The notification appears on your phone

## Troubleshooting

- **No notifications received**: Check that `HOME_ASSISTANT_WEBHOOK_URL` is set correctly
- **Webhook not found**: Verify the webhook ID matches your Home Assistant automation
- **Connection refused**: Ensure Home Assistant is accessible at the configured URL
- **Server logs**: Check server console output for webhook errors

## Additional Notes

- Each alert will only trigger once until it's dismissed (you can dismiss from the UI)
- If the webhook URL is not configured, alerts will still work in the UI but won't send mobile notifications
- The notification service fails gracefully - it won't interrupt alert triggering if Home Assistant is unavailable
