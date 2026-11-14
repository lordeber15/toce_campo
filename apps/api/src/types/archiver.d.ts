// archiver 8 no publica tipos; solo lo que usamos.
declare module 'archiver' {
  import { Transform } from 'node:stream';
  export interface EntryData { name: string; date?: Date; store?: boolean }
  export class ZipArchive extends Transform {
    constructor(options?: { store?: boolean; zlib?: { level?: number }; comment?: string });
    append(source: NodeJS.ReadableStream | Buffer | string, data: EntryData): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
  }
}
