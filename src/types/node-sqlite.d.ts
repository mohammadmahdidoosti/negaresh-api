/** Node 22.13+ runtime API; minimal declarations until @types/node is upgraded. */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: (string | number | null)[]): unknown;
      get(...params: (string | number | null)[]): unknown;
      all(...params: (string | number | null)[]): unknown[];
    };
    close(): void;
  }
}
