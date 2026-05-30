# MoneyPulse → Home Assistant Notifications

> **Goal**: When MoneyPulse creates a notification (anomaly, missed bill, budget threshold, digest, etc.), Home Assistant receives it via a webhook and can **speak it aloud on a Voice device**, flash a light, create a persistent notification, and show it on a dashboard.
>
> **Role split (decided)**: Phone push stays on FCM (moneypulse-web, Prompt 6b). **HA handles voice + in-home automations only** — no duplicate phone push.

---

## How it works (end to end)

```
MoneyPulse (NAS)                         Home Assistant (its VLAN, port 8123)
 NotificationsService.create()
   → webhook.service.ts
       POST http://<HA_IP>:8123/api/webhook/<webhook_id>
       Content-Type: application/json
       { "title": "...", "message": "...", "type": "spending_anomaly" }
                          │
                          ▼
            Automation (trigger: webhook)
              reads trigger.json.title / .message / .type
              ├─ always: persistent_notification + update dashboard text
              ├─ if "large/urgent" type: flash a light
              └─ if awake hours AND type not muted: assist_satellite.announce 🔊
```

MoneyPulse sends a **POST with a JSON body** of exactly three fields: `title`, `message`, `type`. HA exposes that body to templates as **`trigger.json`** (because the `Content-Type` is `application/json`).

Notification `type` values MoneyPulse emits (taxonomy from the analytics/bills/anomaly services):
`spending_anomaly`, `bill_overdue`, `budget_threshold`, `cashflow_low`, `subscription_price_increase`, `digest`, `streak`.

---

## ⚠️ Prerequisite — unblock the LAN webhook in MoneyPulse

MoneyPulse's `apps/api/src/notifications/webhook.service.ts` `isUrlSafe()` **blocks private/LAN IPs** as an SSRF guard, so a webhook to `http://<HA_IP>:8123/...` is **silently dropped today**. It works only after:

1. **Prompt 6a** is deployed (adds the `HA_WEBHOOK_ALLOWED_HOSTS` env allowlist).
2. You set on the NAS env: `HA_WEBHOOK_ALLOWED_HOSTS=<HA_IP>` (e.g. `192.168.30.10`). Add the hostname too if you use one.

