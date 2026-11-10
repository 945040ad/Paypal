/**
 * Browser only. Keeps the signing key pair in IndexedDB. The private key is a non-extractable CryptoKey:
 * IndexedDB stores the handle, and its bytes never leave the device or become readable to page scripts.
 */
import { generateSigningKeyPair } from "./sign";

const DB_NAME = "system-audit";
const STORE = "keys";
const KEY_ID = "signing-key";

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Returns this browser's key pair, creating and saving one on first use. */
export async function loadOrCreateKeyPair(): Promise<{ keyPair: CryptoKeyPair; created: boolean }> {
  const db = await openKeyDb();
  try {
    const existing = await request<CryptoKeyPair | undefined>(db.transaction(STORE).objectStore(STORE).get(KEY_ID));
    if (existing) return { keyPair: existing, created: false };
    const keyPair = await generateSigningKeyPair();
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(keyPair, KEY_ID));
    return { keyPair, created: true };
  } finally {
    db.close();
  }
}
