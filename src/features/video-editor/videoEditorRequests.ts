import { router } from 'expo-router';
import { Platform } from 'react-native';

export type VideoEditorResult = {
  uri: string;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  caption: string;
  muted: boolean;
  startMs: number;
  endMs: number;
};

export type VideoEditorRequest = {
  uri: string;
  maxDurationMs: number;
  maxSizeBytes: number;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  caption?: string;
};

type PendingRequest = {
  resolve: (result: VideoEditorResult | null) => void;
  reject: (error: unknown) => void;
};

const pendingRequests = new Map<string, PendingRequest>();
let nextRequestId = 0;

export function openVideoEditor(request: VideoEditorRequest): Promise<VideoEditorResult | null> {
  if (Platform.OS === 'web') {
    return Promise.reject(new Error('Video editing is available in the Wimpex mobile app.'));
  }
  const requestId = `${Date.now()}-${nextRequestId++}`;
  const promise = new Promise<VideoEditorResult | null>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
  });
  try {
    router.push({
      pathname: '/video-editor',
      params: {
        requestId,
        uri: request.uri,
        maxDurationMs: String(request.maxDurationMs),
        maxSizeBytes: String(request.maxSizeBytes),
        durationMs: String(request.durationMs),
        sizeBytes: String(request.sizeBytes),
        width: String(request.width),
        height: String(request.height),
        caption: request.caption ?? '',
      },
    });
  } catch (error) {
    pendingRequests.delete(requestId);
    return Promise.reject(error);
  }
  return promise;
}

export function finishVideoEditorRequest(requestId: string, result: VideoEditorResult | null) {
  const request = pendingRequests.get(requestId);
  if (!request) return;
  pendingRequests.delete(requestId);
  request.resolve(result);
}
