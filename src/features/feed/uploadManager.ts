import { Platform } from 'react-native';
import { Upload } from 'tus-js-client';
import { getSupabaseClient } from '../../lib/supabase';
import { getErrorMessage } from '../../lib/errorMessage';
import type { Post } from '../../types/database';
import { getVideoExtension } from '../media/videoExtension';
import { isVideoDraft, isVideoUploadJob } from './uploadValidation';
import { createPostInsertPayload } from './postInsertPayload';
import { requestPendingModeration } from '../moderation/requestModeration';
import {
  cleanupPostDraft,
  cleanupUploadedPostDraft,
  createPostDraft,
  restorePostDraft,
  sortPostDrafts,
  updatePostDraft,
  type SavedPostDraft,
} from './postDraftModel';

export type VideoUploadJob = {
  id: string;
  ownerId: string;
  postId: string;
  uri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  durationMs: number;
  width: number;
  height: number;
  caption: string;
  hashtags: string[];
  audience: 'everyone' | 'followers';
  allowComments: boolean;
  autoCaptions: boolean;
  scheduledAt: string | null;
  progress: number;
  uploadUrl: string | null;
  state: 'queued' | 'uploading' | 'failed';
  error: string | null;
};

export type VideoDraft = {
  uri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  durationMs: number;
  width: number;
  height: number;
  caption: string;
  audience: 'everyone' | 'followers';
  allowComments: boolean;
  autoCaptions: boolean;
  editSettings?: {
    startMs: number;
    endMs: number;
    muted: boolean;
  };
};

type UploadListener = (jobs: VideoUploadJob[]) => void;
type StoredTusUpload = NonNullable<Parameters<Upload['resumeFromPreviousUpload']>[0]>;

const jobsKey = 'wimpex:feed:upload-job:';
const tusKey = 'wimpex:feed:tus:';
const draftKey = 'wimpex:feed:create-post-draft';
const draftsKey = 'wimpex:feed:create-post-drafts';
const listeners = new Set<UploadListener>();
const activeUploads = new Map<string, Promise<void>>();
const jobs = new Map<string, VideoUploadJob>();
const progressWriteAt = new Map<string, number>();
let hydrated = false;
let hydration: Promise<void> | null = null;
let draftWriteQueue: Promise<void> = Promise.resolve();

function getAllKeys(): Promise<string[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      Array.from({ length: globalThis.localStorage.length }, (_, index) => globalThis.localStorage.key(index))
        .filter((key): key is string => key !== null),
    );
  }
  return import('expo-sqlite/kv-store').then(({ Storage }) => Storage.getAllKeys());
}

function getItem(key: string): Promise<string | null> {
  return Platform.OS === 'web'
    ? Promise.resolve(globalThis.localStorage.getItem(key))
    : import('expo-sqlite/kv-store').then(({ Storage }) => Storage.getItem(key));
}

function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(key, value);
    return Promise.resolve();
  }
  return import('expo-sqlite/kv-store').then(({ Storage }) => Storage.setItem(key, value));
}

function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return import('expo-sqlite/kv-store').then(({ Storage }) => Storage.removeItem(key));
}

function publishJobs() {
  const snapshot = [...jobs.values()];
  listeners.forEach((listener) => listener(snapshot));
}

async function hydrateJobs() {
  if (hydrated) return;
  if (!hydration) {
    hydration = (async () => {
      try {
        const keys = await getAllKeys();
        for (const key of keys.filter((candidate) => candidate.startsWith(jobsKey))) {
          const value = await getItem(key);
          if (!value) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(value);
          } catch (error) {
            console.error('Removing a malformed saved video upload.', { key, error });
            await removeItem(key);
            continue;
          }
          if (!isVideoUploadJob(parsed)) {
            console.error('Removing an invalid saved video upload.', { key });
            await removeItem(key);
            continue;
          }
          const recoveredJob = parsed.state === 'uploading' ? { ...parsed, state: 'queued' as const } : parsed;
          if (recoveredJob !== parsed) await setItem(key, JSON.stringify(recoveredJob));
          jobs.set(recoveredJob.id, recoveredJob);
        }
        hydrated = true;
      } finally {
        hydration = null;
      }
    })();
  }
  await hydration;
}

