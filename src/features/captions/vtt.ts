export type VttCue = {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
};

type ParsedVtt = {
  cues: VttCue[];
  malformed: boolean;
};

function parseTimestamp(value: string) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function parseVtt(source: string): ParsedVtt {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const cues: VttCue[] = [];
  let malformed = false;
  let index = lines[0]?.startsWith('WEBVTT') ? 1 : 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index >= lines.length) break;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[index])) {
      index += 1;
      while (index < lines.length && lines[index].trim()) index += 1;
      continue;
    }

    let id: string | undefined;
    let timing = lines[index].trim();
    if (!timing.includes('-->')) {
      id = timing;
      index += 1;
      timing = lines[index]?.trim() ?? '';
    }

    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(timing);
    const startMs = match ? parseTimestamp(match[1]) : null;
    const endMs = match ? parseTimestamp(match[2]) : null;
    if (!match || startMs === null || endMs === null || endMs <= startMs) {
      malformed = true;
      while (index < lines.length && lines[index].trim()) index += 1;
      continue;
    }

    index += 1;
    const cueLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      cueLines.push(lines[index]);
      index += 1;
    }
    if (cueLines.length === 0) {
      malformed = true;
      continue;
    }
    cues.push({ ...(id ? { id } : {}), startMs, endMs, text: cueLines.join('\n') });
  }

  return { cues, malformed };
}

export function parseWebVtt(source: string): VttCue[] {
  try {
    return parseVtt(source).cues;
  } catch {
    return [];
  }
}

export function findVttCue(cues: VttCue[], playbackSeconds: number): VttCue | null {
  const playbackMs = playbackSeconds * 1000;
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle];
    if (playbackMs < cue.startMs) high = middle - 1;
    else if (playbackMs >= cue.endMs) low = middle + 1;
    else return cue;
  }
  return null;
}

function formatTimestamp(milliseconds: number) {
  const totalMilliseconds = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const remainder = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}

export function writeWebVtt(cues: VttCue[]) {
  const blocks = cues.map((cue) => {
    const id = cue.id ? `${cue.id}\n` : '';
    return `${id}${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}\n${cue.text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
}

function wrapCaption(text: string, maxLineLength: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLineLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function normalizeWebVtt(cues: VttCue[]) {
  const normalized: VttCue[] = [];
  for (const cue of cues) {
    const lines = wrapCaption(cue.text.replace(/\s*\n\s*/g, ' '), 42);
    const chunks: string[] = [];
    for (let index = 0; index < lines.length; index += 2) {
      chunks.push(lines.slice(index, index + 2).join('\n'));
    }
    if (!chunks.length) continue;

    chunks.forEach((text, index) => {
      const startMs = cue.startMs + Math.floor((cue.endMs - cue.startMs) * index / chunks.length);
      const endMs = cue.startMs + Math.floor((cue.endMs - cue.startMs) * (index + 1) / chunks.length);
      if (endMs <= startMs) return;
      normalized.push({
        startMs,
        endMs,
        text,
      });
    });
  }
  return normalized;
}

export function validateVttRewrite(original: string, rewritten: string) {
  const before = parseVtt(original);
  const after = parseVtt(rewritten);
  if (before.malformed || after.malformed || before.cues.length === 0 || before.cues.length !== after.cues.length) {
    return { valid: false, error: 'The captions are not valid WebVTT.' } as const;
  }
  for (let index = 0; index < before.cues.length; index += 1) {
    const originalCue = before.cues[index];
    const rewrittenCue = after.cues[index];
    if (originalCue.startMs !== rewrittenCue.startMs || originalCue.endMs !== rewrittenCue.endMs) {
      return { valid: false, error: 'Caption timing cannot be changed.' } as const;
    }
    const lines = rewrittenCue.text.split('\n');
    if (lines.length > 2 || rewrittenCue.text.length > 84) {
      return { valid: false, error: 'Each caption must have at most two lines and 84 characters.' } as const;
    }
  }
  return { valid: true, cues: after.cues } as const;
}
