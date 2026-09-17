/** Shared binary fetch with download progress for large connectome bins. */

/** Male CNS CSR on Pages (`web/data/connectome.bin`). Used when Content-Length is missing. */
export const CONNECTOME_BYTES = 38074596;

export function formatMb(n) {
  return (Number(n) / 1e6).toFixed(1);
}

/**
 * Fetch an ArrayBuffer, reporting byte progress when possible.
 * Prefers Content-Length; falls back to `knownBytes` (connectome ~38MB).
 *
 * @param {string} url
 * @param {(received: number, total: number) => void} [onProgress]
 * @param {number} [knownBytes]
 */
export async function fetchBufProgress(url, onProgress, knownBytes = 0) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " " + res.status);
  const headerLen = Number(res.headers.get("Content-Length")) || 0;
  const totalHint = headerLen || knownBytes || 0;
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    if (onProgress) onProgress(buf.byteLength, totalHint || buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (onProgress) onProgress(received, totalHint);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  if (onProgress) onProgress(received, totalHint || received);
  return out.buffer;
}

export async function fetchBuf(url) {
  return fetchBufProgress(url);
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.json();
}

/** Loader copy for the ~38MB male CSR. */
export function connectomeWaitMsg(received = 0, total = CONNECTOME_BYTES) {
  const t = total || CONNECTOME_BYTES;
  if (received > 0 && t > 0) {
    return `male CNS connectome ${formatMb(received)} / ${formatMb(t)} MB — large file, please wait / desktop Chrome`;
  }
  return "large connectome ~38MB — please wait / use desktop Chrome";
}
