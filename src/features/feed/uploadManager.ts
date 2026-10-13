import { Storage } from 'expo-sqlite/kv-store';
import { File as LocalFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { Upload } from 'tus-js-client';
import { getSupabaseClient } from '../../lib/supabase';
import type { Post } from '../../types/database';

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
};

type UploadListener = (jobs: VideoUploadJob[]) => void;
type StoredTusUpload = NonNullable<Parameters<Upload['resumeFromPreviousUpload']>[0]>;

const jobsKey = 'wimpex:feed:upload-job:';
const tusKey = 'wimpex:feed:tus:';
const draftKey = 'wimpex:feed:create-post-draft';
const listeners = new Set<UploadListener>();
const activeUploads = new Map<string, Promise<void>>();
const jobs = new Map<string, VideoUploadJob>();
const progressWriteAt = new Map<string, number>();
let hydrated = false;
let hydration: Promise<void> | null = null;

function getAllKeys(): Promise<string[]> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      Array.from({ length: globalThis.localStorage.length }, (_, index) => globalThis.localStorage.key(index))
        .filter((key): key is string => key !== null),
    );
  }
  return Storage.getAllKeys();
}

function getItem(key: string): Promise<string | null> {
  return Platform.OS === 'web'
    ? Promise.resolve(globalThis.localStorage.getItem(key))
    : Storage.getItem(key);
}

function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(key, value);
    return Promise.resolve();
  }
  return Storage.setItem(key, value);
}

function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return Storage.removeItem(key);
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
        const storedJobs = await Promise.all(
          keys.filter((key) => key.startsWith(jobsKey)).map(async (key) => {
            const value = await getItem(key);
            return value ? JSON.parse(value) as VideoUploadJob : null;
          }),
        );
        storedJobs.forEach((job) => {
          if (job) jobs.set(job.id, job);
        });
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
      const stored = await Promise.all(
        keys.filter((key) => key.startsWith(tusKey)).map(async (key) => {
          const value = await getItem(key);
          if (!value) return null;
          const upload = JSON.parse(value) as StoredTusUpload;
          return { ...upload, urlStorageKey: key };
        }),
      );
      return stored.filter((upload): upload is StoredTusUpload => upload !== null);
    },
    async findUploadsByFingerprint(fingerprint: string): Promise<StoredTusUpload[]> {
      const upload = await getItem(`${tusKey}${fingerprint}`);
      return upload ? [{ ...JSON.parse(upload) as StoredTusUpload, urlStorageKey: `${tusKey}${fingerprint}` }] : [];
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

  const post: Post = {
    id: job.postId,
    author_id: job.ownerId,
    caption: job.caption,
    hashtags: job.hashtags,
    video_path: `${job.ownerId}/${job.postId}.${job.fileName.split('.').at(-1)?.toLowerCase() === 'mov' ? 'mov' : 'mp4'}`,
    thumb_path: null,
    captions_path: null,
    duration_ms: job.durationMs,
    width: job.width,
    height: job.height,
    audience: job.audience,
    allow_comments: job.allowComments,
    auto_captions: job.autoCaptions,
    status: 'uploading',
    like_count: 0,
    comment_count: 0,
    save_count: 0,
    share_count: 0,
    view_count: 0,
    is_demo: false,
    created_at: new Date().toISOString(),
    published_at: null,
  };
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
  const extension = job.fileName.split('.').at(-1)?.toLowerCase() === 'mov' ? 'mov' : 'mp4';
  const objectName = `${job.ownerId}/${job.postId}.${extension}`;
  const fingerprint = `wimpex-post:${job.ownerId}:${job.postId}`;
  const tusUrlKey = `${tusKey}${fingerprint}`;

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
    const upload = new Upload(new LocalFile(job.uri), {
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

  return uploadAttempt(true);
}

async function performUpload(job: VideoUploadJob): Promise<void> {
  const uploading = { ...job, state: 'uploading' as const, error: null };
  try {
    await saveJob(uploading);
    const postStatus = await upsertPostRecord(uploading);
    if (postStatus !== 'published') {
      await startTusUpload(uploading, async (progress, uploadUrl) => {
        const current = jobs.get(uploading.id) ?? uploading;
        await saveJob({ ...current, progress, uploadUrl }, false);
      });
      const { error } = await getSupabaseClient().rpc('finalize_post', { post_id: uploading.postId });
      if (error) throw error;
    }
    const localFile = new LocalFile(uploading.uri);
    if (localFile.exists) localFile.delete();
    await removeItem(`${jobsKey}${uploading.id}`);
    jobs.delete(uploading.id);
    publishJobs();
  } catch (error) {
    const current = jobs.get(uploading.id) ?? uploading;
    await saveJob({
      ...current,
      state: 'failed',
      error: error instanceof Error ? error.message : 'The video upload failed. Try again.',
    });
    throw error;
  }
}

export async function loadUploadJobs(ownerId: string): Promise<VideoUploadJob[]> {
  await hydrateJobs();
  return [...jobs.values()].filter((job) => job.ownerId === ownerId);
}

export async function loadVideoDraft(): Promise<VideoDraft | null> {
  const saved = await getItem(draftKey);
  return saved ? JSON.parse(saved) as VideoDraft : null;
}

export function saveVideoDraft(draft: VideoDraft): Promise<void> {
  return setItem(draftKey, JSON.stringify(draft));
}

export function clearVideoDraft(): Promise<void> {
  return removeItem(draftKey);
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
    const extension = job.fileName.split('.').at(-1)?.toLowerCase() === 'mov' ? 'mov' : 'mp4';
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
  const localFile = new LocalFile(job.uri);
  if (localFile.exists) localFile.delete();
  await removeItem(`${jobsKey}${jobId}`);
  await removeItem(`${tusKey}wimpex-post:${job.ownerId}:${job.postId}`);
  jobs.delete(jobId);
  publishJobs();
}
