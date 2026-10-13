import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database.ts';
import {
  assertProjectRefConfirmation,
  assertSeedAllowed,
  getProjectRef,
  parseMeEmail,
  readSeedEnvironment,
} from './guards.ts';

type SeedAccount = {
  username: string;
  name: string;
  date_of_birth: string;
  bio: string;
  interests: string[];
  dm_policy?: 'everyone' | 'friends' | 'none';
};
type SeedEnvironment = Record<string, string | undefined>;
type SeedClient = SupabaseClient<Database>;
type SeedProfile = { id: string; email: string; username: string; display_name: string };
type MessageRow = { id: string; client_id: string; sender_id: string; created_at: string; body: string | null };
type DemoMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  kind: 'text';
  body: string;
  created_at: string;
};

const adults: SeedAccount[] = [
  { username: 'ada', name: 'Ada', date_of_birth: '1994-02-12', bio: 'Finding good coffee, good books and new places.', interests: ['coffee', 'books', 'travel'] },
  { username: 'tobi', name: 'Tobi', date_of_birth: '1992-08-17', bio: 'Weekend walks and trying recipes that mostly work.', interests: ['cooking', 'music', 'hiking'] },
  { username: 'zee', name: 'Zee', date_of_birth: '1996-04-05', bio: 'Here for small adventures and live music.', interests: ['music', 'travel', 'photography'] },
  { username: 'kemi', name: 'Kemi', date_of_birth: '1990-11-23', bio: 'Making time for friends, art and the outdoors.', interests: ['art', 'friends', 'hiking'] },
  { username: 'ife', name: 'Ife', date_of_birth: '1995-05-18', bio: 'Learning new things one day at a time.', interests: ['design', 'books', 'cooking'] },
  { username: 'sade', name: 'Sade', date_of_birth: '1991-07-09', bio: 'A quiet afternoon and a good playlist.', interests: ['music', 'reading', 'coffee'] },
  { username: 'dayo', name: 'Dayo', date_of_birth: '1988-03-30', bio: 'Usually planning the next day trip.', interests: ['travel', 'food', 'photography'], dm_policy: 'none' },
  { username: 'mira.run', name: 'Mira', date_of_birth: '1993-12-01', bio: 'Running routes, rainy playlists and brunch.', interests: ['running', 'music', 'food'] },
  { username: 'demo_teen', name: 'Demo Teen', date_of_birth: '2011-07-01', bio: 'A test fixture for age-based chat rules.', interests: ['music', 'games'], dm_policy: 'friends' },
];

const directMessageTexts = {
  ada: [
    'Hey, how has your week been?',
    'Pretty good, finally got out for a walk.',
    'That sounds nice. Where did you go?',
    'The river path near the old bridge.',
    'I have not been there in ages.',
    'It was quiet in the morning.',
    'We should go together sometime.',
    'Absolutely. Maybe Saturday?',
    'Saturday works for me.',
    'Great, I will check the weather.',
    'I can bring coffee if you like.',
    'That would be lovely.',
    'There is a small cafe by the entrance.',
    'Perfect, I know the one.',
    'Want to meet around ten?',
    'Ten is good. See you then.',
    'Looking forward to it.',
    'Me too. Have a good evening.',
    'You too, talk soon.',
    'Talk soon!',
  ],
  tobi: [
    'Did you try that new recipe?',
    'I did, and it was easier than expected.',
    'Was it as good as it looked?',
    'Better, actually. I added a little lemon.',
    'I will need the recipe.',
    'I will send it after work.',
    'Thanks, I have been meaning to cook more.',
    'It is a good one for a busy night.',
    'Any plans for the weekend?',
    'A market visit and then a quiet afternoon.',
    'That sounds like a solid plan.',
    'Would you like to come along?',
    'Sure, which market?',
    'The one by the station.',
    'I can meet you there at eleven.',
    'Great, I will bring a tote bag.',
    'I always forget mine.',
    'I have a spare one.',
    'Perfect, see you Saturday.',
    'See you there!',
  ],
};

const groupMessageTexts = [
  'Anyone free for a walk this weekend?',
  'I should be free on Saturday.',
  'Same here, what time were you thinking?',
  'Late morning would work for me.',
  'There is a nice trail near the river.',
  'That one has a good cafe at the start.',
  'I am in if the weather holds.',
  'I will check the forecast tomorrow.',
  'We could meet around ten thirty.',
  'That works for me.',
  'I can bring snacks for everyone.',
  'I will bring some fruit.',
  'This is coming together nicely.',
  'Should we share the location here?',
  'Yes, send it when you have a chance.',
  'I found the entrance on the map.',
  'Thanks, that makes it easy.',
  'Looking forward to seeing everyone.',
  'Same, it has been a while.',
  'See you Saturday!',
];

