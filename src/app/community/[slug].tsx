import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Icon } from '../../components/Icon';
import {
  canBanCommunityMember,
  canChangeCommunityRole,
  canDeleteCommunity,
  canLeaveCommunity,
  canTransferCommunityOwnership,
} from '../../features/communities/communityPermissions';
import { getSupabaseClient } from '../../lib/supabase';
import {
  getCommunityMessages,
  getCommunityPostReports,
  getCommunityPosts,
  moderateCommunityPost,
  reportCommunityPost,
  resolveCommunityPostReport,
  sendCommunityMessage,
  type CommunityPost,
} from '../../features/communities/communityContentService';
import { theme } from '../../theme/theme';
import type {
  CommunityMessageRpcRow,
  CommunityPostReportRpcRow,
  CommunityDetailRpcRow,
  CommunityMemberRpcRow,
  SearchPersonRpcRow,
} from '../../types/database';

type CommunityTab = 'Posts' | 'About' | 'Members' | 'Chat';
type MemberCursor = { joinedAt: string; id: string; status: CommunityMemberRpcRow['status'] };
const pageSize = 20;
const communityTabs: CommunityTab[] = ['Posts', 'About', 'Members', 'Chat'];

function CommunityPostVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
  });
  return <VideoView player={player} style={styles.communityPostMedia} nativeControls />;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'Try again.';
}

