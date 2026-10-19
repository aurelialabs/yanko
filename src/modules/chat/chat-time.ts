import type { ChatMessagePresentation } from "@/modules/chat/chat-presentation";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const FIVE_MINUTES = 5 * 60 * 1000;

interface ShanghaiParts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
  weekday: string;
}

function shanghaiParts(date: Date): ShanghaiParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";

  return {
    year,
    month,
    day,
    hour: read("hour"),
    minute: read("minute"),
    weekday,
  };
}

function dayNumber(parts: ShanghaiParts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function formatChatTime(value: string, now = new Date()): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;

  const current = shanghaiParts(date);
  const today = shanghaiParts(now);
  const clock = `${current.hour}:${current.minute}`;
  const elapsedDays = dayNumber(today) - dayNumber(current);

  if (elapsedDays === 0) return clock;
  if (elapsedDays === 1) return `昨天 ${clock}`;
  if (elapsedDays > 1 && elapsedDays < 7) return `${current.weekday} ${clock}`;
  if (current.year === today.year) return `${current.month}月${current.day}日 ${clock}`;
  return `${current.year}年${current.month}月${current.day}日 ${clock}`;
}

export function shouldShowChatTime(current: string, previous: string | null) {
  if (!previous) return true;
  const nextTime = new Date(current).valueOf();
  const previousTime = new Date(previous).valueOf();
  if (Number.isNaN(nextTime) || Number.isNaN(previousTime)) return true;
  if (nextTime - previousTime >= FIVE_MINUTES) return true;
  return dayNumber(shanghaiParts(new Date(current))) !== dayNumber(shanghaiParts(new Date(previous)));
}

export function scriptedMessageTime(anchorDate: string, index: number) {
  const minute = String(Math.min(Math.max(index, 0), 59)).padStart(2, "0");
  return `${anchorDate}T09:${minute}:00+08:00`;
}

export type ChatThreadEntry =
  | { kind: "time"; id: string; label: string }
  | { kind: "message"; message: ChatMessagePresentation }
  | { kind: "marker"; id: string };

export function buildChatThread(input: {
  messages: ChatMessagePresentation[];
  markers?: Array<{ id: string; afterMessageId: string | null }>;
  now?: Date;
}): ChatThreadEntry[] {
  const ids = new Set(input.messages.map((message) => message.id));
  const markersAfter = new Map<string, string[]>();
  const unmatched: string[] = [];

  for (const marker of input.markers ?? []) {
    if (marker.afterMessageId && ids.has(marker.afterMessageId)) {
      const list = markersAfter.get(marker.afterMessageId) ?? [];
      list.push(marker.id);
      markersAfter.set(marker.afterMessageId, list);
    } else {
      unmatched.push(marker.id);
    }
  }

  const entries: ChatThreadEntry[] = [];
  let previousTime: string | null = null;

  for (const message of input.messages) {
    if (message.createdAt && shouldShowChatTime(message.createdAt, previousTime)) {
      const label = formatChatTime(message.createdAt, input.now);
      if (label) {
        entries.push({ kind: "time", id: `time-${message.id}`, label });
      }
    }
    if (message.createdAt && !Number.isNaN(new Date(message.createdAt).valueOf())) {
      previousTime = message.createdAt;
    }

    entries.push({ kind: "message", message });
    for (const id of markersAfter.get(message.id) ?? []) {
      entries.push({ kind: "marker", id });
    }
  }

  for (const id of unmatched) entries.push({ kind: "marker", id });
  return entries;
}