function stableUuid(value: string): string {
  const bytes = createHash('sha1').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function loadSeedFile(): Promise<SeedEnvironment> {
  const path = `${process.cwd()}/.env.seed`;
  if (!existsSync(path)) throw new Error('Create a local .env.seed file before running seed scripts.');
  return readFile(path, 'utf8').then((contents) => readSeedEnvironment(contents));
}

async function confirmTarget(env: SeedEnvironment): Promise<string> {
  assertSeedAllowed(env.SEED_ALLOWED);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.DEMO_PASSWORD) {
    throw new Error('.env.seed must define SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.');
  }
  const projectRef = getProjectRef(env.SUPABASE_URL);
  console.log(`Target project URL: ${env.SUPABASE_URL}`);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const typedRef = await prompt.question(`Type project ref "${projectRef}" to continue: `);
    assertProjectRefConfirmation(typedRef, projectRef);
  } finally {
    prompt.close();
  }
  return projectRef;
}

async function ensureUser(
  client: SeedClient,
  account: SeedAccount,
  password: string,
): Promise<{ id: string; email: string }> {
  const email = `demo.${account.username}@example.test`;
  const { data: existingUsers, error: listError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = existingUsers.users.find((user) => user.email === email);
  if (existing) {
    const { error: updateError } = await client.auth.admin.updateUserById(existing.id, {
      app_metadata: { is_demo: true },
    });
    if (updateError) throw updateError;
    return { id: existing.id, email };
  }

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { is_demo: true },
    user_metadata: { is_demo: true },
  });
  if (error) throw error;
  if (!data.user) throw new Error(`Could not create demo account ${account.username}.`);
  return { id: data.user.id, email };
}

async function ensureProfile(
  client: SeedClient,
  account: SeedAccount,
  user: { id: string; email: string },
): Promise<SeedProfile> {
  const profile = {
    id: user.id,
    username: account.username,
    display_name: account.name,
    date_of_birth: account.date_of_birth,
    bio: account.bio,
    is_private: false,
    dm_policy: account.dm_policy ?? 'everyone',
    is_demo: true,
    is_official: false,
  };
  const { data: existing, error: readError } = await client
    .from('profiles')
    .select('id')
    .eq('username', account.username)
    .maybeSingle();
  if (readError) throw readError;
  if (existing && existing.id !== user.id) {
    throw new Error(`Username ${account.username} already belongs to a different account.`);
  }
  const { error: profileError } = await client
    .from('profiles')
    .upsert(profile, { onConflict: 'username' });
  if (profileError) throw profileError;
  const interests = account.interests.map((interest) => ({ profile_id: user.id, interest }));
  const { error: interestError } = await client
    .from('profile_interests')
    .upsert(interests, { onConflict: 'profile_id,interest', ignoreDuplicates: true });
  if (interestError) throw interestError;
  return { ...user, username: account.username, display_name: account.name };
}

async function ensureDirectConversation(
  client: SeedClient,
  firstUserId: string,
  secondUserId: string,
): Promise<string> {
  const directKey = [firstUserId, secondUserId].sort().join(':');
  const { data, error } = await client
    .from('conversations')
    .upsert({
      type: 'direct',
      created_by: firstUserId,
      direct_key: directKey,
      read_only: false,
      is_demo: true,
    }, { onConflict: 'direct_key' })
    .select('id')
    .single();
  if (error) throw error;
  const { error: membersError } = await client
    .from('conversation_members')
    .upsert([
      { conversation_id: data.id, user_id: firstUserId, role: 'member', left_at: null, is_demo: false },
      { conversation_id: data.id, user_id: secondUserId, role: 'member', left_at: null, is_demo: true },
    ], { onConflict: 'conversation_id,user_id' });
  if (membersError) throw membersError;
  return data.id;
}

