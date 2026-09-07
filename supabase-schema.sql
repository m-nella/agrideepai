create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists verification_codes_lookup on public.verification_codes(email,purpose,created_at desc);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default 'New conversation',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chats_user_updated on public.chats(user_id,updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists messages_chat_created on public.messages(chat_id,created_at asc);

alter table public.users enable row level security;
alter table public.verification_codes enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;

-- The application uses the Supabase service-role key only on the server.
-- Do not expose that key to the browser.
