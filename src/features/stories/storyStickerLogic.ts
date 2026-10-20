export type StoryPollVote = {
  voter_id: string;
  option_number: 1 | 2;
};

export type StoryPollResults = {
  optionOneCount: number;
  optionTwoCount: number;
  totalVotes: number;
  viewerOption: 1 | 2 | null;
};

export function validateStorySticker(sticker: {
  kind: 'poll' | 'question';
  prompt: string;
  optionOne: string;
  optionTwo: string;
}): string | null {
  if (!sticker.prompt.trim()) return 'Add a prompt to your sticker.';
  if (sticker.prompt.trim().length > 120) return 'Sticker prompts can be up to 120 characters.';
  if (sticker.kind === 'poll' && (!sticker.optionOne.trim() || !sticker.optionTwo.trim())) {
    return 'Add both choices to your poll.';
  }
  if (sticker.kind === 'poll' && (sticker.optionOne.trim().length > 40 || sticker.optionTwo.trim().length > 40)) {
    return 'Poll choices can be up to 40 characters each.';
  }
  return null;
}

export function recordPollVoteOnce(
  votes: StoryPollVote[],
  voterId: string,
  option: 1 | 2,
): StoryPollVote[] {
  if (votes.some((vote) => vote.voter_id === voterId)) return votes;
  return [...votes, { voter_id: voterId, option_number: option }];
}

export function aggregatePollVotes(votes: StoryPollVote[], viewerId: string): StoryPollResults {
  const uniqueVotes = new Map<string, StoryPollVote>();
  for (const vote of votes) {
    if (!uniqueVotes.has(vote.voter_id)) uniqueVotes.set(vote.voter_id, vote);
  }

  const distinctVotes = [...uniqueVotes.values()];
  return {
    optionOneCount: distinctVotes.filter((vote) => vote.option_number === 1).length,
    optionTwoCount: distinctVotes.filter((vote) => vote.option_number === 2).length,
    totalVotes: distinctVotes.length,
    viewerOption: uniqueVotes.get(viewerId)?.option_number ?? null,
  };
}

export function normalizedStickerPosition(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}
