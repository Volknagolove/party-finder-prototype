# Party Finder — frontend prototype

Local frontend for finding a Lineage II party or recruiting one. No real authentication, character database, or application API is connected yet.

## Run

From the repository root:

```powershell
python -m http.server 8003 --bind 127.0.0.1
```

Open `http://127.0.0.1:8003/party-finder/#ru`.

## Two presentations

- **Guest:** choose a mode, then “Продолжить без авторизации”. The public ElmoreLab-inspired presentation stays in place; name, class, and level are entered manually.
- **Demo account:** use the test credentials shown in the local login dialog. The page reloads to `?view=cabinet&mode=find` or `?view=cabinet&mode=create` with a cabinet-style shell. Its light/dark setting is stored in this browser.

The two presentations use the same `app.js` and `applications.js` logic and the same local demo data. `cabinet.css` and `cabinet.js` only provide the authenticated presentation and navigation. The shell was designed after reviewing the Russian ElmoreLab profile, its light and dark styles, and the public theme variables in `cabinet.css` / `cabinet-dark.css` on `profile.elmorelab.com`. It is a local adaptation, not a copy of the authenticated profile page.

## Backend integration points

- Replace the local demo/guest session in `app.js` with a server-verified session. A local page cannot read the authenticated cookies of `profile.elmorelab.com` across origins.
- Replace `demoCharacters` with characters and current levels returned for the signed-in account.
- Replace application fixtures and `localStorage` persistence in `applications.js` with backend endpoints; check availability, vacancies, and permissions on the server.
- Store times in a canonical timezone and convert to the viewer’s timezone at the edges.
- Keep unverified guest class/level visually distinct from verified profile data.

Third-party assets are present in `assets/`; clarify redistribution rights before using this repository as a production source.
