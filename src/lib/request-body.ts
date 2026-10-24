import { MAX_BODY_BYTES } from './types';

export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Enforce bytes while reading; Content-Length alone is not trustworthy. */
export async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new RequestBodyError('حجم درخواست بیش از حد مجاز است.', 413);
  if (!request.body) throw new RequestBodyError('درخواست خالی است.', 400);
  const reader = request.body.getReader();
  const onAbort = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
  request.signal.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyError('حجم درخواست بیش از حد مجاز است.', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { request.signal.removeEventListener('abort', onAbort); reader.releaseLock(); }
}
