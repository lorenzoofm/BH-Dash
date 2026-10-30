// Marketing roles, weekly minimums and pace (redesign rules). Staff is the single source of truth:
// role = Platform, target = Weekly Minimum.
import {addDays, label, mondayOf} from "./bh";

export const ROLES = ["X", "Discord", "IG", "VPS"] as const;
export type Role = typeof ROLES[number];
// X/Discord/IG are the design's channel colours; VPS uses the 20MG teal account token.
export const ROLE_STYLE: Record<Role, {c: string; bar: string; track: string; label: string; pillBg: string; pillFg: string}> = {
  X: {c: "#0a0a0a", bar: "linear-gradient(180deg, #2b2925, #0a0a0a)", track: "linear-gradient(180deg, #ffffff, #f7f5f1)", label: "#ffffff", pillBg: "#e7e3dc", pillFg: "#0a0a0a"},
  Discord: {c: "#4a25c9", bar: "linear-gradient(180deg, #6d4cf0, #4a25c9)", track: "linear-gradient(180deg, #d9cffd, #c6b8fb)", label: "#ffffffe6", pillBg: "#dde6f6", pillFg: "#1d4f9e"},
  IG: {c: "#c8174f", bar: "linear-gradient(180deg, #ee3f78, #c8174f)", track: "linear-gradient(180deg, #ffd4e1, #ffbfd2)", label: "#ffffffe6", pillBg: "#f6dde9", pillFg: "#9a2462"},
  VPS: {c: "#0f7b76", bar: "linear-gradient(180deg, #2a9d96, #0f7b76)", track: "linear-gradient(180deg, #cdeae6, #b5dfda)", label: "#ffffffe6", pillBg: "#d5ece9", pillFg: "#0b6460"},
};
export const roleOf = (platform: unknown): Role => { const p = label(platform); return p === "Instagram" ? "IG" : (ROLES as readonly string[]).includes(p) ? p as Role : "X"; };

// Model avatar fallback when there is no Creatorstaq photo, in model order.
export const AVATAR_GRADIENTS = ["linear-gradient(135deg, #ff8a4d, #ff3000)", "linear-gradient(135deg, #9a7bff, #4a25c9)", "linear-gradient(135deg, #ff7aa8, #c8174f)", "linear-gradient(135deg, #5a5752, #0a0a0a)"];
export const initials = (n: unknown) => String(n || "?").split(/[\s@._]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "?";

export const targetOf = (staff: {fields: Record<string, any>}): number | null => staff.fields.weeklyMin == null || staff.fields.weeklyMin === "" ? null : Number(staff.fields.weeklyMin);

// Day of the week, Monday = 1 … Sunday = 7.
export const dayOfWeek = (today: string) => Math.round((Date.parse(today) - Date.parse(mondayOf(today))) / 864e5) + 1;
// Pace for a week: the full minimum for finished weeks, min × day/7 for the current one.
export const paceFor = (min: number, week: string, today: string) => week === mondayOf(today) ? min * dayOfWeek(today) / 7 : min;

export type Tone = "met" | "short" | "low" | "missing" | "none";
export function toneOf(value: number | null | undefined, target: number | null): Tone {
  if (target == null) return "none";
  if (value == null) return "missing";
  return value >= target ? "met" : value >= target * 0.8 ? "short" : "low";
}
export const TONE_C: Record<Tone, string> = {met: "#1f7a45", short: "#c98a1c", low: "#c81e1e", missing: "#69655e", none: "#69655e"};
export const lastWeek = (today: string) => addDays(mondayOf(today), -7);
