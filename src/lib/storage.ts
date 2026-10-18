import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const secureChunkLimitBytes = 1800;

export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') return getBrowserStorage().getItem(key);
    const manifest = await SecureStore.getItemAsync(`${key}.chunk-manifest`);
    if (manifest) {
      const match = /^v1:([a-z0-9-]+):(\d+)$/.exec(manifest);
      if (!match) throw new Error(`Secure storage contains an invalid chunk manifest for "${key}".`);
      const [, id, countText] = match;
      const count = Number(countText);
      const chunks = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          SecureStore.getItemAsync(`${key}.chunk.${id}.${index}`),
        ),
      );
      if (chunks.some((chunk) => chunk === null)) {
        throw new Error(`Secure storage is missing a chunk for "${key}".`);
      }
      return chunks.join('');
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      getBrowserStorage().setItem(key, value);
      return;
    }
    const previousManifest = await SecureStore.getItemAsync(`${key}.chunk-manifest`);
    const chunks = splitUtf8(value, secureChunkLimitBytes);
    if (!chunks) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(`${key}.chunk-manifest`);
      await removeManifestChunks(key, previousManifest);
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await Promise.all(chunks.map((chunk, index) =>
      SecureStore.setItemAsync(`${key}.chunk.${id}.${index}`, chunk),
    ));
    await SecureStore.setItemAsync(`${key}.chunk-manifest`, `v1:${id}:${chunks.length}`);
    await SecureStore.deleteItemAsync(key);
    await removeManifestChunks(key, previousManifest);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      getBrowserStorage().removeItem(key);
      return;
    }
    const manifest = await SecureStore.getItemAsync(`${key}.chunk-manifest`);
    await SecureStore.deleteItemAsync(`${key}.chunk-manifest`);
    await SecureStore.deleteItemAsync(key);
    await removeManifestChunks(key, manifest);
  },
};

export const preferenceStorage = secureStorage;

function getBrowserStorage(): Storage {
  try {
    if (!globalThis.localStorage) throw new Error('Browser storage is unavailable.');
    return globalThis.localStorage;
  } catch (error) {
    throw new Error('Browser storage is unavailable or blocked.', { cause: error });
  }
}

function splitUtf8(value: string, limit: number): string[] | null {
  let byteLength = 0;
  for (const character of value) byteLength += utf8ByteLength(character);
  if (byteLength <= limit) return null;

  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (chunkBytes + characterBytes > limit) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function utf8ByteLength(value: string): number {
  const codePoint = value.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

async function removeManifestChunks(key: string, manifest: string | null) {
  if (!manifest) return;
  const match = /^v1:([a-z0-9-]+):(\d+)$/.exec(manifest);
  if (!match) throw new Error(`Secure storage contains an invalid chunk manifest for "${key}".`);
  const [, id, countText] = match;
  const count = Number(countText);
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(`${key}.chunk.${id}.${index}`),
    ),
  );
}