async function ensureGroup(
  client: SeedClient,
  creatorId: string,
  memberIds: string[],
): Promise<string> {
  const { data: existing, error: readError } = await client
    .from('conversations')
    .select('id')
    .eq('type', 'group')
    .eq('title', 'Weekend crew')
    .eq('created_by', creatorId)
    .maybeSingle();
  if (readError) throw readError;
  let conversationId = existing?.id;
  if (!conversationId) {
    const { data, error } = await client
      .from('conversations')
      .insert({ type: 'group', title: 'Weekend crew', created_by: creatorId, is_demo: true })
      .select('id')
      .single();
    if (error) throw error;
    conversationId = data.id;
  }
  const { error: membersError } = await client
    .from('conversation_members')
    .upsert(memberIds.map((id) => ({
      conversation_id: conversationId,
      user_id: id,
      role: id === creatorId ? 'owner' : 'member',
      left_at: null,
      is_demo: id !== creatorId,
    })), { onConflict: 'conversation_id,user_id' });
  if (membersError) throw membersError;
  return conversationId;
}

async function ensureMessages(
  client: SeedClient,
  conversationId: string,
  participantIds: string[],
  texts: string[],
  seedKey: string,
  realUserId: string | null = null,
): Promise<Array<MessageRow | undefined>> {
  const now = Date.now();
  const inputs: DemoMessage[] = texts.map((body, index) => {
    let senderId;
    if (realUserId) senderId = index % 2 === 0 ? participantIds[0] : realUserId;
    else senderId = participantIds[index % participantIds.length];
    const createdAt = new Date(now - (texts.length - index) * 6 * 60 * 60 * 1000).toISOString();
    return {
      id: stableUuid(`${seedKey}:message:${index}`),
      conversation_id: conversationId,
      sender_id: senderId,
      client_id: stableUuid(`${seedKey}:client:${index}`),
      kind: 'text',
      is_demo: true,
      body,
      created_at: createdAt,
    };
  });
  const { error: insertError } = await client
    .from('messages')
    .upsert(inputs, { onConflict: 'sender_id,client_id', ignoreDuplicates: true });
  if (insertError) throw insertError;
  const clientIds = inputs.map((message) => message.client_id);
  const { data: messages, error: messagesError } = await client
    .from('messages')
    .select('id,client_id,sender_id,created_at,body')
    .in('client_id', clientIds);
  if (messagesError) throw messagesError;
  const messageByClient = new Map<string, MessageRow>(messages.map((message) => [message.client_id, message]));

  if (realUserId) {
    const readThroughIndex = Math.max(0, texts.length - 5);
    const readMessage = messageByClient.get(inputs[readThroughIndex].client_id);
    if (readMessage) {
      const unreadCount = messages.filter((message) =>
        message.sender_id !== realUserId
        && message.created_at > readMessage.created_at,
      ).length;
      const { error: memberError } = await client
        .from('conversation_members')
        .update({ last_read_message_id: readMessage.id, unread_count: unreadCount })
        .eq('conversation_id', conversationId)
        .eq('user_id', realUserId);
      if (memberError) throw memberError;
    }
  }
  return inputs.map((input) => messageByClient.get(input.client_id));
}

async function ensureReactions(
  client: SeedClient,
  messageRows: Array<MessageRow | undefined>,
  actorIds: string[],
  seedKey: string,
) {
  const targets = [messageRows[3], messageRows[9], messageRows[15]]
    .filter((message): message is MessageRow => Boolean(message));
  const reactions = targets.map((message, index) => ({
    message_id: message.id,
    user_id: actorIds[index % actorIds.length],
    emoji: ['👍', '❤️', '😂'][index],
    is_demo: true,
  }));
  const { error } = await client
    .from('message_reactions')
    .upsert(reactions, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true });
  if (error) throw error;
  console.log(`Created or verified ${reactions.length} reactions for ${seedKey}.`);
}