async function saveJob(job: VideoUploadJob, persistProgress = true) {
  const now = Date.now();
  const lastWrite = progressWriteAt.get(job.id) ?? 0;
  if (persistProgress || now - lastWrite >= 500) {
    try {
      await setItem(`${jobsKey}${job.id}`, JSON.stringify(job));
      progressWriteAt.set(job.id, now);
    } catch (error) {
      jobs.set(job.id, job);
      publishJobs();
      throw error;
    }
  }
  jobs.set(job.id, job);
  publishJobs();
}

function getStorageEndpoint() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL before uploading videos.');
  const parsed = new URL(supabaseUrl);
  if (parsed.hostname.endsWith('.supabase.co')) {
    return `https://${parsed.hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`;
}

function createTusUrlStorage() {
  return {
    async findAllUploads(): Promise<StoredTusUpload[]> {
      const keys = await getAllKeys();
      const stored: StoredTusUpload[] = [];
      for (const key of keys.filter((candidate) => candidate.startsWith(tusKey))) {
        const value = await getItem(key);
        if (!value) continue;
        try {
          const upload = parseStoredTusUpload(value, key);
          stored.push(upload);
        } catch (error) {
          console.error('Removing a malformed resumable upload record.', { key, error });
          await removeItem(key);
        }
      }
      return stored;
    },
    async findUploadsByFingerprint(fingerprint: string): Promise<StoredTusUpload[]> {
      const key = `${tusKey}${fingerprint}`;
      const value = await getItem(key);
      if (!value) return [];
      try {
        return [parseStoredTusUpload(value, key)];
      } catch (error) {
        console.error('Removing a malformed resumable upload record.', { key, error });
        await removeItem(key);
        return [];
      }
    },
    async addUpload(fingerprint: string, upload: StoredTusUpload): Promise<string> {
      const key = `${tusKey}${fingerprint}`;
      await setItem(key, JSON.stringify(upload));
      return key;
    },
    async removeUpload(urlStorageKey: string): Promise<void> {
      await removeItem(urlStorageKey);
    },
  };
}

function parseStoredTusUpload(value: string, urlStorageKey: string): StoredTusUpload {
  const parsed: unknown = JSON.parse(value);
  if (!isStoredTusUploadData(parsed)) {
    throw new Error('The resumable upload record has an invalid shape.');
  }
  return { ...parsed, urlStorageKey };
}

function isStoredTusUploadData(value: unknown): value is Omit<StoredTusUpload, 'urlStorageKey'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const upload = value as Record<string, unknown>;
  const metadata = upload.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (upload.size === null || (typeof upload.size === 'number' && Number.isFinite(upload.size)))
    && Object.values(metadata).every((entry) => typeof entry === 'string')
    && typeof upload.creationTime === 'string'
    && (upload.uploadUrl === null || typeof upload.uploadUrl === 'string')
    && (upload.parallelUploadUrls === null
      || (Array.isArray(upload.parallelUploadUrls)
        && upload.parallelUploadUrls.every((entry) => typeof entry === 'string')));
}

async function upsertPostRecord(job: VideoUploadJob): Promise<Post['status']> {
  const client = getSupabaseClient();
  const { data: existing, error: readError } = await client
    .from('posts')
    .select('id, author_id, status')
    .eq('id', job.postId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.author_id !== job.ownerId) throw new Error('This upload does not belong to your account.');
    return existing.status;
  }

  const post = createPostInsertPayload({
    id: job.postId,
    author_id: job.ownerId,
    caption: job.caption,
    hashtags: job.hashtags,
    video_path: `${job.ownerId}/${job.postId}.${getVideoExtension(job.fileName, job.contentType)}`,
    thumb_path: null,
    duration_ms: job.durationMs,
    width: job.width,
    height: job.height,
    audience: job.audience,
    allow_comments: job.allowComments,
    auto_captions: job.autoCaptions,
    scheduled_at: job.scheduledAt ?? null,
  });
  const { error } = await client.from('posts').insert(post);
  if (error) throw error;
  return 'uploading';
}

