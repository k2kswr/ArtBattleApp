"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

export type DrawPoint = { x: number; y: number };
export type DrawEvent = {
  type: "stroke";
  playerId: string;
  from: DrawPoint;
  to: DrawPoint;
  color: string;
  size: number;
} | {
  type: "clear";
  playerId: string;
};

type WithoutPlayer<T> = T extends { playerId: string } ? Omit<T, "playerId"> : never;
export type OutgoingDrawEvent = WithoutPlayer<DrawEvent>;

let client: SupabaseClient | null | undefined;

export function getRealtimeClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url?.startsWith("https://") && key ? createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;
  return client;
}

export function roomChannelName(roomId: string, round: number) {
  return `art-battle:${roomId}:round:${round}`;
}

export function isDrawEvent(value: unknown): value is DrawEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (typeof event.playerId !== "string") return false;
  if (event.type === "clear") return true;
  return event.type === "stroke"
    && typeof event.color === "string"
    && typeof event.size === "number"
    && isPoint(event.from)
    && isPoint(event.to);
}

function isPoint(value: unknown): value is DrawPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number";
}

export type { RealtimeChannel };