Until then you can still build and test the **HA side** with `curl` (see [Testing](#5-testing)).

---

## Facts to gather first

| Need | Where to find it |
|---|---|
| **HA IP + port** | HA → Settings → System → Network (or router DHCP table). Default port `8123`. |
| **Voice device entity_id** | HA → Settings → Devices & Services → Entities → search `assist_satellite`. Looks like `assist_satellite.home_assistant_voice_xxxxx`. |
| **NAS → HA reachability** | From the NAS shell: `curl -v http://<HA_IP>:8123/` — a 404/401 is success (port open across VLANs). A hang = VLAN firewall rule needed (allow NAS_VLAN → HA_IP:8123/tcp). |

Throughout this doc, replace `<HA_IP>`, `<webhook_id>`, and `assist_satellite.home_assistant_voice_xxxxx` with your real values.

---

## 1. Create the webhook automation in HA

The `webhook_id` **is the secret** (there is no token/auth on HA webhooks). Generate a long random string — e.g. run `openssl rand -hex 24` — and keep the full URL private.

HA → Settings → Automations & Scenes → Create Automation → (top-right ⋮) → **Edit in YAML**. Paste:

```yaml
alias: MoneyPulse - Incoming Notification
description: Receives MoneyPulse webhook and routes to voice / light / notification / dashboard
triggers:
  - trigger: webhook
    webhook_id: "<webhook_id>"      # e.g. output of: openssl rand -hex 24
    allowed_methods:
      - POST
    local_only: true                # NAS is on a local (RFC1918) VLAN — keep true
conditions: []
actions:
  # (A) ALWAYS: persistent notification in HA's notification center (reliable backstop)
  - action: persistent_notification.create
    data:
      title: "💰 {{ trigger.json.title }}"
      message: "{{ trigger.json.message }}"
      notification_id: "moneypulse_{{ trigger.json.type }}"

  # (B) ALWAYS: update the dashboard "latest alert" text helper (see step 4)
  - action: input_text.set_value
    target:
      entity_id: input_text.moneypulse_last_alert
    data:
      # input_text max length is 255 chars
      value: "{{ (trigger.json.title ~ ' — ' ~ trigger.json.message)[:255] }}"

  # (C) CONDITIONAL: flash a light for "urgent" money events (large purchase / low balance / anomaly)
  - choose:
      - conditions:
          - condition: template
            value_template: >
              {{ trigger.json.type in ['spending_anomaly', 'cashflow_low']
                 or 'large' in (trigger.json.title | lower) }}
        sequence:
          - action: light.turn_on
            target:
              entity_id: light.office_lamp      # ← change to your light
            data:
              rgb_color: [255, 60, 0]           # alert orange
              brightness_pct: 100
          - delay: "00:00:03"
          - action: light.turn_off
            target:
              entity_id: light.office_lamp

  # (D) CONDITIONAL: speak it aloud — only in awake hours AND only if this type isn't muted
  - choose:
      - conditions:
          # quiet hours: announce only between 08:00 and 21:00
          - condition: time
            after: "08:00:00"
            before: "21:00:00"
          # per-type mute: announce unless input_boolean.moneypulse_voice_<type> is explicitly 'off'
          # (a missing toggle = announces, so new types speak by default)
          - condition: template
            value_template: >
              {{ states('input_boolean.moneypulse_voice_' ~ trigger.json.type) != 'off' }}
        sequence:
          - action: assist_satellite.announce
            target:
              entity_id: assist_satellite.home_assistant_voice_xxxxx   # ← your Voice PE
            data:
              message: "{{ trigger.json.title }}. {{ trigger.json.message }}"
              preannounce: true     # set false to skip the chime
mode: queued      # handle bursts (e.g. several anomalies from one import) one at a time
max: 10
```

Notes:
- `local_only: true` is correct for your setup — cross-VLAN RFC1918 traffic still counts as "local". You never expose anything to the internet.
- `mode: queued` prevents announcements from stomping each other when an import produces several alerts at once.
- ⚠️ Voice PE's `announce` has a [known drop bug](https://github.com/home-assistant/core/issues/142027) (10–90% missed). Action (A) persistent notification is your reliable backstop.

---

## 2. Per-type voice mute toggles (your "control UI")

Create one `input_boolean` per notification type you might want to silence. HA → Settings → Devices & Services → **Helpers** → Create Helper → Toggle. Name each **exactly** `moneypulse_voice_<type>` so the automation's template finds it:

| Helper entity_id | Mutes voice for |
|---|---|
| `input_boolean.moneypulse_voice_spending_anomaly` | Unusual spend / large purchase |
| `input_boolean.moneypulse_voice_bill_overdue` | Missed/overdue bills |
| `input_boolean.moneypulse_voice_budget_threshold` | Budget 80–100% alerts |
| `input_boolean.moneypulse_voice_cashflow_low` | Low projected balance |
| `input_boolean.moneypulse_voice_subscription_price_increase` | Subscription price hikes |
| `input_boolean.moneypulse_voice_digest` | Daily/weekly digest |
| `input_boolean.moneypulse_voice_streak` | Streak / gamification |

**Default ON** (toggle on) = speaks. Flip a toggle **off** when a type gets annoying. A type with *no* matching helper still speaks (default-on), so you only create toggles for things you want the option to silence.

Or create them all at once in `configuration.yaml`:

```yaml
input_boolean:
  moneypulse_voice_spending_anomaly:
    name: "MoneyPulse voice: anomalies"
    initial: on
  moneypulse_voice_bill_overdue:
    name: "MoneyPulse voice: overdue bills"
    initial: on
  moneypulse_voice_budget_threshold:
    name: "MoneyPulse voice: budget alerts"
    initial: on
  moneypulse_voice_cashflow_low:
    name: "MoneyPulse voice: low balance"
    initial: on
  moneypulse_voice_subscription_price_increase:
    name: "MoneyPulse voice: subscription price"
    initial: on
  moneypulse_voice_digest:
    name: "MoneyPulse voice: digest"
    initial: on
  moneypulse_voice_streak:
    name: "MoneyPulse voice: streaks"
    initial: on
```

(Optional) add a master kill-switch `input_boolean.moneypulse_voice_master` and an extra condition `{{ is_state('input_boolean.moneypulse_voice_master', 'on') }}` in action (D).

---

## 3. Dashboard "latest alert" text helper

HA → Helpers → Create Helper → **Text** → name it so the entity is `input_text.moneypulse_last_alert`. Set **Maximum length 255**. (Or YAML:)

```yaml
input_text:
  moneypulse_last_alert:
    name: "MoneyPulse last alert"
    max: 255
```

Action (B) in the automation keeps this updated with the most recent alert.

---

## 4. Dashboard card

Add to any Lovelace dashboard (Edit Dashboard → Add Card → Manual):

```yaml
type: vertical-stack
title: 💰 MoneyPulse
cards:
  - type: markdown
    content: >
      **Latest alert**

      {{ states('input_text.moneypulse_last_alert') }}
  - type: entities
    title: Voice announcements
    entities:
      - input_boolean.moneypulse_voice_spending_anomaly
      - input_boolean.moneypulse_voice_bill_overdue
      - input_boolean.moneypulse_voice_budget_threshold
      - input_boolean.moneypulse_voice_cashflow_low
      - input_boolean.moneypulse_voice_subscription_price_increase
      - input_boolean.moneypulse_voice_digest
      - input_boolean.moneypulse_voice_streak
```

This gives you the latest alert plus the per-type mute switches in one place.

---

## 5. Daily spoken digest

**Easiest (recommended)** — no extra HA work: MoneyPulse's digest feature (Prompt 13) sends a notification with `type: digest` on your schedule. It flows through the same webhook and gets announced (subject to quiet hours + the `digest` mute toggle). To control *when* it speaks, schedule the digest send time in MoneyPulse.

**Richer (optional, needs Prompt 15 HA REST sensor)** — have HA pull a summary and compose its own announcement:

```yaml
# configuration.yaml — requires the Prompt 15 endpoint GET /api/ha/sensor + token
rest:
  - resource: "http://<NAS_IP>:4000/api/ha/sensor"
    headers:
      X-HA-Token: !secret moneypulse_ha_token
    scan_interval: 1800
    sensor:
      - name: "MoneyPulse Today Spending"
        value_template: "{{ value_json.today_spending_cents / 100 }}"
        unit_of_measurement: "USD"
      - name: "MoneyPulse Overdue Bills"
        value_template: "{{ value_json.overdue_bill_count }}"
```

```yaml
# automation: speak a digest at 8 PM
alias: MoneyPulse - Spoken Daily Digest
triggers:
  - trigger: time
    at: "20:00:00"
actions:
  - action: assist_satellite.announce
    target:
      entity_id: assist_satellite.home_assistant_voice_xxxxx
    data:
      message: >
        Today you spent {{ states('sensor.moneypulse_today_spending') }} dollars.
        You have {{ states('sensor.moneypulse_overdue_bills') }} overdue bills.
```

---

## 6. Point MoneyPulse at the webhook

1. In MoneyPulse → Settings, set the Home Assistant webhook URL to:
   `http://<HA_IP>:8123/api/webhook/<webhook_id>`
   (stored **encrypted** in `user_settings.haWebhookUrl`).
2. On the NAS env, ensure **Prompt 6a is deployed** and set:
   `HA_WEBHOOK_ALLOWED_HOSTS=<HA_IP>`
3. Redeploy / restart the API so the env + allowlist take effect.

---

## 7. Testing

**Test the HA side alone (before MoneyPulse is wired)** — from the NAS (or your Mac):

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"title":"Large purchase","message":"You spent $642 at Costco","type":"spending_anomaly"}' \
  http://<HA_IP>:8123/api/webhook/<webhook_id>
```

Expect: persistent notification appears, dashboard text updates, light flashes (urgent type), and — in awake hours with the toggle on — the Voice device speaks. A `200`/empty response from HA = delivered.

**Test end to end** (after Prompt 6a + env set): trigger a real alert in MoneyPulse — e.g. import a statement with a >$500 debit — and confirm HA reacts.

**Troubleshooting:**
- Nothing happens → check HA → Settings → Automations → the automation's **Traces** to see if the webhook fired and which `choose` branches ran.
- `curl` hangs → VLAN firewall: allow NAS_VLAN → `<HA_IP>:8123/tcp`.
- Real MoneyPulse alerts don't arrive but `curl` works → `HA_WEBHOOK_ALLOWED_HOSTS` missing the HA IP, or Prompt 6a not deployed (the URL is being blocked by `isUrlSafe()`).
- Voice silent but notification appears → quiet hours (9pm–8am), a muted toggle, or the Voice PE drop bug — check Traces.

---

## Security notes

- The webhook URL contains the only secret (`webhook_id`) — treat it like a password. MoneyPulse stores it encrypted; don't commit it or paste it in screenshots.
- `local_only: true` + cross-VLAN RFC1918 keeps this entirely on your home network. No internet exposure, no Nabu Casa cloud webhook needed.
- `HA_WEBHOOK_ALLOWED_HOSTS` is a deliberate, narrow exception to the SSRF guard — it permits **only** the HA host you list, nothing else.

## Sources

- [HA Automation Triggers — webhook (`trigger.json`, `local_only`, `allowed_methods`)](https://www.home-assistant.io/docs/automation/trigger/)
- [HA Assist Satellite integration — `assist_satellite.announce`](https://www.home-assistant.io/integrations/assist_satellite/)
- [Voice PE announce reliability issue #142027](https://github.com/home-assistant/core/issues/142027)
