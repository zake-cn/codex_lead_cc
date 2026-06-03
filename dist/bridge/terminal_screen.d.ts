export interface TerminalScreenSnapshot {
    text: string;
    lines: string[];
    bottom_lines: string[];
    raw_tail: string;
}
export declare class SimpleAnsiTerminalScreen {
    private rows;
    private cursorRow;
    private cursorCol;
    private savedRow;
    private savedCol;
    private rawTail;
    feed(chunk: string): void;
    clear(): void;
    snapshot(): TerminalScreenSnapshot;
    private feedEscape;
    private handleCsi;
    private clearLine;
    private feedChar;
    private writeText;
    private newLine;
}
export declare function stripAnsi(value: string): string;
