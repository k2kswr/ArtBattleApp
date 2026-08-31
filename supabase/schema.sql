-- Run this in Supabase SQL Editor before enabling hosted multiplayer.
create type judging_mode as enum ('ai', 'player_vote');
create type game_phase as enum ('lobby', 'drawing', 'voting', 'results', 'finished');
create table rooms (id text primary key, host_token text not null, judging_mode judging_mode not null, phase game_phase not null default 'lobby', current_round smallint not null default 0 check (current_round between 0 and 5), prompts jsonb not null, state jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table players (id uuid primary key, room_id text not null references rooms(id) on delete cascade, name text not null check (char_length(name) between 1 and 16), score int not null default 0, active boolean not null default true, joined_at timestamptz not null default now());
create table rounds (id uuid primary key default gen_random_uuid(), room_id text not null references rooms(id) on delete cascade, number smallint not null check (number between 1 and 5), prompt text not null, unique(room_id, number));
create table artworks (id uuid primary key default gen_random_uuid(), round_id uuid not null references rounds(id) on delete cascade, player_id uuid not null references players(id), image_path text not null, ai_score smallint check (ai_score between 0 and 100), ai_comment text, rank smallint, points smallint not null default 0, unique(round_id, player_id));
create table votes (round_id uuid not null references rounds(id) on delete cascade, voter_id uuid not null references players(id), artwork_id uuid not null references artworks(id) on delete cascade, primary key(round_id, voter_id));
alter table rooms enable row level security; alter table players enable row level security; alter table rounds enable row level security; alter table artworks enable row level security; alter table votes enable row level security;
-- Use server-side service-role APIs for game mutations. Publish Realtime changes for all gameplay tables.
alter publication supabase_realtime add table rooms, players, rounds, artworks, votes;
