import { SectionErrorBoundary } from '../../components/SectionErrorBoundary';
import LiveStreamScreen from '../../features/live/LiveStreamScreen';

export { RouteErrorFallback as ErrorBoundary } from '../../components/RouteErrorFallback';

export default function LiveStreamRoute() {
  return (
    <SectionErrorBoundary title="Live stream needs to restart">
      <LiveStreamScreen />
    </SectionErrorBoundary>
  );
}
