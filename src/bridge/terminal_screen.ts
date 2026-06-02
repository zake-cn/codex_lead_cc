export interface TerminalScreenSnapshot {
  text: string;
  lines: string[];
  bottom_lines: string[];
  raw_tail: string;
}

const MAX_LINES = 300;
const MAX_RAW_TAIL = 20_000;
const ANSI_PATTERN =
  /[\x1B\x9B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export class SimpleAnsiTerminalScreen {
  private lines: string[] = [];
  private currentLine = "";
  private rawTail = "";

  feed(chunk: string): void {
    this.rawTail = tail(`${this.rawTail}${chunk}`, MAX_RAW_TAIL);
    if (hasClearScreen(chunk)) {
      this.clear();
    }

    const plain = stripAnsi(chunk);
    for (const char of plain) {
      this.feedChar(char);
    }
    this.trim();
  }

  clear(): void {
    this.lines = [];
    this.currentLine = "";
  }

  snapshot(): TerminalScreenSnapshot {
    const visibleLines = [...this.lines, this.currentLine];
    const lines = visibleLines.slice(-MAX_LINES);
    return {
      text: lines.join("\n"),
      lines,
      bottom_lines: lines.slice(-10),
      raw_tail: this.rawTail,
    };
  }

  private feedChar(char: string): void {
    if (char === "\r") {
      this.currentLine = "";
      return;
    }
    if (char === "\n") {
      this.lines.push(this.currentLine);
      this.currentLine = "";
      return;
    }
    if (char === "\b" || char === "\x7f") {
      this.currentLine = this.currentLine.slice(0, -1);
      return;
    }
    if (char === "\t") {
      this.currentLine += "  ";
      return;
    }
    if (isPrintable(char)) {
      this.currentLine += char;
    }
  }

  private trim(): void {
    if (this.lines.length > MAX_LINES) {
      this.lines = this.lines.slice(-MAX_LINES);
    }
  }
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function hasClearScreen(chunk: string): boolean {
  return /\x1Bc|\x1B\[(?:\?1049[hl]|2J|3J|H|1;1H)/.test(chunk);
}

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return code >= 32 || code === 10 || code === 13;
}

function tail(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}
