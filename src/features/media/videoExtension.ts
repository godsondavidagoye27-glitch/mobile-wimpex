export type VideoExtension = 'mov' | 'mp4';

export function getVideoExtension(fileName: string, mimeType?: string | null): VideoExtension {
  return mimeType === 'video/quicktime' || fileName.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
}
