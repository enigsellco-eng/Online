# Enigsell Marketing Contact Dashboard

The dashboard is published below the existing Enigsell website:

```text
https://enigsell.com/contact-dashboard/
```

The root `https://enigsell.com/` page remains unchanged.

## Marketing scope

- secure login with no public signup;
- read-only overview for Behtarino, Torob, and Divar;
- read-only run and settings history;
- Behtarino keyword and city editing only;
- Torob keyword preview disabled;
- Divar inputs disabled until they are defined.

Worker rate limits, targets, schedules, pause/resume, run-now controls,
credentials, browser settings, and Google Sheets secrets are deliberately not
part of this application.

## Components

- `index.html` and `assets/`: static GitHub Pages frontend;
- `api/`: isolated FastAPI service deployed to Debian on `127.0.0.1:8050`.
- `api/cloudflared-enigsell-marketing.*`: dedicated tunnel configuration and
  user service for `api.enigsell.com`.

The API uses separate upstream URLs for each source:

- Behtarino: `127.0.0.1:8031`
- Divar: `127.0.0.1:8030`
- Torob: `127.0.0.1:8040`