async function uploadDemoPosts(
  client: SeedClient,
  url: string,
  serviceRoleKey: string,
  demoPassword: string,
  demoUsers: Map<string, SeedProfile>,
) {
  const assetDirectory = `${process.cwd()}/scripts/seed/assets`;
  if (!existsSync(assetDirectory)) {
    console.log('No .mp4 files found in scripts/seed/assets; demo posts were skipped.');
    return;
  }
  const assets = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
    .map((entry) => entry.name);
  if (!assets.length) {
    console.log('No .mp4 files found in scripts/seed/assets; demo posts were skipped.');
    return;
  }

  for (const username of ['ada', 'tobi', 'mira.run']) {
    const author = demoUsers.get(username);
    if (!author) throw new Error(`Missing seeded profile ${username} for demo video upload.`);
    const authenticatedClient = createClient<Database>(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await authenticatedClient.auth.signInWithPassword({
      email: author.email,
      password: demoPassword,
    });
    if (signInError) throw signInError;
    for (const asset of assets) {
      const file = new Uint8Array(await readFile(`${assetDirectory}/${asset}`));
      const postId = stableUuid(`demo-post:${username}:${asset}`);
      const objectPath = `${author.id}/${postId}.mp4`;
      const { error: postError } = await client.from('posts').upsert({
        id: postId,
        author_id: author.id,
        is_demo: true,
        caption: `A moment from ${username}`,
        video_path: objectPath,
        audience: 'everyone',
        allow_comments: true,
        auto_captions: true,
        status: 'uploading',
      }, { onConflict: 'id' });
      if (postError) throw postError;
      const { error: uploadError } = await client.storage.from('videos').upload(objectPath, file, {
        contentType: 'video/mp4',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      const { error: finalizeError } = await authenticatedClient.rpc('finalize_post', { post_id: postId });
      if (finalizeError) throw finalizeError;
      console.log(`Uploaded ${asset} for @${username}.`);
    }
  }
}

async function run() {
  const fileValues = await loadSeedFile();
  const env = fileValues;
  const projectRef = await confirmTarget(env);
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const demoPassword = env.DEMO_PASSWORD;
  if (!supabaseUrl || !serviceRoleKey || !demoPassword) {
    throw new Error('.env.seed must define SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD.');
  }
  const userEmail = parseMeEmail(process.argv.slice(2));
  const client = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const demoUsers = new Map<string, SeedProfile>();

  for (const account of adults) {
    const authUser = await ensureUser(client, account, demoPassword);
    const profile = await ensureProfile(client, account, authUser);
    demoUsers.set(account.username, profile);
  }

  let myProfile: { id: string; username: string } | null = null;
  if (userEmail) {
    const { data: users, error: usersError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    const account = users.users.find((user) => user.email?.toLowerCase() === userEmail);
    if (!account) throw new Error(`No Wimpex account was found for ${userEmail}.`);
    const { data, error } = await client
      .from('profiles')
      .select('id,username')
      .eq('id', account.id)
      .maybeSingle();
    if (error) throw error;
    myProfile = data;
  }
  if (userEmail && !myProfile) {
    throw new Error(`No Wimpex profile was found for ${userEmail}. Sign in and finish profile setup before seeding chats.`);
  }

  const accountIds: Record<string, string> = Object.fromEntries(
    Array.from(demoUsers.entries()).map(([username, user]) => [username, user.id]),
  );
  if (myProfile) {
    for (const username of ['ada', 'tobi', 'zee', 'kemi']) {
      const demoId = accountIds[username];
      const { error: followError } = await client.from('follows').upsert([
        { follower_id: myProfile.id, following_id: demoId, status: 'accepted' },
        { follower_id: demoId, following_id: myProfile.id, status: 'accepted' },
      ], { onConflict: 'follower_id,following_id' });
      if (followError) throw followError;
      const { error: acceptedError } = await client.from('follows')
        .update({ status: 'accepted' })
        .eq('follower_id', demoId)
        .eq('following_id', myProfile.id);
      if (acceptedError) throw acceptedError;
    }

    const messageTextsByUsername: Record<string, string[]> = directMessageTexts;
    for (const username of ['ada', 'tobi']) {
      const peerId = accountIds[username];
      const conversationId = await ensureDirectConversation(client, myProfile.id, peerId);
      const texts = messageTextsByUsername[username];
      const rows = await ensureMessages(
        client,
        conversationId,
        [peerId, myProfile.id],
        texts,
        `demo-direct:${username}:${myProfile.id}`,
        myProfile.id,
      );
      await ensureReactions(client, rows, [peerId, myProfile.id], `direct:${username}`);
    }

    const groupIds = [myProfile.id, accountIds.ada, accountIds.tobi, accountIds.kemi];
    const groupId = await ensureGroup(client, myProfile.id, groupIds);
    const groupRows = await ensureMessages(
      client,
      groupId,
      [accountIds.ada, accountIds.tobi, accountIds.kemi, myProfile.id],
      groupMessageTexts,
      `demo-group:${myProfile.id}`,
      myProfile.id,
    );
    await ensureReactions(client, groupRows, groupIds, 'group:weekend-crew');
    console.log(`Created demo chats for ${userEmail}.`);
  } else {
    console.warn('No --me email was provided. Profiles and welcome chats were seeded; personal demo conversations were skipped.');
  }

  await uploadDemoPosts(client, supabaseUrl, serviceRoleKey, demoPassword, demoUsers);
  console.log(`Demo seed completed for project ${projectRef}.`);
}

run().catch((error) => {
  console.error('Demo seed failed.', error);
  process.exitCode = 1;
});
