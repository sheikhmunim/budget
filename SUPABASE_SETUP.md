# Supabase Setup (one-time, ~10 minutes)

## 1. Create a free Supabase project
- Go to https://supabase.com and sign up
- Click "New project", give it a name (e.g. "budget-app"), pick a region close to you
- Wait ~2 minutes for it to spin up

## 2. Create the database tables
In your Supabase dashboard → SQL Editor → paste and run this:

```sql
-- Private per-user state
create table user_state (
  user_id uuid references auth.users(id) on delete cascade primary key,
  state_json jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table user_state enable row level security;

create policy "Users manage their own state"
  on user_state for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Shared trips (access controlled by knowing the code)
create table shared_trips (
  code text primary key,
  state_json jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table shared_trips enable row level security;

create policy "Authenticated users can read and write shared trips"
  on shared_trips for all
  using  (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
```

## 3. Enable magic link email auth
- Dashboard → Authentication → Providers → Email → make sure it's enabled
- Turn OFF "Confirm email" (so the magic link signs in directly without a separate confirmation step)

## 4. Add your app URL to the redirect allowlist
- Dashboard → Authentication → URL Configuration
- Add this exact URL to "Redirect URLs": https://sheikhmunim.github.io/budget/

## 5. Copy your credentials into app.js
- Dashboard → Project Settings → API
- Copy "Project URL" → paste as the value of `SUPABASE_URL` in app.js (line 6)
- Copy "anon public" key → paste as the value of `SUPABASE_KEY` in app.js (line 7)

## 6. Push to GitHub
That's it — the app will now show a sync button and let you sign in with a magic link.
