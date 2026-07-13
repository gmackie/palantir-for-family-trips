import { OfflineBanner } from "~/components/offline-banner";
import { useOutboxSync } from "~/utils/use-outbox-sync";

/** Mount once at app root: auto-flush outboxes + global offline strip. */
export function OutboxSyncHost() {
  const { syncing, syncNow } = useOutboxSync();
  return <OfflineBanner onSync={() => void syncNow()} syncing={syncing} />;
}
