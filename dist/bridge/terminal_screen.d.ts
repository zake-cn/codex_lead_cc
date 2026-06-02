export interface TerminalScreenSnapshot {
    text: string;
    lines: string[];
    bottom_lines: string[];
    raw_tail: string;
}
export declare class SimpleAnsiTerminalScreen {
    private lines;
    private currentLine;
    private rawTail;
    feed(chunk: string): void;
    clear(): void;
    snapshot(): TerminalScreenSnapshot;
    private feedChar;
    private trim;
}
export declare function stripAnsi(value: string): string;
