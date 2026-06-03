export interface TerminalScreenSnapshot {
  text: string;
  lines: string[];
  bottom_lines: string[];
  raw_tail: string;
}

const DEFAULT_ROWS = 40;
const DEFAULT_COLS = 160;
const MAX_RAW_TAIL = 20_000;
const ANSI_PATTERN =
  /[\x1B\x9B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export class SimpleAnsiTerminalScreen {
  private rows: string[] = Array.from({ length: DEFAULT_ROWS }, () => "");
  private cursorRow = 0;
  private cursorCol = 0;
  private savedRow = 0;
  private savedCol = 0;
  private rawTail = "";

  feed(chunk: string): void {
    this.rawTail = tail(`${this.rawTail}${chunk}`, MAX_RAW_TAIL);

    for (let i = 0; i < chunk.length;) {
      const char = chunk[i];
      if (char === "\x1b") {
        const consumed = this.feedEscape(chunk.slice(i));
        if (consumed > 0) {
          i += consumed;
          continue;
        }
      }
      this.feedChar(char);
      i++;
    }
  }

  clear(): void {
    this.rows = Array.from({ length: DEFAULT_ROWS }, () => "");
    this.cursorRow = 0;
    this.cursorCol = 0;
  }

  snapshot(): TerminalScreenSnapshot {
    const lastNonEmpty = Math.max(
      this.cursorRow,
      this.rows.reduce((last, line, index) => line.trim() ? index : last, 0),
    );
    const lines = this.rows.slice(0, lastNonEmpty + 1).map((line) => line.trimEnd());
    return {
      text: lines.join("\n"),
      lines,
      bottom_lines: lines.slice(-10),
      raw_tail: this.rawTail,
    };
  }

  private feedEscape(value: string): number {
    if (value.startsWith("\x1bc")) {
      this.clear();
      return 2;
    }
    if (value.startsWith("\x1b7")) {
      this.savedRow = this.cursorRow;
      this.savedCol = this.cursorCol;
      return 2;
    }
    if (value.startsWith("\x1b8")) {
      this.cursorRow = clamp(this.savedRow, 0, this.rows.length - 1);
      this.cursorCol = clamp(this.savedCol, 0, DEFAULT_COLS - 1);
      return 2;
    }
    if (value.startsWith("\x1b]")) {
      const endBel = value.indexOf("\x07", 2);
      const endSt = value.indexOf("\x1b\\", 2);
      const end = endBel >= 0 ? endBel + 1 : endSt >= 0 ? endSt + 2 : -1;
      return end > 0 ? end : 0;
    }

    const match = /^\x1b\[([0-9?;:]*)([@-~])/.exec(value);
    if (!match) return 0;
    this.handleCsi(match[1] ?? "", match[2] ?? "");
    return match[0].length;
  }

  private handleCsi(rawParams: string, final: string): void {
    if ((final === "h" || final === "l") && rawParams.includes("1049")) {
      this.clear();
      return;
    }
    if (final === "m" || final === "r" || final === "n") return;

    const params = rawParams
      .replace(/\?/g, "")
      .split(/[;:]/)
      .filter(Boolean)
      .map((part) => Number(part))
      .map((value) => Number.isFinite(value) && value > 0 ? value : 1);
    const first = params[0] ?? 1;

    if (final === "A") {
      this.cursorRow = clamp(this.cursorRow - first, 0, this.rows.length - 1);
    } else if (final === "B") {
      this.cursorRow = clamp(this.cursorRow + first, 0, this.rows.length - 1);
    } else if (final === "C") {
      this.cursorCol = clamp(this.cursorCol + first, 0, DEFAULT_COLS - 1);
    } else if (final === "D") {
      this.cursorCol = clamp(this.cursorCol - first, 0, DEFAULT_COLS - 1);
    } else if (final === "E") {
      this.cursorRow = clamp(this.cursorRow + first, 0, this.rows.length - 1);
      this.cursorCol = 0;
    } else if (final === "F") {
      this.cursorRow = clamp(this.cursorRow - first, 0, this.rows.length - 1);
      this.cursorCol = 0;
    } else if (final === "G") {
      this.cursorCol = clamp(first - 1, 0, DEFAULT_COLS - 1);
    } else if (final === "H" || final === "f") {
      this.cursorRow = clamp((params[0] ?? 1) - 1, 0, this.rows.length - 1);
      this.cursorCol = clamp((params[1] ?? 1) - 1, 0, DEFAULT_COLS - 1);
    } else if (final === "J") {
      const mode = params[0] ?? 0;
      if (mode === 2 || mode === 3) this.clear();
    } else if (final === "K") {
      this.clearLine(params[0] ?? 0);
    } else if (final === "S") {
      for (let i = 0; i < first; i++) this.rows.shift();
      while (this.rows.length < DEFAULT_ROWS) this.rows.push("");
    } else if (final === "T") {
      for (let i = 0; i < first; i++) this.rows.unshift("");
      this.rows = this.rows.slice(0, DEFAULT_ROWS);
    }
  }

  private clearLine(mode: number): void {
    const line = this.rows[this.cursorRow] ?? "";
    if (mode === 2) {
      this.rows[this.cursorRow] = "";
    } else if (mode === 1) {
      this.rows[this.cursorRow] = `${" ".repeat(this.cursorCol)}${line.slice(this.cursorCol)}`;
    } else {
      this.rows[this.cursorRow] = line.slice(0, this.cursorCol);
    }
  }

  private feedChar(char: string): void {
    if (char === "\r") {
      this.cursorCol = 0;
      return;
    }
    if (char === "\n") {
      this.newLine();
      return;
    }
    if (char === "\b" || char === "\x7f") {
      this.cursorCol = Math.max(0, this.cursorCol - 1);
      return;
    }
    if (char === "\t") {
      this.writeText("  ");
      return;
    }
    if (isPrintable(char)) {
      this.writeText(char);
    }
  }

  private writeText(value: string): void {
    for (const char of value) {
      const line = this.rows[this.cursorRow] ?? "";
      const padded = line.length < this.cursorCol ? line.padEnd(this.cursorCol, " ") : line;
      this.rows[this.cursorRow] =
        `${padded.slice(0, this.cursorCol)}${char}${padded.slice(this.cursorCol + 1)}`;
      this.cursorCol++;
      if (this.cursorCol >= DEFAULT_COLS) this.newLine();
    }
  }

  private newLine(): void {
    this.cursorRow++;
    this.cursorCol = 0;
    if (this.cursorRow >= this.rows.length) {
      this.rows.shift();
      this.rows.push("");
      this.cursorRow = this.rows.length - 1;
    }
  }
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return code >= 32;
}

function tail(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
