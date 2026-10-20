import type {
  ExploreCreatorRpcRow,
  ExploreSuggestedAccountRpcRow,
} from '../../types/database';

export function isExploreProfileEligible(profile: {
  isPrivate: boolean;
  isMinor: boolean;
  isBlocked: boolean;
}) {
  return !profile.isPrivate && !profile.isMinor && !profile.isBlocked;
}

export function rankExploreCreators(rows: ExploreCreatorRpcRow[]) {
  return [...rows]
    .filter((row) => isExploreProfileEligible({
      isPrivate: row.is_private,
      isMinor: false,
      isBlocked: false,
    }))
    .sort((left, right) => (
      right.popularity_score - left.popularity_score
      || left.username.localeCompare(right.username)
      || left.id.localeCompare(right.id)
    ));
}

export function rankSuggestedAccounts(rows: ExploreSuggestedAccountRpcRow[]) {
  return [...rows]
    .filter((row) => isExploreProfileEligible({
      isPrivate: row.is_private,
      isMinor: false,
      isBlocked: false,
    }))
    .sort((left, right) => (
      right.mutual_follows - left.mutual_follows
      || right.shared_interests - left.shared_interests
      || right.followers_count - left.followers_count
      || left.username.localeCompare(right.username)
      || left.id.localeCompare(right.id)
    ));
}
