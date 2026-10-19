import type { Post } from '../../types/database';

export const POST_INSERT_COLUMNS = [
  'id',
  'author_id',
  'caption',
  'hashtags',
  'video_path',
  'thumb_path',
  'duration_ms',
  'width',
  'height',
  'audience',
  'allow_comments',
  'auto_captions',
] as const satisfies readonly (keyof Post)[];

export type PostInsertPayload = Pick<Post, (typeof POST_INSERT_COLUMNS)[number]>;

export function createPostInsertPayload(
  input: PostInsertPayload,
): PostInsertPayload {
  return {
    id: input.id,
    author_id: input.author_id,
    caption: input.caption,
    hashtags: input.hashtags,
    video_path: input.video_path,
    thumb_path: input.thumb_path,
    duration_ms: input.duration_ms,
    width: input.width,
    height: input.height,
    audience: input.audience,
    allow_comments: input.allow_comments,
    auto_captions: input.auto_captions,
  };
}
