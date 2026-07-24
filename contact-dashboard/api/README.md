# Enigsell Marketing Dashboard API

This API is an isolated, allow-listed gateway for the marketing dashboard.

It exposes:

- login, logout, and current-session endpoints;
- read-only overview and history endpoints;
- one write endpoint for Behtarino keyword and city.

It does not expose worker scheduling, rate limits, pause/resume, run-now,
credentials, browser configuration, or Google Sheets credentials.

Create or reset a user on Debian:

```bash
cd /home/agmentic/enigsell-marketing-dashboard-api
.venv/bin/python manage_users.py upsert --email USER@example.com --name "Name"
```

Disable a user and revoke their sessions:

```bash
.venv/bin/python manage_users.py disable --email USER@example.com
```
