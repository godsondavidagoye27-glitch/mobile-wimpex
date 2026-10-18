import { Directory, File, Paths } from 'expo-file-system';
import { createVideoPlayer } from 'expo-video';
import * as Crypto from 'expo-crypto';
import { needsVideoReencode } from './videoEditorLogic';

export type ExportVideoOptions = {
  uri: string;
  startMs: number;
  endMs: number;
  mute: boolean;
  maxSizeBytes: number;
  sourceMimeType?: string | null;
  onProgress?: (progress: number) => void;
  isCancelled?: () => boolean;
};

export type ExportVideoResult = {
  uri: string;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
};

export function deleteEditedVideo(uri: string) {
  if (!uri.includes('/wimpex-video-edits/')) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

function checkCancelled(isCancelled?: () => boolean) {
  if (isCancelled?.()) {
    throw new Error('Video export cancelled.');
  }
}

function nativePath(uri: string) {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

function fileUri(path: string) {
  if (path.startsWith('file://')) return path;
  return `file://${path.startsWith('/') ? '' : '/'}${path}`;
}

async function readOutputMetadata(uri: string) {
  const player = createVideoPlayer(uri);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let subscription: { remove: () => void } | null = null;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        subscription?.remove();
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => {
        finish(new Error('Could not read the exported video metadata.'));
      }, 15_000);
      subscription = player.addListener('statusChange', ({ status, error }) => {
        if (status === 'readyToPlay') {
          finish();
        } else if (status === 'error') {
          finish(new Error(error?.message ?? 'Could not read the exported video metadata.'));
        }
      });
      if (player.status === 'readyToPlay') finish();
    });
    const videoTrack = player.videoTrack;
    if (!Number.isFinite(player.duration) || player.duration <= 0
      || !videoTrack?.size.width || !videoTrack.size.height) {
      throw new Error('Could not read the exported video duration and dimensions.');
    }
    return {
      durationMs: Math.round(player.duration * 1000),
      width: videoTrack.size.width,
      height: videoTrack.size.height,
      mimeType: videoTrack.mimeType,
    };
  } finally {
    player.release();
  }
}

export async function exportVideo(options: ExportVideoOptions): Promise<ExportVideoResult> {
  if (options.endMs - options.startMs < 1000) {
    throw new Error('Choose at least one second of video.');
  }
  if (options.maxSizeBytes <= 0) {
    throw new Error('The maximum video size must be greater than zero.');
  }
  checkCancelled(options.isCancelled);
  const videoTrim = await import('react-native-video-trim');
  const { trim, compress, deleteFile } = videoTrim;
  let currentPath = '';
  let trimResult: Awaited<ReturnType<typeof trim>>;
  options.onProgress?.(0.1);
  trimResult = await trim(nativePath(options.uri), {
    startTime: options.startMs,
    endTime: options.endMs,
    outputExt: 'mp4',
    removeAudio: options.mute,
    enablePreciseTrimming: options.mute,
  });
  if (!trimResult.success || !trimResult.outputPath) {
    if (trimResult.outputPath) await deleteFile(trimResult.outputPath);
    throw new Error('The video could not be trimmed. Try selecting another range.');
  }
  currentPath = trimResult.outputPath;
  try {
    checkCancelled(options.isCancelled);
    let currentFile = new File(fileUri(currentPath));
    if (!currentFile.exists || currentFile.size <= 0) {
      throw new Error('The video editor did not produce an output file.');
    }
    options.onProgress?.(0.25);
    let metadata = await readOutputMetadata(currentFile.uri);
    const selectedDurationMs = options.endMs - options.startMs;
    if (Math.abs(metadata.durationMs - selectedDurationMs) > 500) {
      await deleteFile(currentPath);
      currentPath = '';
      checkCancelled(options.isCancelled);
      options.onProgress?.(0.3);
      const preciseTrim = await trim(nativePath(options.uri), {
        startTime: options.startMs,
        endTime: options.endMs,
        outputExt: 'mp4',
        removeAudio: options.mute,
        enablePreciseTrimming: true,
      });
      if (!preciseTrim.success || !preciseTrim.outputPath) {
        if (preciseTrim.outputPath) await deleteFile(preciseTrim.outputPath);
        throw new Error('The selected trim range could not be exported precisely. Try again.');
      }
      currentPath = preciseTrim.outputPath;
      currentFile = new File(fileUri(currentPath));
      metadata = await readOutputMetadata(currentFile.uri);
      if (Math.abs(metadata.durationMs - selectedDurationMs) > 500) {
        throw new Error('The selected trim range could not be cut accurately. Try another video.');
      }
    }
    checkCancelled(options.isCancelled);
    const shouldEncode = needsVideoReencode({
      trimmedSizeBytes: currentFile.size,
      maxSizeBytes: options.maxSizeBytes,
      mute: options.mute,
      sourceMimeType: metadata.mimeType ?? options.sourceMimeType,
    });
    if (shouldEncode) {
      let bitrate = Math.max(
        180_000,
        Math.floor((options.maxSizeBytes * 8 * 0.82) / ((options.endMs - options.startMs) / 1000)),
      );
      let height = 720;
      let attempts = 0;
      do {
        checkCancelled(options.isCancelled);
        options.onProgress?.(0.35 + attempts * 0.1);
        const compressed = await compress(currentPath, {
          outputExt: 'mp4',
          height,
          bitrate,
          removeAudio: options.mute,
        });
        const previousPath = currentPath;
        currentPath = compressed.outputPath;
        currentFile = new File(fileUri(currentPath));
        if (previousPath !== currentPath) await deleteFile(previousPath);
        attempts += 1;
        if (currentFile.size <= options.maxSizeBytes) break;
        bitrate = Math.max(160_000, Math.floor(bitrate * 0.68));
        if (attempts >= 2) height = 480;
      } while (attempts < 4);
    }

    checkCancelled(options.isCancelled);
    if (!currentFile.exists || currentFile.size <= 0 || currentFile.size > options.maxSizeBytes) {
      throw new Error('The edited video is still larger than the allowed size. Choose a shorter clip.');
    }
    options.onProgress?.(0.9);
    metadata = await readOutputMetadata(currentFile.uri);
    if (Math.abs(metadata.durationMs - selectedDurationMs) > 500) {
      throw new Error('The exported video duration does not match the selected trim range.');
    }
    if (!/(?:avc|h264)/i.test(metadata.mimeType ?? '')) {
      throw new Error('This device could not export an H.264 MP4 video. Try another video or device.');
    }
    checkCancelled(options.isCancelled);

    const directory = new Directory(Paths.document, 'wimpex-video-edits');
    directory.create({ intermediates: true, idempotent: true });
    const durableFile = new File(directory, `${Crypto.randomUUID()}.mp4`);
    currentFile.copy(durableFile);
    if (!durableFile.exists || durableFile.size <= 0) {
      throw new Error('The edited video could not be saved for upload.');
    }
    return {
      uri: durableFile.uri,
      ...metadata,
      sizeBytes: durableFile.size,
    };
  } finally {
    if (currentPath) await deleteFile(currentPath);
  }
}