function isExpiredUploadError(error: unknown) {
  if (!(error instanceof Error) || !('originalResponse' in error)) return false;
  const response = error.originalResponse;
  if (!response || typeof response !== 'object' || !('getStatus' in response)) return false;
  return typeof response.getStatus === 'function' && [404, 410].includes(response.getStatus());
}

function startTusUpload(
  job: VideoUploadJob,
  onProgress: (progress: number, uploadUrl: string | null) => Promise<void> | void,
): Promise<void> {
  const client = getSupabaseClient();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return Promise.reject(new Error('Set EXPO_PUBLIC_SUPABASE_ANON_KEY before uploading videos.'));
  const extension = getVideoExtension(job.fileName, job.contentType);
  const objectName = `${job.ownerId}/${job.postId}.${extension}`;
  const fingerprint = `wimpex-post:${job.ownerId}:${job.postId}`;
  const tusUrlKey = `${tusKey}${fingerprint}`;
  let file: Blob;

  const uploadAttempt = (allowResume: boolean): Promise<void> => new Promise((resolve, reject) => {
    let settled = false;
    let resumedPreviousUpload = false;
    let retryingExpiredUpload = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      if (allowResume && resumedPreviousUpload && !retryingExpiredUpload && isExpiredUploadError(error)) {
        retryingExpiredUpload = true;
        void removeItem(tusUrlKey).then(() => uploadAttempt(false)).then(finish, fail);
        return;
      }
      settled = true;
      reject(error);
    };
    const upload = new Upload(file, {
      endpoint: getStorageEndpoint(),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      fingerprint: async () => fingerprint,
      urlStorage: createTusUrlStorage(),
      headers: {
        apikey: anonKey,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: 'videos',
        objectName,
        contentType: job.contentType,
        cacheControl: '3600',
      },
      onBeforeRequest: async (request) => {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error('Sign in again to continue uploading this video.');
        request.setHeader('authorization', `Bearer ${data.session.access_token}`);
      },
      onUploadUrlAvailable: () => {
        void Promise.resolve(onProgress(job.progress, upload.url)).catch((error: unknown) => {
          void upload.abort().then(() => fail(error), fail);
        });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        void Promise.resolve(onProgress(bytesTotal > 0 ? bytesUploaded / bytesTotal : 0, upload.url)).catch((error: unknown) => {
          void upload.abort().then(() => fail(error), fail);
        });
      },
      onError: fail,
      onSuccess: finish,
    });

    void upload.findPreviousUploads().then((previousUploads) => {
      if (allowResume && previousUploads.length > 0) {
        resumedPreviousUpload = true;
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    }).catch(fail);
  });

  return import('expo-file-system').then(({ File }) => {
    file = new File(job.uri);
    return uploadAttempt(true);
  });
}

