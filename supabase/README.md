# Accounts on the GitHub Pages site (Supabase)

The GitHub Pages site can't run the Node account server, so it can store accounts in a free Supabase project instead. People still sign up with a **username and password**. No email address is needed. Their saved projects then open from any computer under **My projects**.

When the two repository variables below are not set, the site works as before, with no accounts.

## One-time setup

1. **Create a Supabase project.** Sign up at [supabase.com](https://supabase.com) and choose **New project**. Pick any name, a region close to your users and a database password, then wait for it to finish setting up.
2. **Create the tables.** Open **SQL Editor → New query**, paste all of [`schema.sql`](schema.sql), and choose **Run**. You should see "Success. No rows returned". Running it again later is safe.
3. **Copy the connection details.** Open **Project Settings → API Keys** and **Data API**, and copy:
   - the **Project URL**, such as `https://abcdefgh.supabase.co`
   - the **anon / publishable** key. This key is meant to be public. **Never** use the `service_role` or secret key; the build refuses it.
4. **Give them to GitHub.** In the repository, open **Settings → Secrets and variables → Actions → Variables** and add:
   - `SUPABASE_URL`, set to the Project URL
   - `SUPABASE_ANON_KEY`, set to the anon or publishable key
5. **Publish.** Open **Actions → Build and publish Optical Workbench → Run workflow**, or push any change to `main`.

The landing page's **Launch workbench** button then opens the account edition. **Use without an account** keeps the guest workbench, which autosaves in the browser.

## How it works

- The tables live in a private `workbench` schema that the Supabase API does not expose. The browser can only call the `workbench_*` functions, and each one checks the caller's session token.
- Passwords are stored as bcrypt hashes. Session tokens last 7 days and only their SHA-256 hash is stored.
- Sign-in attempts are limited to 15 per username and 30 per address every 15 minutes.
- Each account can keep 30 projects and 100 MiB, with up to 20 MiB per project.

## Things to know

- **Free projects pause after about a week without use.** Restore the project from the Supabase dashboard if sign-in stops working. Saved data is kept.
- The free plan has a 500 MB database, shared by all accounts.
- **There is no password reset.** To set a new password for someone, run this in the SQL Editor, replacing the username and password:

  ```sql
  update workbench.accounts
  set password_hash = extensions.crypt('new password here', extensions.gen_salt('bf', 10))
  where lower(username) = lower('their_username');
  ```

- To remove an account and all its projects: `delete from workbench.accounts where lower(username) = lower('their_username');`
- `npm test` runs `schema.sql` in an in-process Postgres (PGlite) and checks the access rules, so changes to the schema are tested before they reach Supabase.
