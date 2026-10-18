import 'server-only';

// Bound anonymous authentication bodies before allocating/parsing the full JSON.
export async function readAuthenticationJson(request: Request) {
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 16384)));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
  return input;
}
export async function readBoundedJsonBytes(request: Request, maximum: number): Promise<Uint8Array> {
  if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get('content-type') || '')) {
    void request.body?.cancel().catch(() => {});
    throw new Error('Invalid request.');
  }
  return readBoundedBodyBytes(request, maximum);
}
export async function readBoundedBodyBytes(request: Pick<Request, 'body' | 'headers'> & { signal?: AbortSignal }, maximum: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Invalid body limit.');
  if (!request.body) throw new Error('Invalid request.');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) {
    void request.body.cancel().catch(() => {});
    throw new Error('Request too large.');
  }
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let size = 0, rejectRead!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  const abort = () => rejectRead(new Error('Request aborted.'));
  const deadline = setTimeout(() => rejectRead(new Error('Request timed out.')), 5000);
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (request.signal?.aborted) throw new Error('Request aborted.');
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new Error('Request too large.');
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  } catch (error) {
    // An upstream cancel hook may never settle; it cannot own our response deadline.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(deadline);
    request.signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
