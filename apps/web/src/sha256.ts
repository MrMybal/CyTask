/**
 * SHA-256 incrémental.
 *
 * `crypto.subtle.digest` n'accepte qu'un tampon complet : hacher un fichier de
 * plusieurs gigaoctets imposerait de le charger entièrement en mémoire. Cette
 * implémentation consomme le fichier par tranches et ne retient jamais plus d'une
 * tranche à la fois. Elle est plus lente que l'implémentation native, qui reste
 * donc utilisée pour les tailles où le tampon complet est sans risque.
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const BLOCK_BYTES = 64;

export class Sha256Stream {
  private readonly state = new Int32Array(8);
  private readonly schedule = new Int32Array(64);
  private readonly pending = new Uint8Array(BLOCK_BYTES);
  private pendingLength = 0;
  private byteCount = 0;

  constructor() {
    this.state.set([
      0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
      0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0
    ]);
  }

  update(data: Uint8Array): void {
    this.byteCount += data.length;
    let offset = 0;

    if (this.pendingLength > 0) {
      const take = Math.min(BLOCK_BYTES - this.pendingLength, data.length);
      this.pending.set(data.subarray(0, take), this.pendingLength);
      this.pendingLength += take;
      offset = take;
      if (this.pendingLength === BLOCK_BYTES) {
        this.compress(this.pending, 0);
        this.pendingLength = 0;
      }
    }

    while (offset + BLOCK_BYTES <= data.length) {
      this.compress(data, offset);
      offset += BLOCK_BYTES;
    }

    if (offset < data.length) {
      this.pending.set(data.subarray(offset), 0);
      this.pendingLength = data.length - offset;
    }
  }

  digest(): string {
    // Un bloc suffit sauf si le remplissage ne laisse pas huit octets pour la longueur.
    const padded = new Uint8Array(this.pendingLength < BLOCK_BYTES - 8 ? BLOCK_BYTES : BLOCK_BYTES * 2);
    padded.set(this.pending.subarray(0, this.pendingLength), 0);
    padded[this.pendingLength] = 0x80;

    const bitLength = this.byteCount * 8;
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    const end = padded.length;
    padded[end - 8] = (high >>> 24) & 0xff;
    padded[end - 7] = (high >>> 16) & 0xff;
    padded[end - 6] = (high >>> 8) & 0xff;
    padded[end - 5] = high & 0xff;
    padded[end - 4] = (low >>> 24) & 0xff;
    padded[end - 3] = (low >>> 16) & 0xff;
    padded[end - 2] = (low >>> 8) & 0xff;
    padded[end - 1] = low & 0xff;

    for (let offset = 0; offset < end; offset += BLOCK_BYTES) {
      this.compress(padded, offset);
    }

    let hex = "";
    for (let index = 0; index < 8; index++) {
      hex += (this.state[index]! >>> 0).toString(16).padStart(8, "0");
    }
    return hex;
  }

  private compress(block: Uint8Array, offset: number): void {
    const w = this.schedule;
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      w[index] = ((block[at]! << 24) | (block[at + 1]! << 16) | (block[at + 2]! << 8) | block[at + 3]!) | 0;
    }
    for (let index = 16; index < 64; index++) {
      const x = w[index - 15]!;
      const y = w[index - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[index] = (((w[index - 16]! + s0) | 0) + ((w[index - 7]! + s1) | 0)) | 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index++) {
      const sigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (((h + sigma1) | 0) + ((choice + K[index]!) | 0) + w[index]!) | 0;
      const sigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    this.state[0] = (this.state[0]! + a) | 0;
    this.state[1] = (this.state[1]! + b) | 0;
    this.state[2] = (this.state[2]! + c) | 0;
    this.state[3] = (this.state[3]! + d) | 0;
    this.state[4] = (this.state[4]! + e) | 0;
    this.state[5] = (this.state[5]! + f) | 0;
    this.state[6] = (this.state[6]! + g) | 0;
    this.state[7] = (this.state[7]! + h) | 0;
  }
}

/** Au-delà de cette taille, le tampon complet exigé par `crypto.subtle` devient risqué. */
const NATIVE_DIGEST_LIMIT = 64 * 1024 * 1024;

const SLICE_BYTES = 8 * 1024 * 1024;

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Empreinte SHA-256 d'un blob. Les tailles modestes passent par l'implémentation
 * native ; au-delà, le fichier est lu par tranches sans jamais être chargé entier.
 */
export async function sha256(blob: Blob, onProgress?: (bytesRead: number) => void): Promise<string> {
  if (blob.size <= NATIVE_DIGEST_LIMIT) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    onProgress?.(blob.size);
    return toHex(digest);
  }

  const hasher = new Sha256Stream();
  let offset = 0;
  while (offset < blob.size) {
    const end = Math.min(offset + SLICE_BYTES, blob.size);
    const slice = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    hasher.update(slice);
    offset = end;
    onProgress?.(offset);
  }
  return hasher.digest();
}