async function performUpload(job: VideoUploadJob): Promise<void> {
  const uploading = { ...job, state: 'uploading' as const, error: null };
  let uploadStage = 'prepare the upload';
  try {
    await saveJob(uploading);
    uploadStage = 'create the post record';
    const postStatus = await upsertPostRecord(uploading);
    if (postStatus !== 'published' && postStatus !== 'scheduled') {
      uploadStage = 'upload the video file';
      await startTusUpload(uploading, async (progress, uploadUrl) => {
        const current = jobs.get(uploading.id) ?? uploading;
        await saveJob({ ...current, progress, uploadUrl }, false);
      });
      uploadStage = 'publish the post';
      const { error } = await getSupabaseClient().rpc('finalize_post', { post_id: uploading.postId });
      if (error) throw error;
      requestPendingModeration('post');
    }
    uploadStage = 'clean up the local upload';
    const { File: LocalFile } = await import('expo-file-system');
    const localFile = new LocalFile(uploading.uri);
    if (localFile.exists) localFile.delete();
    try {
      await removeUploadedPostDraft(uploading.ownerId, uploading.uri);
    } catch (draftCleanupError) {
      console.error('Unable to remove the saved draft record after its video was posted.', draftCleanupError);
    }
    await removeItem(`${jobsKey}${uploading.id}`);
    jobs.delete(uploading.id);
    publishJobs();
  } catch (error) {
    console.error(`Video upload failed while attempting to ${uploadStage}.`, error);
    try {
      const { error: statusError } = await getSupabaseClient()
        .rpc('fail_post_upload', { p_post_id: uploading.postId });
      if (statusError) throw statusError;
    } catch (statusError) {
      console.error('Unable to mark a failed video upload.', statusError);
    }
    const current = jobs.get(uploading.id) ?? uploading;
    await saveJob({
      ...current,
      state: 'failed',
      error: await getErrorMessage(error, `The video upload failed while attempting to ${uploadStage}. Try again.`),
    });
    throw error;
  }
}

export async function loadUploadJobs(ownerId: string): Promise<VideoUploadJob[]> {
  await hydrateJobs();
  return [...jobs.values()].filter((job) => job.ownerId === ownerId);
}

function isSavedPostDraft(value: unknown): value is SavedPostDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.ownerId === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && isVideoDraft(record.video);
}

async function readPostDrafts(): Promise<SavedPostDraft[]> {
  const saved = await getItem(draftsKey);
  if (!saved) return [];
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(isSavedPostDraft)) {
      throw new Error('The saved post drafts have an invalid shape.');
    }
    return sortPostDrafts(parsed);
  } catch (error) {
    console.error('Unable to read saved post drafts.', error);
    throw new Error('The saved post drafts could not be read. Try again or discard them from this device.');
  }
}

function persistPostDrafts(drafts: SavedPostDraft[]): Promise<void> {
  const write = draftWriteQueue.then(() => setItem(draftsKey, JSON.stringify(sortPostDrafts(drafts))));
  draftWriteQueue = write.catch(() => undefined);
  return write;
}

async function removeUploadedPostDraft(ownerId: string, videoUri: string): Promise<void> {
  const drafts = await readPostDrafts();
  const remaining = cleanupUploadedPostDraft(drafts, ownerId, videoUri);
  if (remaining.length !== drafts.length) await persistPostDrafts(remaining);
}

export async function loadPostDrafts(ownerId: string): Promise<SavedPostDraft[]> {
  let drafts = await readPostDrafts();
  const legacy = await getItem(draftKey);
  if (legacy) {
    const parsed: unknown = JSON.parse(legacy);
    if (!isVideoDraft(parsed)) throw new Error('The saved video draft has an invalid shape.');
    if (parsed.uri || parsed.caption.trim()) {
      const alreadyListed = parsed.uri && drafts.some((draft) => draft.video.uri === parsed.uri);
      if (!alreadyListed) {
        const timestamp = new Date().toISOString();
        drafts = sortPostDrafts([
          ...drafts,
          createPostDraft(`legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`, ownerId, parsed, timestamp),
        ]);
      }
    }
    await persistPostDrafts(drafts);
    await removeItem(draftKey);
  }
  return sortPostDrafts(drafts.filter((draft) => draft.ownerId === ownerId));
}

