<!--
SPDX-FileCopyrightText: 2026 Tim Lochmüller <tim@binable.app>

SPDX-License-Identifier: MIT
-->

# n8n-nodes-binable

An [n8n](https://n8n.io) community node for [binable.app](https://binable.app) — waste
collection schedules for Germany, Austria and many more. Get reminded before the bin goes
out, export calendars, or build any automation on top of your collection dates.

This package ships **three nodes** and **one credential**:

| Node | Type | Purpose |
|------|------|---------|
| **Binable** | Action | Query collection schedules (next N, date range, by date, waste types, iCal feed, raw fetch) |
| **Binable Trigger** | Webhook trigger | Fires via a native binable push webhook when a collection is coming up |
| **Binable Polling Trigger** | Polling trigger | Polls on a schedule; flexible lead time, no public URL required |

## Installation

In n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-binable`.

Self-hosted / manual:

```bash
npm install n8n-nodes-binable
```

## Credential — Binable API

Create a **Binable API** credential with your API key (free via e-mail registration at
[binable.app](https://binable.app)).

Authentication uses the `ApiKey` scheme:

```
Authorization: ApiKey <your-api-key>
```

See the [binable API documentation](https://binable.app/en/integration/api) for details.

The credential is:

- **required** for the **Binable Trigger** (creating/deleting webhook subscriptions needs a key),
- **optional** for the **Binable** action node and the **Binable Polling Trigger** — they work
  anonymously, but a key raises your rate limit.

## Nodes

### Binable (action)

Resource **Collection**, operations:

- **Get Next Collections** — the next *N* upcoming collections, optionally filtered by fraction.
- **Get Schedule (Date Range)** — every collection between a start and end date (`YYYY-MM-DD`).
- **Get Collections by Date** — everything collected on one specific day.
- **List Waste Types** — the fractions that exist for the address, each with its next date and count.
- **Get iCal Feed** — the subscribable calendar feed URL (optionally the ICS content itself).
- **Get Raw Data (Fetch)** — the full, unprocessed `/api/fetch` response.

The **Fractions** field is a dropdown that loads the *actual* waste types for the address you
enter (falling back to the standard German fractions if the address is incomplete).

Each collection event is returned as its own item:

```json
{ "wasteType": "Restmüll", "wasteKey": "residualWaste", "date": "2026-07-07", "daysUntil": 6, "provider": "Stadt Bielefeld" }
```

### Binable Trigger (webhook)

Registers a push webhook with binable on activation and removes it on deactivation — no manual
API calls needed. binable notifies once a day (around **18:00 server time**) when a collection is
due in **1–7** days (`Days Before Collection`).

The incoming payload is HMAC-SHA256 signed. With **Verify Signature** enabled (default), the node
checks the `X-Binable-Signature` header against the webhook secret and rejects forged requests with
`403`.

Payload:

```json
{
  "event": "upcoming_collection",
  "sent_at": "2026-07-06T18:00:00+02:00",
  "days_until": 1,
  "address": { "street": "…", "houseNumber": "…", "zip": "…", "city": "…", "country": "DE" },
  "collections": [ { "type": "Restmüll", "date": "2026-07-07" } ]
}
```

Enable **Split Collections** to emit one item per fraction instead of one item for the whole
payload.

> Requires a publicly reachable n8n webhook URL. If your instance is not reachable from the
> internet, use the **Binable Polling Trigger** instead.

### Binable Polling Trigger

Polls `/api/fetch` on the schedule you configure (Poll Times) and triggers when a collection
enters the **Lead Time** window (days or hours). Each collection is emitted exactly once
(deduplicated via the node's static data). Ideal for private/NAT'd instances or custom reminder
times.

> Collection dates are day-granular, so a sub-day lead time only influences *which* poll run emits
> the event.

## Localization

The node UI ships translations for **German (`de`)**, **French (`fr`)** and **Dutch (`nl`)**
in addition to the English default (parameter labels, descriptions, options and notices).

n8n shows them when the instance locale is set, e.g.:

```bash
export N8N_DEFAULT_LOCALE=de
```

Translation files live in [nodes/Binable/translations/](nodes/Binable/translations) and are
copied into `dist/` by the build.

## About the API

- Single lookup endpoint `POST /api/fetch` returns ~one year of dates for 12 fixed fractions.
- All range/next/by-date filtering happens client-side inside these nodes.
- Addresses are always `street` / `houseNumber` / `zip` / `city` / `country` (there are no address IDs).
- Full API reference: <https://binable.app/en/integration/api>

## Development

```bash
npm install
npm run build      # tsc + copy icons into dist/
npm run lint
```

## License

[MIT](LICENSE.md) © 2026 Tim Lochmüller