export default function CommunityScreen() {
  const params = useLocalSearchParams<{ slug?: string; tab?: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug ?? '';
  const requestedTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const [community, setCommunity] = useState<CommunityDetailRpcRow | null>(null);
  const [activeTab, setActiveTab] = useState<CommunityTab>(
    communityTabs.includes(requestedTab as CommunityTab) ? requestedTab as CommunityTab : 'Posts',
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [members, setMembers] = useState<CommunityMemberRpcRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const membersLoadingRef = useRef(false);
  const [membersMore, setMembersMore] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<CommunityMemberRpcRow | null>(null);
  const [communityActionsOpen, setCommunityActionsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<SearchPersonRpcRow[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<CommunityMessageRpcRow[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [communityReports, setCommunityReports] = useState<CommunityPostReportRpcRow[]>([]);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const membersController = useRef<AbortController | null>(null);
  const inviteController = useRef<AbortController | null>(null);
  const memberCursor = useRef<MemberCursor | null>(null);
  const membershipStatus = community?.status ?? null;
  const communityId = community?.id;
  const isActiveMember = membershipStatus === 'active';
  const isPrivateLocked = !!community && community.visibility === 'private' && !isActiveMember;
  const rules = useMemo(() => (
    Array.isArray(community?.rules)
      ? community.rules.filter((rule): rule is string => typeof rule === 'string')
      : []
  ), [community]);
  const visibleMembers = useMemo(() => members.filter((member) => member.status === 'active'), [members]);
  const requests = useMemo(() => members.filter((member) => member.status === 'pending'), [members]);
  const bannedMembers = useMemo(() => members.filter((member) => member.status === 'banned'), [members]);

  const loadCommunity = useCallback(async (isRefresh = false) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setError('');
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const { data, error: rpcError } = await getSupabaseClient()
        .rpc('get_community', { p_slug: slug })
        .abortSignal(controller.signal);
      if (rpcError) throw rpcError;
      if (!controller.signal.aborted) setCommunity(data?.[0] ?? null);
    } catch (caught) {
      if (!controller.signal.aborted) setError(readableError(caught));
    } finally {
      if (detailController.current === controller) {
        detailController.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [slug]);

  const loadPosts = useCallback(async () => {
    if (!communityId) return;
    setPostsLoading(true);
    setPostsError('');
    try {
      setCommunityPosts(await getCommunityPosts(communityId));
    } catch (caught) {
      setPostsError(readableError(caught));
    } finally {
      setPostsLoading(false);
    }
  }, [communityId]);

  const loadChat = useCallback(async () => {
    if (!communityId || !isActiveMember) return;
    setChatLoading(true);
    setChatError('');
    try {
      setChatMessages(await getCommunityMessages(communityId));
    } catch (caught) {
      setChatError(readableError(caught));
    } finally {
      setChatLoading(false);
    }
  }, [communityId, isActiveMember]);

  useEffect(() => {
    const timer = setTimeout(() => void loadCommunity(), 0);
    return () => {
      clearTimeout(timer);
      detailController.current?.abort();
    };
  }, [loadCommunity, retryToken]);

  useEffect(() => {
    if (!communityId || isPrivateLocked) return undefined;
    const initialLoadTimer = setTimeout(() => {
      if (activeTab === 'Posts') void loadPosts();
      if (activeTab === 'Chat' && isActiveMember) void loadChat();
    }, 0);

    const channel = getSupabaseClient()
      .channel(`community-content:${communityId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'community_posts',
        filter: `community_id=eq.${communityId}`,
      }, () => {
        if (activeTab === 'Posts') void loadPosts();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'community_messages',
        filter: `community_id=eq.${communityId}`,
      }, () => {
        if (activeTab === 'Chat' && isActiveMember) void loadChat();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'community_members',
        filter: `community_id=eq.${communityId}`,
      }, () => {
        void loadCommunity(true);
      })
      .subscribe();
    return () => {
      clearTimeout(initialLoadTimer);
      void getSupabaseClient().removeChannel(channel);
    };
  }, [activeTab, communityId, isActiveMember, isPrivateLocked, loadChat, loadCommunity, loadPosts]);

  useEffect(() => {
    const timer = setTimeout(() => setMemberQuery(memberInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [memberInput]);

  const loadMembers = useCallback(async (append = false) => {
    if (!community || membersLoadingRef.current) return;
    membersController.current?.abort();
    const controller = new AbortController();
    membersController.current = controller;
    membersLoadingRef.current = true;
    setMembersLoading(true);
    setMembersError('');
    const cursor = append ? memberCursor.current : null;
    if (!append) {
      setMembers([]);
      memberCursor.current = null;
    }
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc('get_community_members', {
        p_slug: community.slug,
        p_query: memberQuery,
        p_cursor_status: cursor?.status ?? null,
        p_cursor_joined_at: cursor?.joinedAt ?? null,
        p_cursor_user_id: cursor?.id ?? null,
        p_page_size: pageSize,
      }).abortSignal(controller.signal);
      if (rpcError) throw rpcError;
      if (controller.signal.aborted) return;
      const page = data ?? [];
      setMembers((current) => append
        ? [...current, ...page.filter((item) => !current.some((old) => old.id === item.id))]
        : page);
      const last = page.at(-1);
      memberCursor.current = last ? { joinedAt: last.joined_at, id: last.id, status: last.status } : null;
      setMembersMore(page.length === pageSize);
    } catch (caught) {
      if (!controller.signal.aborted) setMembersError(readableError(caught));
    } finally {
      if (membersController.current === controller) {
        membersController.current = null;
        membersLoadingRef.current = false;
        setMembersLoading(false);
      }
    }
  }, [community, memberQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'Members' && !isPrivateLocked) void loadMembers(false);
    }, 0);
    return () => {
      clearTimeout(timer);
      membersController.current?.abort();
      membersLoadingRef.current = false;
    };
  }, [activeTab, community?.id, isPrivateLocked, loadMembers]);

  useEffect(() => {
    if (!inviteOpen || inviteQuery.length < 2 || !community) {
      const timer = setTimeout(() => {
        setInviteResults([]);
        setInviteLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      inviteController.current?.abort();
      const controller = new AbortController();
      inviteController.current = controller;
      setInviteLoading(true);
      setInviteError('');
      void Promise.resolve(getSupabaseClient().rpc('community_invite_candidates', {
        p_community_id: community.id,
        p_query: inviteQuery,
        p_page_size: 20,
      }).abortSignal(controller.signal)).then(({ data, error: rpcError }) => {
        if (rpcError) throw rpcError;
        if (!controller.signal.aborted) setInviteResults(data ?? []);
      }).catch((caught: unknown) => {
        if (!controller.signal.aborted) setInviteError(readableError(caught));
      }).finally(() => {
        if (inviteController.current === controller) {
          inviteController.current = null;
          setInviteLoading(false);
        }
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      inviteController.current?.abort();
    };
  }, [community, inviteOpen, inviteQuery]);

  const reload = async () => {
    membersController.current?.abort();
    membersLoadingRef.current = false;
    setMembersLoading(false);
    await loadCommunity(true);
    if (activeTab === 'Members') await loadMembers(false);
  };

  const updateMembership = async () => {
    if (!community || membershipBusy) return;
    setMembershipBusy(true);
    try {
      if (membershipStatus === 'pending') {
        const { error: rpcError } = await getSupabaseClient().rpc('cancel_join_request', {
          p_community_id: community.id,
        });
        if (rpcError) throw rpcError;
      } else if (membershipStatus === 'invited') {
        const { error: rpcError } = await getSupabaseClient().rpc('respond_invite', {
          p_community_id: community.id,
          p_accept: true,
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: rpcError } = await getSupabaseClient().rpc('join_community', {
          p_community_id: community.id,
        });
        if (rpcError) throw rpcError;
      }
      await reload();
    } catch (caught) {
      Alert.alert('Could not update membership', readableError(caught));
    } finally {
      setMembershipBusy(false);
    }
  };

  const callMemberAction = async (
    rpc: 'respond_join_request' | 'unban_member' | 'set_member_role' | 'ban_member' | 'transfer_ownership',
    member: CommunityMemberRpcRow,
    accept?: boolean,
    role?: 'moderator' | 'member',
  ) => {
    if (!community) return;
    try {
      let rpcError;
      if (rpc === 'respond_join_request') {
        ({ error: rpcError } = await getSupabaseClient().rpc(rpc, {
          p_community_id: community.id,
          p_user_id: member.id,
          p_accept: !!accept,
        }));
      } else if (rpc === 'set_member_role') {
        ({ error: rpcError } = await getSupabaseClient().rpc(rpc, {
          p_community_id: community.id,
          p_user_id: member.id,
          p_role: role ?? 'member',
        }));
      } else if (rpc === 'transfer_ownership') {
        ({ error: rpcError } = await getSupabaseClient().rpc(rpc, {
          p_community_id: community.id,
          p_new_owner: member.id,
        }));
      } else {
        ({ error: rpcError } = await getSupabaseClient().rpc(rpc, {
          p_community_id: community.id,
          p_user_id: member.id,
        }));
      }
      if (rpcError) throw rpcError;
      setSelectedMember(null);
      await reload();
    } catch (caught) {
      Alert.alert('Could not update member', readableError(caught));
    }
  };

  const confirmBan = (member: CommunityMemberRpcRow) => {
    Alert.alert('Ban member', `Ban ${member.display_name} from this community?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Ban', style: 'destructive', onPress: () => void callMemberAction('ban_member', member) },
    ]);
  };

  const confirmTransfer = (member: CommunityMemberRpcRow) => {
    Alert.alert(
      'Transfer ownership',
      `Make ${member.display_name} the owner of this community?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Transfer', onPress: () => void callMemberAction('transfer_ownership', member) },
      ],
    );
  };

  const leaveCommunity = () => {
    if (!community) return;
    Alert.alert(
      'Leave community',
      'You will no longer see posts or chat from this community.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            void Promise.resolve(getSupabaseClient().rpc('leave_community', { p_community_id: community.id })).then(({ error: rpcError }) => {
              if (rpcError) throw rpcError;
              void reload();
            }).catch((caught: unknown) => Alert.alert('Could not leave community', readableError(caught)));
          },
        },
      ],
    );
  };

  const deleteCommunity = () => {
    if (!community) return;
    Alert.alert('Delete community', 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void Promise.resolve(getSupabaseClient().rpc('delete_community', { p_community_id: community.id })).then(({ error: rpcError }) => {
            if (rpcError) throw rpcError;
            router.replace('/(tabs)/groups');
          }).catch((caught: unknown) => Alert.alert('Could not delete community', readableError(caught)));
        },
      },
    ]);
  };

  const acceptRequest = (member: CommunityMemberRpcRow, accept: boolean) => {
    void callMemberAction('respond_join_request', member, accept);
  };

  const inviteMember = async (person: SearchPersonRpcRow) => {
    if (!community) return;
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('invite_member', {
        p_community_id: community.id,
        p_user_id: person.id,
      });
      if (rpcError) throw rpcError;
      setInviteResults((current) => current.filter((result) => result.id !== person.id));
      Alert.alert('Invite sent', `${person.display_name} was invited to ${community.name}.`);
    } catch (caught) {
      Alert.alert('Could not invite this person', readableError(caught));
    }
  };

  const showMemberActions = (member: CommunityMemberRpcRow) => {
    if (!community?.can_moderate) return;
    setSelectedMember(member);
  };

  const openEdit = () => router.push({ pathname: '/community/edit/[slug]', params: { slug: community?.slug ?? slug } });

  const renderMember = ({ item }: { item: CommunityMemberRpcRow }) => {
    const canAct = community?.can_moderate
      && (item.status === 'active'
        ? canChangeCommunityRole(community.role, item.role)
          || canBanCommunityMember(community.role, item.role)
          || canTransferCommunityOwnership(community.role, item.role)
        : item.status === 'pending' || item.status === 'banned');
    const avatarUrl = item.avatar_url;
    return (
      <View style={styles.memberRow}>
        <Pressable
          onPress={() => router.push({ pathname: '/user/[username]', params: { username: item.username } })}
          style={styles.memberProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.display_name}'s profile`}
        >
          <View style={styles.memberAvatar}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.memberAvatarImage} />
              : <Text style={styles.memberInitials}>{initials(item.display_name)}</Text>}
          </View>
          <View style={styles.memberMeta}>
            <Text numberOfLines={1} style={styles.memberName}>{item.display_name}</Text>
            <Text style={styles.memberSub}>@{item.username} · {item.role}</Text>
          </View>
        </Pressable>
        {item.status === 'pending' && community?.can_moderate ? (
          <View style={styles.requestActions}>
            <Pressable onPress={() => acceptRequest(item, true)} style={styles.acceptButton} accessibilityRole="button">
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
            <Pressable onPress={() => acceptRequest(item, false)} style={styles.declineButton} accessibilityRole="button">
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
          </View>
        ) : item.status === 'banned' && community?.can_moderate ? (
          <Pressable onPress={() => void callMemberAction('unban_member', item)} style={styles.acceptButton} accessibilityRole="button">
            <Text style={styles.acceptText}>Unban</Text>
          </Pressable>
        ) : canAct ? (
          <Pressable onPress={() => showMemberActions(item)} style={styles.memberAction} accessibilityRole="button" accessibilityLabel={`Manage ${item.display_name}`}>
            <Icon name="more" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const memberListHeader = (
    <View>
      {community?.can_moderate || isActiveMember ? (
        <>
          {community?.can_moderate ? (
            <>
              <View style={styles.memberSectionHeading}>
                <Text style={styles.sectionHeading}>Requests</Text>
              </View>
              {requests.map((item) => (
                <View key={`request-${item.id}`}>{renderMember({ item })}</View>
              ))}
              <View style={styles.memberSectionHeading}>
                <Text style={styles.sectionHeading}>Banned</Text>
              </View>
              {bannedMembers.map((item) => (
                <View key={`banned-${item.id}`}>{renderMember({ item })}</View>
              ))}
            </>
          ) : null}
          <View style={styles.memberSectionHeading}>
            <Text style={styles.sectionHeading}>Members</Text>
            <Pressable onPress={() => setInviteOpen(true)} accessibilityRole="button" accessibilityLabel="Invite member">
              <Icon name="plus" size={20} color={theme.colors.primary} />
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.memberSectionHeading}>
          <Text style={styles.sectionHeading}>Members</Text>
        </View>
      )}
      <View style={styles.memberSearch}>
        <Icon name="search" size={20} color={theme.colors.textMuted} />
        <TextInput
          value={memberInput}
          onChangeText={setMemberInput}
          placeholder="Search members"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.memberSearchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {memberInput ? (
          <Pressable onPress={() => setMemberInput('')} accessibilityRole="button" accessibilityLabel="Clear member search">
            <Icon name="close" size={20} color={theme.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {memberInput.trim() !== memberQuery && memberInput.trim() ? <ActivityIndicator color={theme.colors.primary} style={styles.inlineLoader} /> : null}
      {membersError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Members could not be loaded.</Text>
          <Pressable onPress={() => void loadMembers(false)}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : null}
    </View>
  );

  const renderInviteCandidate = (person: SearchPersonRpcRow) => (
    <View style={styles.memberRow}>
      <View style={styles.memberProfile}>
        <View style={styles.memberAvatar}>
          {person.avatar_url
            ? <Image source={{ uri: person.avatar_url }} style={styles.memberAvatarImage} />
            : <Text style={styles.memberInitials}>{initials(person.display_name)}</Text>}
        </View>
        <View style={styles.memberMeta}>
          <Text numberOfLines={1} style={styles.memberName}>{person.display_name}</Text>
          <Text style={styles.memberSub}>@{person.username}</Text>
        </View>
      </View>
      <Pressable onPress={() => void inviteMember(person)} style={styles.acceptButton}>
        <Text style={styles.acceptText}>Invite</Text>
      </Pressable>
    </View>
  );

  const sendMessage = async () => {
    const body = chatDraft.trim();
    if (!body || !community || chatSending) return;
    setChatSending(true);
    setChatError('');
    try {
      await sendCommunityMessage(community.id, body);
      setChatDraft('');
      await loadChat();
    } catch (caught) {
      setChatError(readableError(caught));
    } finally {
      setChatSending(false);
    }
  };

  const moderatePost = async (post: CommunityPost, action: 'remove' | 'pin') => {
    try {
      await moderateCommunityPost(post.id, action);
      await loadPosts();
    } catch (caught) {
      Alert.alert('Could not moderate post', readableError(caught));
    }
  };

  const reportPost = (post: CommunityPost) => {
    Alert.alert('Report post', 'Choose the reason that best describes the issue.', [
      ...(['spam', 'harassment', 'hate', 'sexual_content', 'violence', 'other'] as const).map((reason) => ({
        text: reason.replace('_', ' '),
        onPress: () => {
          void reportCommunityPost(post.id, reason)
            .then(() => Alert.alert('Report received', 'A community moderator will review this post.'))
            .catch((caught: unknown) => Alert.alert('Could not report post', readableError(caught)));
        },
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const showPostActions = (post: CommunityPost) => {
    if (!community?.can_moderate) {
      reportPost(post);
      return;
    }
    Alert.alert('Post moderation', undefined, [
      {
        text: post.pinned_at ? 'Unpin post' : 'Pin post',
        onPress: () => void moderatePost(post, 'pin'),
      },
      {
        text: 'Remove post',
        style: 'destructive',
        onPress: () => Alert.alert('Remove post?', 'This post will no longer be visible to community members.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void moderatePost(post, 'remove') },
        ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openReports = async () => {
    if (!community) return;
    setCommunityActionsOpen(false);
    setReportsLoading(true);
    try {
      setCommunityReports(await getCommunityPostReports(community.id));
      setReportsOpen(true);
    } catch (caught) {
      Alert.alert('Could not load reports', readableError(caught));
    } finally {
      setReportsLoading(false);
    }
  };

  const resolveReport = async (report: CommunityPostReportRpcRow) => {
    try {
      await resolveCommunityPostReport(report.id);
      setCommunityReports((current) => current.filter((item) => item.id !== report.id));
    } catch (caught) {
      Alert.alert('Could not resolve report', readableError(caught));
    }
  };

  const renderCommunityPost = ({ item }: { item: CommunityPost }) => (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.memberAvatar}>
          {item.avatar_url
            ? <Image source={{ uri: item.avatar_url }} style={styles.memberAvatarImage} />
            : <Text style={styles.memberInitials}>{initials(item.display_name)}</Text>}
        </View>
        <View style={styles.postMetaWrap}>
          <Text style={styles.memberName}>{item.display_name}</Text>
          <Text style={styles.memberSub}>@{item.username} · {new Date(item.created_at).toLocaleString()}</Text>
        </View>
        {item.pinned_at ? <Icon name="pin" size={20} color={theme.colors.primary} /> : null}
        <Pressable onPress={() => showPostActions(item)} accessibilityRole="button" accessibilityLabel="Post options">
          <Icon name={community?.can_moderate ? 'more' : 'flag'} size={20} color={theme.colors.textMuted} />
        </Pressable>
      </View>
      {item.body ? <Text style={styles.postBody}>{item.body}</Text> : null}
      {item.media_url && item.media_kind === 'image'
        ? <Image source={{ uri: item.media_url }} style={styles.communityPostMedia} resizeMode="cover" />
        : item.media_url && item.media_kind === 'video'
          ? <CommunityPostVideo uri={item.media_url} />
          : null}
    </View>
  );

  const renderTabContent = () => {
    if (!community) return null;
    if (activeTab === 'Posts') {
      return (
        <View style={styles.postsLayout}>
          {isActiveMember ? (
            <Pressable
              onPress={() => router.push({ pathname: '/community/create-post', params: { slug: community.slug } })}
              style={styles.createPostButton}
              accessibilityRole="button"
              accessibilityLabel="Create community post"
            >
              <Icon name="plus" size={20} color={theme.colors.primary} />
              <Text style={styles.createPostLabel}>Share an update</Text>
            </Pressable>
          ) : <Text style={styles.joinPrompt}>Join this community to create a post.</Text>}
          {postsError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Posts could not be loaded.</Text>
              <Pressable onPress={() => void loadPosts()}><Text style={styles.retryText}>Retry</Text></Pressable>
            </View>
          ) : null}
          <FlatList
            data={communityPosts}
            renderItem={renderCommunityPost}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.postsList}
            ListEmptyComponent={!postsLoading && !postsError ? <Text style={styles.emptyText}>No posts yet.</Text> : null}
            ListFooterComponent={postsLoading ? <ActivityIndicator color={theme.colors.primary} style={styles.inlineLoader} /> : null}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPosts()} tintColor={theme.colors.primary} />}
            showsVerticalScrollIndicator={false}
          />
        </View>
      );
    }
    if (activeTab === 'About') {
      return (
        <View style={styles.aboutContent}>
          <Text style={styles.aboutDescription}>{community.description || 'No description.'}</Text>
          <Text style={styles.aboutLabel}>Category</Text>
          <Text style={styles.aboutText}>{community.category}</Text>
          <Text style={styles.aboutLabel}>Rules</Text>
          {rules.length
            ? rules.map((rule, index) => <Text key={`${index}-${rule}`} style={styles.ruleText}>{index + 1}. {rule}</Text>)
            : <Text style={styles.aboutText}>No rules added.</Text>}
          <Text style={styles.aboutLabel}>Created</Text>
          <Text style={styles.aboutText}>{new Date(community.created_at).toLocaleDateString()}</Text>
          {community.owner_username ? (
            <>
              <Text style={styles.aboutLabel}>Owner</Text>
              <Pressable
                onPress={() => router.push({ pathname: '/user/[username]', params: { username: community.owner_username ?? '' } })}
                accessibilityRole="button"
              >
                <Text style={styles.ownerLink}>{community.owner_display_name} · @{community.owner_username}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      );
    }
    if (activeTab === 'Chat') {
      if (!isActiveMember) {
        return (
          <Text style={styles.emptyText}>Join this community to chat.</Text>
        );
      }
      return (
        <View style={styles.chatWrap}>
          <View style={styles.chatHeader}>
            <Text style={styles.sectionHeading}>Community chat</Text>
            <Text style={styles.chatPeople}>{chatMessages.length} messages</Text>
          </View>
          {chatError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Community chat could not be loaded or sent.</Text>
              <Pressable onPress={() => void loadChat()}><Text style={styles.retryText}>Retry</Text></Pressable>
            </View>
          ) : null}
          {chatLoading
            ? <ActivityIndicator color={theme.colors.primary} style={styles.inlineLoader} />
            : <FlatList
                data={chatMessages}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.chatMessages}
                ListEmptyComponent={<Text style={styles.emptyText}>No messages yet. Start the conversation.</Text>}
                renderItem={({ item }) => (
                  <View style={[styles.chatBubble, item.is_mine ? styles.chatBubbleMine : styles.chatBubbleOther]}>
                    <Text style={styles.chatAuthor}>{item.is_mine ? 'You' : item.display_name}</Text>
                    <Text style={styles.chatBody}>{item.body}</Text>
                    <Text style={styles.chatTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                  </View>
                )}
                showsVerticalScrollIndicator={false}
              />}
          <View style={styles.chatComposer}>
            <TextInput
              value={chatDraft}
              onChangeText={setChatDraft}
              placeholder="Message the community"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.chatInput}
              autoCapitalize="sentences"
              maxLength={1000}
            />
            <Pressable
              onPress={() => void sendMessage()}
              disabled={chatSending || !chatDraft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send community chat message"
            >
              {chatSending
                ? <ActivityIndicator size="small" color={theme.colors.primary} />
                : <Icon name="send" size={20} color={theme.colors.primary} />}
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <FlatList
        data={visibleMembers}
        keyExtractor={(item) => item.id}
        renderItem={renderMember}
        ListHeaderComponent={memberListHeader}
        ListEmptyComponent={!membersLoading && !membersError
          ? <Text style={styles.emptyText}>{memberQuery ? 'No members found.' : 'No members yet.'}</Text>
          : null}
        ListFooterComponent={membersLoading
          ? <ActivityIndicator color={theme.colors.primary} style={styles.inlineLoader} />
          : membersMore
            ? <Pressable onPress={() => void loadMembers(true)} style={styles.loadMore}>
                <Text style={styles.retryText}>Load more</Text>
              </Pressable>
            : null}
        onEndReached={() => {
          if (membersMore && !membersLoading) void loadMembers(true);
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={theme.colors.primary} />}
        contentContainerStyle={styles.memberList}
      />
    );
  };

  const leaveAllowed = canLeaveCommunity(community?.role);
  const deleteAllowed = canDeleteCommunity(community?.role);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={20} color={theme.colors.white} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>{community?.name ?? 'Community'}</Text>
        {community?.can_moderate || isActiveMember ? (
          <Pressable onPress={() => setCommunityActionsOpen(true)} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Community options">
            <Icon name="more" size={20} color={theme.colors.white} />
          </Pressable>
        ) : <View style={styles.headerButton} />}
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.colors.primary} />
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonBlock} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>Community could not be loaded. Check your connection and try again.</Text>
          <Pressable onPress={() => setRetryToken((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      ) : !community ? (
        <View style={styles.centerState}><Text style={styles.emptyText}>Community not found.</Text></View>
      ) : (
        <>
          <View style={styles.communityHero}>
            <View style={styles.heroIcon}>
              {community.icon_path
                ? <Image
                    source={{ uri: getSupabaseClient().storage.from('community-icons').getPublicUrl(community.icon_path).data.publicUrl }}
                    style={styles.heroImage}
                  />
                : <Text style={styles.heroInitials}>{initials(community.name)}</Text>}
            </View>
            <View style={styles.heroDetails}>
              <View style={styles.heroNameLine}>
                <Text numberOfLines={1} style={styles.heroName}>{community.name}</Text>
                {community.visibility === 'private' ? <Icon name="lock" size={20} color={theme.colors.textMuted} /> : null}
              </View>
              <Text style={styles.heroMeta}>{community.member_count.toLocaleString()} members · {community.category}</Text>
            </View>
            <Pressable
              onPress={() => void updateMembership()}
              disabled={membershipBusy || membershipStatus === 'active' && community.role === 'owner'}
              style={[
                styles.joinButton,
                membershipStatus === 'active' && styles.joinedButton,
                membershipStatus === 'pending' && styles.requestedButton,
              ]}
            >
              {membershipBusy
                ? <ActivityIndicator size="small" color={theme.colors.primary} />
                : <Text style={[styles.joinText, membershipStatus === 'active' && styles.joinedText]}>
                    {membershipStatus === 'active' ? 'Joined'
                      : membershipStatus === 'pending' ? 'Requested'
                        : membershipStatus === 'invited' ? 'Accept invite'
                          : community.visibility === 'private' ? 'Request to join' : 'Join'}
                  </Text>}
            </Pressable>
          </View>

          {isPrivateLocked ? (
            <View style={styles.privateState}>
              <Icon name="lock" size={24} color={theme.colors.textMuted} />
              <Text style={styles.privateTitle}>This community is private</Text>
              <Text style={styles.privateText}>Request to join to see posts.</Text>
            </View>
          ) : (
            <>
              <View style={styles.tabs}>
                {communityTabs.map((tab) => (
                  <Pressable key={tab} onPress={() => setActiveTab(tab)} style={styles.tabButton}>
                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                    {activeTab === tab ? <View style={styles.tabUnderline} /> : null}
                  </Pressable>
                ))}
              </View>
              {renderTabContent()}
            </>
          )}
        </>
      )}

      <Modal visible={!!selectedMember} transparent animationType="fade" onRequestClose={() => setSelectedMember(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedMember(null)}>
          <View style={styles.actionSheet}>
            <Text style={styles.modalTitle}>{selectedMember?.display_name}</Text>
            {selectedMember && canChangeCommunityRole(community?.role, selectedMember.role) ? (
              <Pressable style={styles.modalAction} onPress={() => void callMemberAction(
                'set_member_role',
                selectedMember,
                undefined,
                selectedMember.role === 'moderator' ? 'member' : 'moderator',
              )}>
                <Text style={styles.modalActionText}>{selectedMember.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</Text>
              </Pressable>
            ) : null}
            {selectedMember && canBanCommunityMember(community?.role, selectedMember.role) ? (
              <Pressable style={styles.modalAction} onPress={() => confirmBan(selectedMember)}>
                <Text style={styles.modalDangerText}>Ban</Text>
              </Pressable>
            ) : null}
            {selectedMember && canTransferCommunityOwnership(community?.role, selectedMember.role) ? (
              <Pressable style={styles.modalAction} onPress={() => confirmTransfer(selectedMember)}>
                <Text style={styles.modalActionText}>Transfer ownership</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.modalAction} onPress={() => setSelectedMember(null)}>
              <Text style={styles.modalActionText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={communityActionsOpen} transparent animationType="fade" onRequestClose={() => setCommunityActionsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCommunityActionsOpen(false)}>
          <View style={styles.actionSheet}>
            <Text style={styles.modalTitle}>{community?.name}</Text>
            {community?.can_moderate ? (
              <>
                <Pressable style={styles.modalAction} onPress={() => {
                  setCommunityActionsOpen(false);
                  openEdit();
                }}>
                  <Text style={styles.modalActionText}>Edit community</Text>
                </Pressable>
                <Pressable style={styles.modalAction} onPress={() => void openReports()}>
                  <Text style={styles.modalActionText}>{reportsLoading ? 'Loading reports…' : 'Review post reports'}</Text>
                </Pressable>
              </>
            ) : null}
            {leaveAllowed ? (
              <Pressable style={styles.modalAction} onPress={() => {
                setCommunityActionsOpen(false);
                leaveCommunity();
              }}>
                <Text style={styles.modalActionText}>Leave community</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.modalAction} onPress={() => {
              setCommunityActionsOpen(false);
              Alert.alert('Report sent', 'Thanks for flagging this community. The moderation team will review it.');
            }}>
              <Text style={styles.modalActionText}>Report community</Text>
            </Pressable>
            {deleteAllowed ? (
              <Pressable style={styles.modalAction} onPress={() => {
                setCommunityActionsOpen(false);
                deleteCommunity();
              }}>
                <Text style={styles.modalDangerText}>Delete community</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.modalAction} onPress={() => setCommunityActionsOpen(false)}>
              <Text style={styles.modalActionText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={reportsOpen} transparent animationType="slide" onRequestClose={() => setReportsOpen(false)}>
        <View style={styles.inviteBackdrop}>
          <View style={styles.inviteSheet}>
            <View style={styles.inviteHeader}>
              <Text style={styles.modalTitle}>Open post reports</Text>
              <Pressable onPress={() => setReportsOpen(false)} accessibilityRole="button" accessibilityLabel="Close reports">
                <Icon name="close" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
            <FlatList
              data={communityReports}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.reportList}
              ListEmptyComponent={<Text style={styles.emptyText}>No open reports.</Text>}
              renderItem={({ item }) => (
                <View style={styles.reportCard}>
                  <Text style={styles.reportReason}>{item.reason.replace('_', ' ')}</Text>
                  <Text style={styles.memberSub}>Reported by @{item.reporter_username}</Text>
                  <Text style={styles.reportPostBody}>{item.post_body || 'Media post'}</Text>
                  {item.details ? <Text style={styles.reportDetails}>{item.details}</Text> : null}
                  <Pressable onPress={() => void resolveReport(item)} style={styles.resolveButton} accessibilityRole="button">
                    <Text style={styles.acceptText}>Resolve report</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.inviteBackdrop}>
          <View style={styles.inviteSheet}>
            <View style={styles.inviteHeader}>
              <Text style={styles.modalTitle}>Invite members</Text>
              <Pressable onPress={() => setInviteOpen(false)} accessibilityRole="button" accessibilityLabel="Close invite search">
                <Icon name="close" size={20} color={theme.colors.white} />
              </Pressable>
            </View>
            <View style={styles.memberSearch}>
              <Icon name="search" size={20} color={theme.colors.textMuted} />
              <TextInput
                value={inviteInput}
                onChangeText={setInviteInput}
                onSubmitEditing={() => setInviteQuery(inviteInput.trim())}
                placeholder="Search people"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.memberSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {inviteInput.trim().length > 0 && inviteInput.trim().length < 2
              ? <Text style={styles.emptyText}>Enter at least 2 characters.</Text>
              : inviteLoading
                ? <ActivityIndicator color={theme.colors.primary} style={styles.inlineLoader} />
                : inviteError
                  ? <Text style={styles.errorText}>{inviteError}</Text>
                  : inviteResults.length
                    ? <FlatList data={inviteResults} keyExtractor={(item) => item.id} renderItem={({ item }) => renderInviteCandidate(item)} />
                    : inviteQuery.length >= 2
                      ? <Text style={styles.emptyText}>No people found.</Text>
                      : <Text style={styles.emptyText}>Search by name or username.</Text>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.black },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  communityHero: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12 },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#16232A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImage: { width: 58, height: 58 },
  heroInitials: { color: theme.colors.primary, fontSize: 20, fontWeight: '800' },
  heroDetails: { flex: 1 },
  heroNameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroName: { color: theme.colors.white, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  heroMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  joinButton: { minWidth: 76, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 10, borderRadius: 14, backgroundColor: '#142A38' },
  joinedButton: { backgroundColor: 'rgba(34,197,94,0.12)' },
  requestedButton: { backgroundColor: theme.colors.surface },
  joinText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  joinedText: { color: theme.colors.success },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  tabButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: theme.colors.primary },
  tabUnderline: { position: 'absolute', bottom: 0, width: '66%', height: 2, borderRadius: 1, backgroundColor: theme.colors.primary },
  loadingState: { padding: 24, alignItems: 'center', gap: 18 },
  skeletonLine: { width: '45%', height: 18, borderRadius: 9, backgroundColor: theme.colors.surface },
  skeletonBlock: { width: '100%', height: 180, borderRadius: 18, backgroundColor: theme.colors.surface },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  privateState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  privateTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '700', marginTop: 8 },
  privateText: { color: theme.colors.textMuted, fontSize: 14, textAlign: 'center' },
  emptyText: { color: theme.colors.textMuted, textAlign: 'center', padding: 28, lineHeight: 22 },
  errorText: { color: '#F87171', textAlign: 'center', lineHeight: 21 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#142A38', marginTop: 14 },
  retryText: { color: theme.colors.primary, fontWeight: '700', textAlign: 'center' },
  aboutContent: { padding: 20 },
  aboutDescription: { color: theme.colors.white, fontSize: 15, lineHeight: 22, marginBottom: 18 },
  aboutLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  aboutText: { color: theme.colors.white, fontSize: 14, lineHeight: 21 },
  ruleText: { color: theme.colors.white, fontSize: 14, lineHeight: 22, marginTop: 8 },
  ownerLink: { color: theme.colors.primary, fontSize: 14, paddingVertical: 6 },
  memberList: { paddingHorizontal: 18, paddingBottom: 40, flexGrow: 1 },
  memberSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 6 },
  sectionHeading: { color: theme.colors.white, fontSize: 16, fontWeight: '700' },
  memberSearch: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: '#171C22', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.line, marginVertical: 10 },
  memberSearchInput: { color: theme.colors.white, fontSize: 14, paddingVertical: 0, flex: 1 },
  memberRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 8 },
  memberProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16232A', overflow: 'hidden' },
  memberAvatarImage: { width: 42, height: 42 },
  memberInitials: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  memberMeta: { flex: 1 },
  memberName: { color: theme.colors.white, fontSize: 14, fontWeight: '700' },
  memberSub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 3, textTransform: 'capitalize' },
  memberAction: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  requestActions: { flexDirection: 'row', gap: 6 },
  acceptButton: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#142A38', borderRadius: 10 },
  acceptText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  declineButton: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: theme.colors.surface, borderRadius: 10 },
  declineText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: '700' },
  inlineLoader: { paddingVertical: 16 },
  errorBox: { alignItems: 'center', paddingVertical: 10 },
  loadMore: { alignSelf: 'center', padding: 14 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  actionSheet: { padding: 18, paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#111418' },
  modalTitle: { color: theme.colors.white, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalAction: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  modalActionText: { color: theme.colors.white, fontSize: 15 },
  modalDangerText: { color: '#F87171', fontSize: 15 },
  inviteBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  inviteSheet: { height: '75%', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#111418', paddingHorizontal: 18, paddingTop: 18 },
  inviteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  postsLayout: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  postsList: { paddingBottom: 20, gap: 12, flexGrow: 1 },
  createPostButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#142A38', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  createPostLabel: { color: theme.colors.primary, fontWeight: '700' },
  joinPrompt: { color: theme.colors.textMuted, fontSize: 13, marginBottom: 12 },
  postCard: { backgroundColor: '#131A20', borderRadius: 16, borderWidth: 1, borderColor: theme.colors.line, padding: 14 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postMetaWrap: { flex: 1 },
  postBody: { color: theme.colors.white, fontSize: 14, lineHeight: 22, marginTop: 12 },
  communityPostMedia: { width: '100%', height: 260, backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 12 },
  reportList: { paddingBottom: 24, flexGrow: 1 },
  reportCard: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 6 },
  reportReason: { color: theme.colors.white, fontWeight: '800', fontSize: 14, textTransform: 'capitalize' },
  reportPostBody: { color: theme.colors.white, fontSize: 13, lineHeight: 19, marginTop: 6 },
  reportDetails: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  resolveButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#142A38', marginTop: 4 },
  chatMessages: { paddingBottom: 12, flexGrow: 1, justifyContent: 'flex-end' },
  chatWrap: { flex: 1, padding: 16 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  chatPeople: { color: theme.colors.textMuted, fontSize: 12 },
  chatBubble: { maxWidth: '80%', padding: 10, borderRadius: 14, marginBottom: 12 },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#142A38' },
  chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: '#171C22' },
  chatAuthor: { color: theme.colors.textMuted, fontSize: 11, marginBottom: 4 },
  chatBody: { color: theme.colors.white, fontSize: 14, lineHeight: 20 },
  chatTime: { color: theme.colors.textMuted, fontSize: 10, marginTop: 6, alignSelf: 'flex-end' },
  chatComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 12, marginTop: 8 },
  chatInput: { flex: 1, minHeight: 44, color: theme.colors.white, backgroundColor: '#171C22', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