export async function savePostDraft(
  id: string,
  ownerId: string,
  video: VideoDraft,
): Promise<SavedPostDraft> {
  await loadPostDrafts(ownerId);
  const drafts = await readPostDrafts();
  const current = restorePostDraft(drafts, id);
  if (current && current.ownerId !== ownerId) {
    throw new Error('This draft belongs to a different account.');
  }
  const timestamp = new Date().toISOString();
  const saved = current
    ? updatePostDraft(current, video, timestamp)
    : createPostDraft(id, ownerId, video, timestamp);
  await persistPostDrafts(current
    ? drafts.map((draft) => draft.id === id ? saved : draft)
    : [...drafts, saved]);
  return saved;
}

export async function deletePostDraft(id: string, ownerId: string): Promise<SavedPostDraft | null> {
  const drafts = await readPostDrafts();
  const current = restorePostDraft(drafts, id);
  if (!current) return null;
  if (current.ownerId !== ownerId) throw new Error('This draft belongs to a different account.');
  const result = cleanupPostDraft(drafts, id);
  await persistPostDrafts(result.drafts);
  return result.removed;
}

export function subscribeToUploadJobs(listener: UploadListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueueVideoUpload(job: VideoUploadJob): Promise<void> {
  await hydrateJobs();
  try {
    await saveJob(job);
  } catch (error) {
    jobs.delete(job.id);
    publishJobs();
    throw error;
  }
  return resumeVideoUpload(job.id);
}

export async function resumeVideoUpload(jobId: string): Promise<void> {
  await hydrateJobs();
  const existing = activeUploads.get(jobId);
  if (existing) return existing;
  const job = jobs.get(jobId);
  if (!job) throw new Error('The saved upload could not be found.');
  const uploadPromise = performUpload(job).finally(() => activeUploads.delete(jobId));
  activeUploads.set(jobId, uploadPromise);
  return uploadPromise;
}

export async function removeUploadJob(jobId: string): Promise<void> {
  await hydrateJobs();
  const job = jobs.get(jobId);
  if (!job) return;
  if (activeUploads.has(jobId)) throw new Error('Wait for the current upload to finish before removing it.');
  const client = getSupabaseClient();
  const { data: post, error: postReadError } = await client
    .from('posts')
    .select('status')
    .eq('id', job.postId)
    .eq('author_id', job.ownerId)
    .maybeSingle();
  if (postReadError) throw postReadError;
  if (post?.status !== 'published') {
    const extension = getVideoExtension(job.fileName, job.contentType);
    const objectPath = `${job.ownerId}/${job.postId}.${extension}`;
    const { error: storageError } = await client.storage.from('videos').remove([objectPath]);
    if (storageError) throw storageError;
    const { error: postError } = await client
      .from('posts')
      .delete()
      .eq('id', job.postId)
      .eq('author_id', job.ownerId);
    if (postError) throw postError;
  }
  const { File: LocalFile } = await import('expo-file-system');
  const localFile = new LocalFile(job.uri);
  if (localFile.exists) localFile.delete();
  await removeItem(`${jobsKey}${jobId}`);
  await removeItem(`${tusKey}wimpex-post:${job.ownerId}:${job.postId}`);
  jobs.delete(jobId);
  publishJobs();
}

export async function clearLocalUploadData(ownerId: string): Promise<void> {
  await hydrateJobs();
  const ownedJobs = [...jobs.values()].filter((job) => job.ownerId === ownerId);
  assertNoActiveVideoUploads(ownerId);

  const { File: LocalFile } = await import('expo-file-system');
  for (const job of ownedJobs) {
    const localFile = new LocalFile(job.uri);
    if (localFile.exists) localFile.delete();
    await removeItem(`${jobsKey}${job.id}`);
    await removeItem(`${tusKey}wimpex-post:${job.ownerId}:${job.postId}`);
    jobs.delete(job.id);
    progressWriteAt.delete(job.id);
  }
  await removeItem(draftKey);
  publishJobs();
}

export function assertNoActiveVideoUploads(ownerId: string): void {
  if ([...jobs.values()].some((job) => job.ownerId === ownerId && activeUploads.has(job.id))) {
    throw new Error('Wait for active video uploads to finish before deleting this account.');
  }
}
