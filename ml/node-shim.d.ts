// Minimal Node typings for the training scripts (avoids adding @types/node).
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare const process: { cwd(): string; argv: string[]; exit(code?: number): never };
