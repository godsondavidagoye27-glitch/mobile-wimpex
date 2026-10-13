import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database.ts';
import {
  assertProjectRefConfirmation,
  assertSeedAllowed,
  getProjectRef,
  readSeedEnvironment,
} from './guards.ts';

type SeedEnvironment = Record<string, string | undefined>;
type SeedClient = SupabaseClient<Database>;

const officialProfileId = 'f0a4c8b2-91d3-4a67-8b5c-1234567890ab';

async function confirmTarget(env: SeedEnvironment): Promise<string> {
  assertSeedAllowed(env.SEED_ALLOWED);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('.env.seed must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const projectRef = getProjectRef(env.SUPABASE_URL);
  console.log(`Target project URL: ${env.SUPABASE_URL}`);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const typedRef = await prompt.question(`Type project ref "${projectRef}" to delete demo data: `);
    assertProjectRefConfirmation(typedRef, projectRef);
  } finally {
    prompt.close();
  }
  return projectRef;
}

async function run() {
  const envPath = `${process.cwd()}/.env.seed`;
  if (!existsSync(envPath)) throw new Error('Create a local .env.seed file before running seed scripts.');
  const env = readSeedEnvironment(await readFile(envPath, 'utf8'));
  const projectRef = await confirmTarget(env);
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('.env.seed must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const client: SeedClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: demoProfiles, error: profilesError } = await client
    .from('profiles')
    .select('id,username')
    .eq('is_demo', true);
  if (profilesError) throw profilesError;
  const demoIds = demoProfiles.map((profile) => profile.id);

  let demoPosts: Array<{ video_path: string | null; thumb_path: string | null; captions_path: string | null }> = [];
  let accountMemberships: Array<{ conversation_id: string; user_id: string }> = [];
  if (demoIds.length) {
    const { data: posts, error: postsError } = await client
      .from('posts')
      .select('video_path,thumb_path,captions_path,is_demo')
      .in('author_id', demoIds);
    if (postsError) throw postsError;
    if (posts.some((post) => !post.is_demo)) {
      throw new Error('A demo account owns untagged posts; refusing to delete the account and its data.');
    }
    demoPosts = posts.filter((post) => post.is_demo);
    const { data: memberships, error: membershipsError } = await client
      .from('conversation_members')
      .select('conversation_id,user_id')
      .in('user_id', demoIds);
    if (membershipsError) throw membershipsError;
    accountMemberships = memberships;
  }

  const { data: seededMemberships, error: seededMembershipsError } = await client
    .from('conversation_members')
    .select('conversation_id')
    .eq('is_demo', true);
  if (seededMembershipsError) throw seededMembershipsError;
  const { data: seededConversations, error: seededConversationsError } = await client
    .from('conversations')
    .select('id,read_only,created_by')
    .eq('is_demo', true);
  if (seededConversationsError) throw seededConversationsError;

  const conversationIds = Array.from(new Set([
    ...accountMemberships.map((member) => member.conversation_id),
    ...seededMemberships.map((member) => member.conversation_id),
    ...seededConversations.map((conversation) => conversation.id),
  ]));
  let candidateConversations: Array<{ id: string; read_only: boolean; is_demo: boolean; created_by: string }> = [];
  if (conversationIds.length) {
    const { data: conversations, error: conversationsError } = await client
      .from('conversations')
      .select('id,read_only,is_demo,created_by')
      .in('id', conversationIds);
    if (conversationsError) throw conversationsError;
    candidateConversations = conversations;
  }
  const { error: reactionsError } = await client
    .from('message_reactions')
    .delete()
    .eq('is_demo', true);
  if (reactionsError) throw reactionsError;
  const { error: messagesError } = await client
    .from('messages')
    .delete()
    .eq('is_demo', true);
  if (messagesError) throw messagesError;
  const { error: membershipDeleteError } = await client
    .from('conversation_members')
    .delete()
    .eq('is_demo', true);
  if (membershipDeleteError) throw membershipDeleteError;

  if (conversationIds.length) {
    const { data: nonDemoMessages, error: nonDemoMessagesError } = await client
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', conversationIds)
      .eq('is_demo', false);
    if (nonDemoMessagesError) throw nonDemoMessagesError;
    const conversationsWithUserMessages = new Set(nonDemoMessages.map((message) => message.conversation_id));
    const { data: remainingMembers, error: remainingMembersError } = await client
      .from('conversation_members')
      .select('conversation_id,user_id')
      .in('conversation_id', conversationIds);
    if (remainingMembersError) throw remainingMembersError;
    const remainingByConversation = new Map<string, string[]>();
    for (const member of remainingMembers) {
      const users = remainingByConversation.get(member.conversation_id) ?? [];
      users.push(member.user_id);
      remainingByConversation.set(member.conversation_id, users);
    }
    const removableConversationIds = conversationIds.filter((conversationId) => {
      const members = remainingByConversation.get(conversationId) ?? [];
      const conversation = candidateConversations.find((item) => item.id === conversationId);
      const isWelcomeConversation = conversation?.read_only ?? false;
      if (isWelcomeConversation) {
        return members.every((id) => demoIds.includes(id) || id === officialProfileId);
      }
      return conversation?.is_demo === true
        && members.every((id) => id === conversation.created_by)
        && !conversationsWithUserMessages.has(conversationId);
    });
    if (removableConversationIds.length) {
      const { error: conversationError } = await client
        .from('conversations')
        .delete()
        .in('id', removableConversationIds);
      if (conversationError) throw conversationError;
    }
  }

  for (const bucket of ['videos', 'thumbnails', 'captions']) {
    const objectPaths = demoPosts
      .map((post) => bucket === 'videos'
        ? post.video_path
        : bucket === 'thumbnails'
          ? post.thumb_path
          : post.captions_path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0);
    if (!objectPaths.length) continue;
    const { error: storageError } = await client.storage.from(bucket).remove(objectPaths);
    if (storageError) throw storageError;
  }

  for (const profile of demoProfiles) {
    const { error: deleteError } = await client.auth.admin.deleteUser(profile.id);
    if (deleteError) throw deleteError;
  }
  console.log(`Removed ${demoProfiles.length} demo accounts and their tagged seed data from ${projectRef}.`);
}

run().catch((error) => {
  console.error('Demo cleanup failed.', error);
  process.exitCode = 1;
});
