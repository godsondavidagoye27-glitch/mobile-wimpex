import { MediaUnavailableOnWeb } from '../media/MediaUnavailableOnWeb';

export default function LiveStreamScreen() {
  return (
    <MediaUnavailableOnWeb
      title="Live video isn't available in the browser"
      message="Open Wimpex on your phone to watch or host a live stream."
    />
  );
}
