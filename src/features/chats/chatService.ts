import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import type { MessageRow } from './messageState';

type Client = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ConversationRow = Database['public']['Tables']['conversations']['Row'];
type MemberRow = Database['public']['Tables']['conversation_members']['Row'];

export type ChatProfile = Pick<
  ProfileRow,
  'id' | 'username' | 'display_name' | 'avatar_url' | 'is_official' | 'date_of_birth'
>;

export type ChatListEntry = {
  conversation: ConversationRow;
  membership: MemberRow;
  members: MemberRow[];
  peer: ChatProfile | null;
  lastMessage: Pick<MessageRow, 'id' | 'sender_id' | 'kind' | 'body' | 'created_at' | 'deleted_at'> | null;
};

export async function fetchChatList(client: Client, userId: string): Promise<ChatListEntry[]> {
  const { data: memberships, error: membershipError } = await client
    .from('conversation_members')
    .select('*')
    .eq('user_id', userId)
    .is('left_at', null);
  if (membershipError) throw membershipError;
  if (!memberships.length) return [];

  const conversationIds = memberships.map((membership) => membership.conversation_id);
  const { data: conversations, error: conversationError } = await client
    .from('conversations')
    .select('*')
    .in('id', conversationIds);
  if (conversationError) throw conversationError;

  const { data: members, error: membersError } = await client
    .from('conversation_members')
    .select('*')
    .in('conversation_id', conversationIds)
    .is('left_at', null);
  if (membersError) throw membersError;

  const profileIds = Array.from(new Set(members.map((member) => member.user_id)));
  const { data: profiles, error: profilesError } = await client
    .from('profiles')
    .select('id,username,display_name,avatar_url,is_official,date_of_birth')
    .in('id', profileIds);
  if (profilesError) throw profilesError;

  const latestMessageIds = conversations
    .map((conversation) => conversation.last_message_id)
    .filter((messageId): messageId is string => messageId !== null);
  const { data: messages, error: messagesError } = latestMessageIds.length
    ? await client
        .from('messages')
        .select('id,sender_id,kind,body,created_at,deleted_at')
        .in('id', latestMessageIds)
    : { data: [], error: null };
  if (messagesError) throw messagesError;

  return memberships
    .flatMap((membership) => {
      const conversation = conversations.find((item) => item.id === membership.conversation_id);
      if (!conversation) return [];
      const conversationMembers = members.filter((member) => member.conversation_id === conversation.id);
      const peerMember = conversationMembers.find((member) => member.user_id !== userId);
      const peer = peerMember ? profiles.find((profile) => profile.id === peerMember.user_id) ?? null : null;
      const lastMessage = messages.find((message) => message.id === conversation.last_message_id) ?? null;
      return [{
        conversation,
        membership,
        members: conversationMembers,
        peer,
        lastMessage,
      }];
    })
    .sort((first, second) => {
      const firstAt = first.conversation.last_message_at ?? first.conversation.created_at;
      const secondAt = second.conversation.last_message_at ?? second.conversation.created_at;
      return secondAt.localeCompare(firstAt);
    });
}

export async function searchChatProfiles(
  client: Client,
  currentUserId: string,
  searchTerm: string,
): Promise<ChatProfile[]> {
  let query = client
    .from('profiles')
    .select('id,username,display_name,avatar_url,is_official,date_of_birth')
    .neq('id', currentUserId)
    .order('username')
    .limit(30);
  const normalized = searchTerm.trim();
  if (normalized) {
    query = query.or(
      `username.ilike.${normalized.replace(/[,%()]/g, '')}%,display_name.ilike.%${normalized.replace(/[,%()]/g, '')}%`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function fetchConversationMessages(
  client: Client,
  conversationId: string,
  before?: Pick<MessageRow, 'created_at' | 'id'>,
  pageSize = 30,
): Promise<MessageRow[]> {
  let query = client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize);
  if (before) {
    query = query.or(
      `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
