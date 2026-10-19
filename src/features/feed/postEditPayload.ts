import { extractHashtags } from './uploadValidation';

export type EditablePostFields = {
  caption: string;
  audience: 'everyone' | 'followers';
  allow_comments: boolean;
  auto_captions: boolean;
};

export function createPostEditPayload(fields: EditablePostFields) {
  return {
    caption: fields.caption.trim(),
    hashtags: extractHashtags(fields.caption),
    audience: fields.audience,
    allow_comments: fields.allow_comments,
    auto_captions: fields.auto_captions,
  };
}
