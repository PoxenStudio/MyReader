// SRT/VTT subtitle parsing and time-sync for audiobook playback.
//
// Ported from the MyBooks web player's audio/_id.vue (parseSRT/syncSubtitle):
// tolerates the SRT `HH:MM:SS,mmm` timestamp form as well as the WebVTT form
// that omits the hour (`MM:SS.mmm`), sorts cues defensively (malformed files
// aren't guaranteed to be in order, and findActiveCueIndex's binary search
// assumes ascending start times), and skips blocks with no timestamp line,
// empty text, or a non-positive duration.

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const TIMESTAMP_RE =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

const toSeconds = (hours: string | undefined, minutes: string, seconds: string, ms: string) =>
  Number(hours || 0) * 3600 +
  Number(minutes) * 60 +
  Number(seconds) +
  Number(ms.padEnd(3, '0')) / 1000;

export function parseSubtitle(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split(/\n\n+/)
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex((line) => TIMESTAMP_RE.test(line));
    if (timeLineIndex === -1) continue;
    const match = TIMESTAMP_RE.exec(lines[timeLineIndex]!);
    if (!match) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const start = toSeconds(h1, m1!, s1!, ms1!);
    const end = toSeconds(h2, m2!, s2!, ms2!);
    const text = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .trim();
    if (text && end > start) {
      cues.push({ start, end, text });
    }
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Binary search for the cue whose [start, end) window contains `timeSec`;
// -1 when `timeSec` falls in a gap between cues, before the first cue, or
// after the last one.
export function findActiveCueIndex(cues: SubtitleCue[], timeSec: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid]!;
    if (timeSec < cue.start) {
      hi = mid - 1;
    } else if (timeSec >= cue.end) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return -1;
}
