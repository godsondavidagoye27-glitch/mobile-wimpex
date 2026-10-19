import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import type { MessageRow } from './messageState';
import type { ChatSearchArgs } from './chatSearch';

type Client = SupabaseClient<Database>;
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ConversationRow = Database['public']['Tables']['conversations']['Row'];
type MemberRow = Database['public']['Tables']['conversation_members']['Row'];
type ChatConversation = Pick<
  ConversationRow,
  'id' | 'type' | 'title' | 'last_message_id' | 'last_message_at' | 'created_at'
>;
type ChatMembership = Pick<MemberRow, 'conversation_id' | 'user_id' | 'unread_count'>;

export type ChatProfile = Pick<
  ProfileRow,
  'id' | 'username' | 'display_name' | 'avatar_url' | 'is_official' | 'date_of_birth'
>;

export type ChatListEntry = {
  conversation: ChatConversation;
  membership: ChatMembership;
  members: Pick<MemberRow, 'conversation_id' | 'user_id'>[];
  peer: ChatProfile | null;
  lastMessage: Pick<MessageRow, 'id' | 'sender_id' | 'kind' | 'body' | 'created_at' | 'deleted_at'> | null;
};

export async function fetchChatList(client: Client, userId: string): Promise<ChatListEntry[]> {
  const { data: memberships, error: membershipError } = await client
    .from('conversation_members')
    .select('conversation_id,user_id,unread_count')
    .eq('user_id', userId)
    .is('left_at', null);
  if (membershipError) throw membershipError;
  if (!memberships.length) return [];

  const conversationIds = memberships.map((membership) => membership.conversation_id);
  const { data: pendingRequests, error: requestError } = await client.from('message_requests')
    .select('conversation_id')
    .eq('recipient_id', userId)
    .eq('status', 'pending');
  if (requestError) throw requestError;
  const pendingRequestIds = new Set(pendingRequests.map((request) => request.conversation_id));
  const { data: conversations, error: conversationError } = await client
    .from('conversations')
    .select('id,type,title,last_message_id,last_message_at,created_at')
    .in('id', conversationIds);
  if (conversationError) throw conversationError;

  const { data: members, error: membersError } = await client
    .from('conversation_members')
    .select('conversation_id,user_id')
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
      if (!conversation || pendingRequestIds.has(conversation.id)) return [];
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

export async function fetchMyMessageRequests(client: Client) {
  const { data, error } = await client.rpc('get_my_message_requests');
  if (error) throw error;
  return data;
}

export async function respondToMessageRequest(client: Client, conversationId: string, accept: boolean) {
  const { error } = await client.rpc('respond_message_request', {
    p_conversation_id: conversationId,
    p_accept: accept,
  });
  if (error) throw error;
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
    .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,forwarded_from_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
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

export async function searchChatMessages(client: Client, args: ChatSearchArgs) {
  const { data, error } = await client.rpc('search_chat_messages', args);
  if (error) throw error;
  return data;
}

export async function fetchConversationPins(client: Client, conversationId: string) {
  const { data: pins, error: pinsError } = await client.from('conversation_pins')
    .select('conversation_id,message_id,pinned_by,pinned_at')
    .eq('conversation_id', conversationId)
    .order('pinned_at', { ascending: false })
    .limit(3);
  if (pinsError) throw pinsError;
  if (!pins.length) return [];
  const { data: messages, error: messagesError } = await client.from('messages')
    .select('id,conversation_id,sender_id,client_id,kind,body,media_path,media_duration_ms,width,height,reply_to_id,forwarded_from_id,story_reply_preview_path,story_reply_caption,created_at,deleted_at')
    .in('id', pins.map((pin) => pin.message_id));
  if (messagesError) throw messagesError;
  return pins.flatMap((pin) => {
    const message = messages.find((item) => item.id === pin.message_id);
    return message ? [{ ...pin, message }] : [];
  });
}

export async function setConversationPin(
  client: Client,
  conversationId: string,
  messageId: string,
  userId: string,
  pinned: boolean,
) {
  if (pinned) {
    const { error } = await client.from('conversation_pins').insert({
      conversation_id: conversationId,
      message_id: messageId,
      pinned_by: userId,
    });
    if (error) throw error;
  } else {
    const { error } = await client.from('conversation_pins')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('message_id', messageId);
    if (error) throw error;
  }
}

export async function forwardChatMessage(
  client: Client,
  message: MessageRow,
  conversationId: string,
  senderId: string,
  clientId: string,
  mediaCopyId: string,
) {
  if (message.kind === 'call' || message.kind === 'system') {
    throw new Error('This message type cannot be forwarded.');
  }
  let copiedPath: string | null = null;
  if (message.media_path) {
    const { data: media, error: downloadError } = await client.storage.from('chat-media').download(message.media_path);
    if (downloadError) throw downloadError;
    if (media.size <= 0 || media.size > 25 * 1024 * 1024) throw new Error('This attachment cannot be forwarded because it exceeds the chat media limit.');
    const originalExtension = message.media_path.split('.').at(-1)?.toLowerCase() ?? '';
    const mediaFormats: Record<string, { contentType: string; extension: string }> = {
      mp4: { contentType: 'video/mp4', extension: 'mp4' },
      mov: { contentType: 'video/quicktime', extension: 'mov' },
      jpg: { contentType: 'image/jpeg', extension: 'jpg' },
      jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
      png: { contentType: 'image/png', extension: 'png' },
      webp: { contentType: 'image/webp', extension: 'webp' },
      m4a: { contentType: 'audio/mp4', extension: 'm4a' },
      mp3: { contentType: 'audio/mpeg', extension: 'mp3' },
      aac: { contentType: 'audio/aac', extension: 'aac' },
      wav: { contentType: 'audio/wav', extension: 'wav' },
      webm: { contentType: 'audio/webm', extension: 'webm' },
    };
    const mediaFormat = mediaFormats[originalExtension];
    if (!mediaFormat || (media.type && media.type !== 'application/octet-stream' && media.type !== mediaFormat.contentType)) {
      throw new Error('This attachment format cannot be forwarded.');
    }
    copiedPath = `${senderId}/${mediaCopyId}.${mediaFormat.extension}`;
    const { error: uploadError } = await client.storage.from('chat-media').upload(copiedPath, media, {
      contentType: mediaFormat.contentType,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) throw uploadError;
  }
  const { data, error } = await client.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    client_id: clientId,
    kind: message.kind,
    body: message.body,
    media_path: copiedPath,
    media_duration_ms: message.media_duration_ms,
    width: message.width,
    height: message.height,
    forwarded_from_id: message.id,
  }).select('id').single();
  if (error) {
    if (copiedPath) {
      const { error: cleanupError } = await client.storage.from('chat-media').remove([copiedPath]);
      if (cleanupError) console.error('Could not remove a copied attachment after forwarding failed.', cleanupError);
    }
    throw error;
  }
  return data;
}
