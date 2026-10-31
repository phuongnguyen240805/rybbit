export class RequestBodyTooLarge extends Error {}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new RequestBodyTooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks);
      length += value.byteLength;
      if (length > maxBytes) throw new RequestBodyTooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
}
