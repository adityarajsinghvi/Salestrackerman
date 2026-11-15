# Salesman Bonus Tracker

Points per item: Pant/Shirt 1 · Suit/Blazer 10 · Kurta/Kothi 5 (editable in the app).

- **Owner** logs in, opens *Quick Entry*, picks a salesman and taps an item once per piece sold (tap Shirt 10 times for 10 shirts, **−** removes one).
- **Salesmen** log in with the username/password the owner gave them and can only *view* their own points.
- Owner screens: Quick Entry, Leaderboard, History (delete wrong entries, CSV), Manage (add salesman, reset password, deactivate, items/points, ₹ per point).

## How it is built
Static site on GitHub Pages (`index.html`, `app.js`, `style.css`, `config.js`) + Supabase (login, database, Row Level Security).
Salesmen cannot see other people's data or change anything even if they tamper with the page — the database enforces it.
`supabase/migrations/001_init.sql` is the schema; `supabase/functions/admin-users` creates accounts and resets passwords (owner only).

## Publish on GitHub Pages
1. Merge this branch into `main`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Open `https://<your-github-username>.github.io/salestrackerman/`.

## Notes
- Supabase free projects pause after about a week without use; open the app weekly or upgrade.
- There is no email recovery: the owner resets salesman passwords in *Manage*.
