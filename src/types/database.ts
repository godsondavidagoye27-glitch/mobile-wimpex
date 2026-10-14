export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PostAuthor = {
  username: string;
  display_name: string;
  avatar_url: string | null;
};

export type FeedPost = {
  id: string;
  author_id: string;
  caption: string;
  hashtags: string[];
  video_path: string | null;
  thumb_path: string | null;
  captions_path: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  audience: 'everyone' | 'followers';
  allow_comments: boolean;
  auto_captions: boolean;
  status: 'uploading' | 'published' | 'failed';
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  view_count: number;
  pinned_at: string | null;
  is_demo: boolean;
  created_at: string;
  published_at: string | null;
};

export type FeedRpcRow = {
  post: FeedPost;
  author: PostAuthor;
  is_liked: boolean;
  is_saved: boolean;
  is_following: boolean;
};

export type ProfileRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  link: string | null;
  is_private: boolean;
  dm_policy: 'everyone' | 'friends' | 'none';
  followers_count: number;
  following_count: number;
  likes_received_count: number;
  username_changed_at: string | null;
  is_me: boolean;
  is_following: boolean;
  follow_status: 'none' | 'pending' | 'accepted';
  follows_me: boolean;
  is_blocked_by_me: boolean;
  has_blocked_me: boolean;
  can_view_posts: boolean;
  can_view_liked: boolean;
};

export type ProfileListRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_following: boolean;
  follow_status: 'none' | 'pending' | 'accepted';
  followed_at: string;
};

export type SearchPersonRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_private: boolean;
  followers_count: number;
  follow_status: 'none' | 'pending' | 'accepted';
};

export type SuggestedPersonRpcRow = Omit<SearchPersonRpcRow, 'follow_status'> & {
  mutual_follows: number;
  shared_interests: number;
};

export type SearchHashtagRpcRow = {
  tag: string;
  post_count: number;
};

export type FollowRequestRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  requested_at: string;
};

export type BlockedProfileRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  blocked_at: string;
};

export type NotificationType =
  | 'like' | 'comment' | 'reply' | 'follow' | 'follow_request' | 'live'
  | 'community_invite' | 'community_join_request' | 'community_request_approved';
export type CommunityCategory =
  | 'Music' | 'Food' | 'Sport' | 'Travel' | 'Gaming' | 'Art'
  | 'Tech' | 'Fashion' | 'Learning' | 'Health' | 'Comedy' | 'Other';
export type CommunityRole = 'owner' | 'moderator' | 'member';
export type CommunityMemberStatus = 'active' | 'pending' | 'invited' | 'banned';
export type CommunityVisibility = 'public' | 'private';
export type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: CommunityCategory;
  visibility: CommunityVisibility;
  is_adults_only: boolean;
  icon_path: string | null;
  member_count: number;
  post_count: number;
  role: CommunityRole | null;
  status: CommunityMemberStatus | null;
  interest_match: number;
};
export type CommunityDetailRpcRow = Omit<CommunityRow, 'interest_match'> & {
  description: string | null;
  rules: Json;
  owner_id: string | null;
  owner_username: string | null;
  owner_display_name: string | null;
  created_at: string;
  can_post: boolean;
  can_moderate: boolean;
  is_adults_only_hidden: boolean;
};
export type CommunityMemberRpcRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: CommunityRole;
  status: CommunityMemberStatus;
  joined_at: string;
};
export type CommunityListRpcRow = Omit<CommunityRow, 'interest_match'>;
export type CommunityPostRpcRow = {
  id: string;
  community_id: string;
  author_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  body: string;
  media_path: string | null;
  media_kind: 'image' | 'video' | null;
  pinned_at: string | null;
  created_at: string;
  is_mine: boolean;
};
export type CommunityMessageRpcRow = {
  id: string;
  community_id: string;
  author_id: string;
  username: string;
  display_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
};
export type CommunityPostReportRpcRow = {
  id: string;
  post_id: string;
  post_body: string;
  reporter_id: string;
  reporter_username: string;
  reason: string;
  details: string;
  created_at: string;
};

export type StoryRailRow = {
  author_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  story_count: number;
  has_unseen: boolean;
  is_close_friends_audience: boolean;
  latest_created_at: string | null;
  is_owner: boolean;
};

export type AuthorStoryRpcRow = {
  id: string;
  kind: 'image' | 'video';
  media_path: string;
  thumb_path: string | null;
  caption: string | null;
  caption_style: Json | null;
  audience: 'everyone' | 'followers' | 'close_friends';
  duration_ms: number;
  width: number;
  height: number;
  created_at: string;
  expires_at: string;
  has_viewed: boolean;
  view_count: number | null;
};

export type LiveStreamRpcRow = {
  stream_id: string;
  host_id: string;
  title: string;
  status: 'starting' | 'live' | 'ended';
  created_at: string;
  started_at: string;
  host_username: string;
  host_display_name: string;
  host_avatar_url: string | null;
};

export type LiveMessageRow = {
  id: string;
  stream_id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

type Relationships = [];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          link: string | null;
          date_of_birth: string;
          is_private: boolean;
          dm_policy: 'everyone' | 'friends' | 'none';
          is_demo: boolean;
          is_official: boolean;
          followers_count: number;
          following_count: number;
          likes_received_count: number;
          username_changed_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          link?: string | null;
          date_of_birth: string;
          is_private?: boolean;
          dm_policy?: 'everyone' | 'friends' | 'none';
          is_demo?: boolean;
          is_official?: boolean;
          followers_count?: number;
          following_count?: number;
          likes_received_count?: number;
          username_changed_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          link?: string | null;
          date_of_birth?: string;
          is_private?: boolean;
          dm_policy?: 'everyone' | 'friends' | 'none';
          is_demo?: boolean;
          is_official?: boolean;
          followers_count?: number;
          following_count?: number;
          likes_received_count?: number;
          username_changed_at?: string | null;
          created_at?: string | null;
        };
        Relationships: Relationships;
      };
      profile_interests: {
        Row: { profile_id: string; interest: string };
        Insert: { profile_id: string; interest: string };
        Update: { profile_id?: string; interest?: string };
        Relationships: Relationships;
      };
      stories: {
        Row: {
          id: string;
          author_id: string;
          kind: 'image' | 'video';
          media_path: string;
          thumb_path: string | null;
          caption: string | null;
          caption_style: Json | null;
          audience: 'everyone' | 'followers' | 'close_friends';
          duration_ms: number;
          width: number;
          height: number;
          created_at: string;
          expires_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          author_id: string;
          kind: 'image' | 'video';
          media_path: string;
          thumb_path?: string | null;
          caption?: string | null;
          caption_style?: Json | null;
          audience?: 'everyone' | 'followers' | 'close_friends';
          duration_ms: number;
          width: number;
          height: number;
          created_at?: string;
          expires_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          author_id?: string;
          kind?: 'image' | 'video';
          media_path?: string;
          thumb_path?: string | null;
          caption?: string | null;
          caption_style?: Json | null;
          audience?: 'everyone' | 'followers' | 'close_friends';
          duration_ms?: number;
          width?: number;
          height?: number;
          created_at?: string;
          expires_at?: string;
          deleted_at?: string | null;
        };
        Relationships: Relationships;
      };
      story_views: {
        Row: { story_id: string; viewer_id: string; viewed_at: string };
        Insert: { story_id: string; viewer_id: string; viewed_at?: string };
        Update: { story_id?: string; viewer_id?: string; viewed_at?: string };
        Relationships: Relationships;
      };
      close_friends: {
        Row: { owner_id: string; friend_id: string; created_at: string };
        Insert: { owner_id: string; friend_id: string; created_at?: string };
        Update: { owner_id?: string; friend_id?: string; created_at?: string };
        Relationships: Relationships;
      };
      live_streams: {
        Row: {
          id: string;
          host_id: string;
          room_name: string;
          title: string;
          status: 'starting' | 'live' | 'ended';
          created_at: string;
          started_at: string | null;
          heartbeat_at: string;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          host_id: string;
          room_name: string;
          title?: string;
          status?: 'starting' | 'live' | 'ended';
          created_at?: string;
          started_at?: string | null;
          heartbeat_at?: string;
          ended_at?: string | null;
        };
        Update: {
          id?: string;
          host_id?: string;
          room_name?: string;
          title?: string;
          status?: 'starting' | 'live' | 'ended';
          created_at?: string;
          started_at?: string | null;
          heartbeat_at?: string;
          ended_at?: string | null;
        };
        Relationships: Relationships;
      };
      live_messages: {
        Row: LiveMessageRow;
        Insert: { id?: string; stream_id: string; author_id: string; body: string; created_at?: string; deleted_at?: string | null };
        Update: { id?: string; stream_id?: string; author_id?: string; body?: string; created_at?: string; deleted_at?: string | null };
        Relationships: Relationships;
      };
      live_mutes: {
        Row: { stream_id: string; user_id: string; muted_by: string; expires_at: string; created_at: string };
        Insert: { stream_id: string; user_id: string; muted_by: string; expires_at: string; created_at?: string };
        Update: { stream_id?: string; user_id?: string; muted_by?: string; expires_at?: string; created_at?: string };
        Relationships: Relationships;
      };
      live_bans: {
        Row: { stream_id: string; user_id: string; banned_by: string; reason: string | null; expires_at: string | null; created_at: string };
        Insert: { stream_id: string; user_id: string; banned_by: string; reason?: string | null; expires_at?: string | null; created_at?: string };
        Update: { stream_id?: string; user_id?: string; banned_by?: string; reason?: string | null; expires_at?: string | null; created_at?: string };
        Relationships: Relationships;
      };
      posts: {
        Row: FeedPost;
        Insert: {
          id?: string;
          author_id: string;
          caption?: string;
          hashtags?: string[];
          video_path?: string | null;
          thumb_path?: string | null;
          captions_path?: string | null;
          duration_ms?: number | null;
          width?: number | null;
          height?: number | null;
          audience?: 'everyone' | 'followers';
          allow_comments?: boolean;
          auto_captions?: boolean;
          status?: FeedPost['status'];
          like_count?: number;
          comment_count?: number;
          save_count?: number;
          share_count?: number;
          view_count?: number;
          pinned_at?: string | null;
          is_demo?: boolean;
          created_at?: string;
          published_at?: string | null;
        };
        Update: {
          id?: string;
          author_id?: string;
          caption?: string;
          hashtags?: string[];
          video_path?: string | null;
          thumb_path?: string | null;
          captions_path?: string | null;
          duration_ms?: number | null;
          width?: number | null;
          height?: number | null;
          audience?: 'everyone' | 'followers';
          allow_comments?: boolean;
          auto_captions?: boolean;
          status?: FeedPost['status'];
          like_count?: number;
          comment_count?: number;
          save_count?: number;
          share_count?: number;
          view_count?: number;
          pinned_at?: string | null;
          is_demo?: boolean;
          created_at?: string;
          published_at?: string | null;
        };
        Relationships: Relationships;
      };
      post_likes: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string; created_at?: string };
        Update: { post_id?: string; user_id?: string; created_at?: string };
        Relationships: Relationships;
      };
      post_saves: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string; created_at?: string };
        Update: { post_id?: string; user_id?: string; created_at?: string };
        Relationships: Relationships;
      };
      post_views: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string; created_at?: string };
        Update: { post_id?: string; user_id?: string; created_at?: string };
        Relationships: Relationships;
      };
      comments: {
        Row: {
          id: string;
          post_id: string;
          author_id: string;
          parent_id: string | null;
          body: string;
          like_count: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          post_id: string;
          author_id: string;
          parent_id?: string | null;
          body: string;
          like_count?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          post_id?: string;
          author_id?: string;
          parent_id?: string | null;
          body?: string;
          like_count?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: Relationships;
      };
      comment_likes: {
        Row: { comment_id: string; user_id: string; created_at: string };
        Insert: { comment_id: string; user_id: string; created_at?: string };
        Update: { comment_id?: string; user_id?: string; created_at?: string };
        Relationships: Relationships;
      };
      follows: {
        Row: {
          follower_id: string;
          following_id: string;
          status: 'accepted' | 'pending';
          created_at: string;
        };
        Insert: {
          follower_id: string;
          following_id: string;
          status?: 'accepted' | 'pending';
          created_at?: string;
        };
        Update: {
          follower_id?: string;
          following_id?: string;
          status?: 'accepted' | 'pending';
          created_at?: string;
        };
        Relationships: Relationships;
      };
      blocks: {
        Row: {
          blocker_id: string;
          blocked_id: string;
          blocked_username: string;
          blocked_display_name: string;
          blocked_avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          blocker_id: string;
          blocked_id: string;
          blocked_username?: string;
          blocked_display_name?: string;
          blocked_avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          blocker_id?: string;
          blocked_id?: string;
          blocked_username?: string;
          blocked_display_name?: string;
          blocked_avatar_url?: string | null;
          created_at?: string;
        };
        Relationships: Relationships;
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string;
          type: NotificationType;
          post_id: string | null;
          comment_id: string | null;
          community_id: string | null;
          live_stream_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id: string;
          type: NotificationType;
          post_id?: string | null;
          comment_id?: string | null;
          community_id?: string | null;
          live_stream_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string;
          type?: NotificationType;
          post_id?: string | null;
          comment_id?: string | null;
          community_id?: string | null;
          live_stream_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        communities: {
          Row: {
            id: string;
            slug: string;
            name: string;
            description: string;
            category: CommunityCategory;
            visibility: CommunityVisibility;
            is_adults_only: boolean;
            owner_id: string;
            icon_path: string | null;
            rules: Json;
            member_count: number;
            post_count: number;
            is_archived: boolean;
            created_at: string;
          };
          Insert: {
            id?: string;
            slug: string;
            name: string;
            description?: string;
            category: CommunityCategory;
            visibility?: CommunityVisibility;
            is_adults_only?: boolean;
            owner_id: string;
            icon_path?: string | null;
            rules?: Json;
            member_count?: number;
            post_count?: number;
            is_archived?: boolean;
            created_at?: string;
          };
          Update: {
            id?: string;
            slug?: string;
            name?: string;
            description?: string;
            category?: CommunityCategory;
            visibility?: CommunityVisibility;
            is_adults_only?: boolean;
            owner_id?: string;
            icon_path?: string | null;
            rules?: Json;
            member_count?: number;
            post_count?: number;
            is_archived?: boolean;
            created_at?: string;
          };
          Relationships: Relationships;
        };
        community_members: {
          Row: {
            community_id: string;
            user_id: string;
            role: CommunityRole;
            status: CommunityMemberStatus;
            joined_at: string;
          };
          Insert: {
            community_id: string;
            user_id: string;
            role?: CommunityRole;
            status?: CommunityMemberStatus;
            joined_at?: string;
          };
          Update: {
            community_id?: string;
            user_id?: string;
            role?: CommunityRole;
            status?: CommunityMemberStatus;
            joined_at?: string;
          };
          Relationships: Relationships;
        };
        community_posts: {
          Row: {
            id: string;
            community_id: string;
            author_id: string;
            body: string;
            media_path: string | null;
            media_kind: 'image' | 'video' | null;
            pinned_at: string | null;
            removed_at: string | null;
            removed_by: string | null;
            created_at: string;
          };
          Insert: {
            id?: string;
            community_id: string;
            author_id: string;
            body?: string;
            media_path?: string | null;
            media_kind?: 'image' | 'video' | null;
            pinned_at?: string | null;
            removed_at?: string | null;
            removed_by?: string | null;
            created_at?: string;
          };
          Update: {
            id?: string;
            community_id?: string;
            author_id?: string;
            body?: string;
            media_path?: string | null;
            media_kind?: 'image' | 'video' | null;
            pinned_at?: string | null;
            removed_at?: string | null;
            removed_by?: string | null;
            created_at?: string;
          };
          Relationships: Relationships;
        };
        community_post_reports: {
          Row: {
            id: string;
            post_id: string;
            reporter_id: string;
            reason: 'spam' | 'harassment' | 'hate' | 'sexual_content' | 'violence' | 'other';
            details: string;
            status: 'open' | 'resolved';
            resolved_by: string | null;
            resolved_at: string | null;
            created_at: string;
          };
          Insert: {
            id?: string;
            post_id: string;
            reporter_id: string;
            reason: 'spam' | 'harassment' | 'hate' | 'sexual_content' | 'violence' | 'other';
            details?: string;
            status?: 'open' | 'resolved';
            resolved_by?: string | null;
            resolved_at?: string | null;
            created_at?: string;
          };
          Update: {
            id?: string;
            post_id?: string;
            reporter_id?: string;
            reason?: 'spam' | 'harassment' | 'hate' | 'sexual_content' | 'violence' | 'other';
            details?: string;
            status?: 'open' | 'resolved';
            resolved_by?: string | null;
            resolved_at?: string | null;
            created_at?: string;
          };
          Relationships: Relationships;
        };
        community_messages: {
          Row: {
            id: string;
            community_id: string;
            author_id: string;
            body: string;
            created_at: string;
          };
          Insert: {
            id?: string;
            community_id: string;
            author_id: string;
            body: string;
            created_at?: string;
          };
          Update: {
            id?: string;
            community_id?: string;
            author_id?: string;
            body?: string;
            created_at?: string;
          };
          Relationships: Relationships;
        };
        Relationships: Relationships;
      };
      conversations: {
        Row: {
          id: string;
          type: 'direct' | 'group';
          title: string | null;
          avatar_path: string | null;
          created_by: string;
          read_only: boolean;
          is_demo: boolean;
          direct_key: string | null;
          last_message_id: string | null;
          last_message_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: 'direct' | 'group';
          title?: string | null;
          avatar_path?: string | null;
          created_by: string;
          read_only?: boolean;
          is_demo?: boolean;
          direct_key?: string | null;
          last_message_id?: string | null;
          last_message_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          type?: 'direct' | 'group';
          title?: string | null;
          avatar_path?: string | null;
          created_by?: string;
          read_only?: boolean;
          is_demo?: boolean;
          direct_key?: string | null;
          last_message_id?: string | null;
          last_message_at?: string | null;
          created_at?: string;
        };
        Relationships: Relationships;
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          is_demo: boolean;
          last_read_message_id: string | null;
          unread_count: number;
          muted: boolean;
          joined_at: string;
          left_at: string | null;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          role?: 'owner' | 'admin' | 'member';
          is_demo?: boolean;
          last_read_message_id?: string | null;
          unread_count?: number;
          muted?: boolean;
          joined_at?: string;
          left_at?: string | null;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          role?: 'owner' | 'admin' | 'member';
          is_demo?: boolean;
          last_read_message_id?: string | null;
          unread_count?: number;
          muted?: boolean;
          joined_at?: string;
          left_at?: string | null;
        };
        Relationships: Relationships;
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          client_id: string;
          kind: 'text' | 'image' | 'video' | 'voice' | 'call' | 'system';
          is_demo: boolean;
          body: string | null;
          media_path: string | null;
          media_duration_ms: number | null;
          width: number | null;
          height: number | null;
          reply_to_id: string | null;
          story_reply_story_id: string | null;
          story_reply_preview_path: string | null;
          story_reply_caption: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          client_id: string;
          kind: 'text' | 'image' | 'video' | 'voice' | 'call' | 'system';
          is_demo?: boolean;
          body?: string | null;
          media_path?: string | null;
          media_duration_ms?: number | null;
          width?: number | null;
          height?: number | null;
          reply_to_id?: string | null;
          story_reply_story_id?: string | null;
          story_reply_preview_path?: string | null;
          story_reply_caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string;
          client_id?: string;
          kind?: 'text' | 'image' | 'video' | 'voice' | 'call' | 'system';
          is_demo?: boolean;
          body?: string | null;
          media_path?: string | null;
          media_duration_ms?: number | null;
          width?: number | null;
          height?: number | null;
          reply_to_id?: string | null;
          story_reply_story_id?: string | null;
          story_reply_preview_path?: string | null;
          story_reply_caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: Relationships;
      };
      message_reactions: {
        Row: { message_id: string; user_id: string; emoji: string; is_demo: boolean };
        Insert: { message_id: string; user_id: string; emoji: string; is_demo?: boolean };
        Update: { message_id?: string; user_id?: string; emoji?: string; is_demo?: boolean };
        Relationships: Relationships;
      };
      device_push_tokens: {
        Row: {
          user_id: string;
          installation_id: string;
          expo_push_token: string;
          platform: 'ios' | 'android';
          updated_at: string;
        };
        Insert: {
          user_id: string;
          installation_id: string;
          expo_push_token: string;
          platform: 'ios' | 'android';
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          installation_id?: string;
          expo_push_token?: string;
          platform?: 'ios' | 'android';
          updated_at?: string;
        };
        Relationships: Relationships;
      };
      user_settings: {
        Row: {
          user_id: string;
          push_enabled: boolean;
          notify_likes: boolean;
          notify_comments: boolean;
          notify_followers: boolean;
          notify_messages: boolean;
          notify_live: boolean;
          show_online_status: boolean;
          show_liked_videos: boolean;
          personalized_recommendations: boolean;
          story_replies: 'everyone' | 'followers' | 'off';
        };
        Insert: {
          user_id: string;
          push_enabled?: boolean;
          notify_likes?: boolean;
          notify_comments?: boolean;
          notify_followers?: boolean;
          notify_messages?: boolean;
          notify_live?: boolean;
          show_online_status?: boolean;
          show_liked_videos?: boolean;
          personalized_recommendations?: boolean;
          story_replies?: 'everyone' | 'followers' | 'off';
        };
        Update: {
          user_id?: string;
          push_enabled?: boolean;
          notify_likes?: boolean;
          notify_comments?: boolean;
          notify_followers?: boolean;
          notify_messages?: boolean;
          notify_live?: boolean;
          show_online_status?: boolean;
          show_liked_videos?: boolean;
          personalized_recommendations?: boolean;
          story_replies?: 'everyone' | 'followers' | 'off';
        };
        Relationships: Relationships;
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: string;
          target_id?: string;
          reason?: string;
          created_at?: string;
        };
        Relationships: Relationships;
      };
      call_sessions: {
        Row: {
          id: string;
          conversation_id: string;
          caller_id: string;
          callee_id: string;
          room_name: string;
          media_type: 'audio' | 'video';
          status: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
          caller_connected_at: string | null;
          callee_connected_at: string | null;
          expires_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          caller_id: string;
          callee_id: string;
          room_name: string;
          media_type: 'audio' | 'video';
          status?: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
          caller_connected_at?: string | null;
          callee_connected_at?: string | null;
          expires_at: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          caller_id?: string;
          callee_id?: string;
          room_name?: string;
          media_type?: 'audio' | 'video';
          status?: 'ringing' | 'connecting' | 'active' | 'ended' | 'declined' | 'missed';
          caller_connected_at?: string | null;
          callee_connected_at?: string | null;
          expires_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: Relationships;
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_view_story: { Args: { p_story_id: string; p_viewer_id?: string }; Returns: boolean };
      can_reply_to_story: { Args: { p_story_id: string }; Returns: boolean };
      send_story_reply: { Args: { p_story_id: string; p_body: string }; Returns: string };
      story_reply_media_is_referenced: { Args: { p_path: string }; Returns: boolean };
      get_story_rail: { Args: Record<string, never>; Returns: StoryRailRow[] };
      get_author_stories: { Args: { p_author_id: string }; Returns: AuthorStoryRpcRow[] };
      mark_story_viewed: { Args: { p_story_id: string }; Returns: undefined };
      get_story_viewers: {
        Args: {
          p_story_id: string;
          p_cursor_viewed_at?: string | null;
          p_cursor_viewer_id?: string | null;
        };
        Returns: Json;
      };
      start_live: { Args: { p_title?: string }; Returns: string };
      mark_live_started: { Args: { p_stream_id: string }; Returns: boolean };
      live_heartbeat: { Args: { p_stream_id: string }; Returns: boolean };
      end_live: { Args: { p_stream_id: string }; Returns: boolean };
      can_view_live: { Args: { p_stream_id: string; p_viewer_id?: string }; Returns: boolean };
      get_live_streams: { Args: { p_limit?: number }; Returns: LiveStreamRpcRow[] };
      get_live_stream: { Args: { p_stream_id: string }; Returns: LiveStreamRpcRow[] };
      send_live_message: { Args: { p_stream_id: string; p_body: string }; Returns: string };
      delete_live_message: { Args: { p_stream_id: string; p_message_id: string }; Returns: boolean };
      mute_live_user: { Args: { p_stream_id: string; p_user_id: string; p_duration_seconds?: number }; Returns: string };
      ban_live_user: { Args: { p_stream_id: string; p_user_id: string; p_reason?: string | null; p_duration_seconds?: number | null }; Returns: boolean };
      delete_story: { Args: { p_story_id: string }; Returns: undefined };
      add_close_friend: { Args: { p_friend_id: string }; Returns: undefined };
      remove_close_friend: { Args: { p_friend_id: string }; Returns: undefined };
      get_close_friends: {
        Args: { p_query?: string; p_cursor?: string | null };
        Returns: { friend_id: string; display_name: string; username: string }[];
      };
      get_close_friend_candidates: {
        Args: { p_query?: string; p_cursor?: string | null };
        Returns: { user_id: string; display_name: string; username: string }[];
      };
      apply_profile_age_defaults: { Args: Record<string, never>; Returns: unknown };
      can_view_post: { Args: { p_post_id: string; p_viewer_id: string }; Returns: boolean };
      finalize_post: { Args: { post_id: string }; Returns: undefined };
      get_follow_counts: {
        Args: { profile_id: string };
        Returns: { follower_count: number; following_count: number }[];
      };
      get_feed: {
        Args: {
          mode: string;
          cursor_published_at?: string | null;
          cursor_id?: string | null;
          page_size?: number;
        };
        Returns: FeedRpcRow[];
      };
      get_profile: {
        Args: { p_username: string | null };
        Returns: ProfileRpcRow[];
      };
      get_profile_posts: {
        Args: {
          p_user_id: string;
          p_tab: 'posts' | 'liked' | 'saved';
          p_cursor_created_at?: string | null;
          p_cursor_id?: string | null;
          p_page_size?: number;
          p_cursor_pinned?: boolean | null;
        };
        Returns: FeedRpcRow[];
      };
      get_follow_list: {
        Args: {
          p_user_id: string;
          p_kind: 'followers' | 'following';
          p_query?: string;
          p_cursor_created_at?: string | null;
          p_cursor_user_id?: string | null;
          p_page_size?: number;
        };
        Returns: ProfileListRpcRow[];
      };
      follow_user: { Args: { p_target: string }; Returns: string };
      unfollow_user: { Args: { p_target: string }; Returns: undefined };
      cancel_follow_request: { Args: { p_target: string }; Returns: undefined };
      respond_follow_request: { Args: { p_follower: string; p_accept: boolean }; Returns: undefined };
      get_follow_requests: {
        Args: { p_cursor_created_at?: string | null; p_cursor_user_id?: string | null; p_page_size?: number };
        Returns: FollowRequestRpcRow[];
      };
      set_account_privacy: { Args: { p_is_private: boolean }; Returns: undefined };
      block_user: { Args: { p_target: string }; Returns: undefined };
      unblock_user: { Args: { p_target: string }; Returns: undefined };
      get_blocked_users: {
        Args: { p_cursor_created_at?: string | null; p_cursor_user_id?: string | null; p_page_size?: number };
        Returns: BlockedProfileRpcRow[];
      };
      search_people: {
        Args: {
          p_query: string;
          p_cursor_username?: string | null;
          p_cursor_id?: string | null;
          p_page_size?: number;
        };
        Returns: SearchPersonRpcRow[];
      };
      search_videos: {
        Args: {
          p_query: string;
          p_hashtag?: string | null;
          p_cursor_published_at?: string | null;
          p_cursor_id?: string | null;
          p_page_size?: number;
        };
        Returns: FeedRpcRow[];
      };
      search_hashtags: {
        Args: {
          p_query: string;
          p_exact?: boolean;
          p_cursor_post_count?: number | null;
          p_cursor_tag?: string | null;
          p_page_size?: number;
        };
        Returns: SearchHashtagRpcRow[];
      };
      trending_hashtags: {
        Args: Record<string, never>;
        Returns: SearchHashtagRpcRow[];
      };
      suggested_people: {
        Args: Record<string, never>;
        Returns: SuggestedPersonRpcRow[];
      };
      can_view_community: { Args: { p_community_id: string; p_viewer_id?: string }; Returns: boolean };
      create_community_post: {
        Args: { p_community_id: string; p_body: string; p_media_path?: string | null; p_media_kind?: string | null };
        Returns: string;
      };
      get_community_posts: { Args: { p_community_id: string; p_page_size?: number }; Returns: CommunityPostRpcRow[] };
      moderate_community_post: { Args: { p_post_id: string; p_action: string }; Returns: undefined };
      report_community_post: { Args: { p_post_id: string; p_reason: string; p_details?: string }; Returns: string };
      get_community_post_reports: { Args: { p_community_id: string; p_page_size?: number }; Returns: CommunityPostReportRpcRow[] };
      resolve_community_post_report: { Args: { p_report_id: string }; Returns: undefined };
      send_community_message: { Args: { p_community_id: string; p_body: string }; Returns: string };
      get_community_messages: { Args: { p_community_id: string; p_page_size?: number }; Returns: CommunityMessageRpcRow[] };
      community_can_create_adults_only: { Args: Record<string, never>; Returns: boolean };
      community_name_available: { Args: { p_name: string }; Returns: boolean };
      create_community: {
        Args: {
          p_slug: string;
          p_name: string;
          p_description: string;
          p_category: CommunityCategory;
          p_visibility: CommunityVisibility;
          p_is_adults_only?: boolean;
          p_rules?: Json;
        };
        Returns: string;
      };
      join_community: { Args: { p_community_id: string }; Returns: string };
      leave_community: { Args: { p_community_id: string }; Returns: undefined };
      cancel_join_request: { Args: { p_community_id: string }; Returns: undefined };
      respond_join_request: {
        Args: { p_community_id: string; p_user_id: string; p_accept: boolean };
        Returns: undefined;
      };
      invite_member: { Args: { p_community_id: string; p_user_id: string }; Returns: undefined };
      respond_invite: { Args: { p_community_id: string; p_accept: boolean }; Returns: undefined };
      set_member_role: {
        Args: { p_community_id: string; p_user_id: string; p_role: CommunityRole };
        Returns: undefined;
      };
      transfer_ownership: { Args: { p_community_id: string; p_new_owner: string }; Returns: undefined };
      ban_member: { Args: { p_community_id: string; p_user_id: string }; Returns: undefined };
      unban_member: { Args: { p_community_id: string; p_user_id: string }; Returns: undefined };
      update_community: {
        Args: {
          p_community_id: string;
          p_name: string;
          p_description: string;
          p_category: CommunityCategory;
          p_visibility: CommunityVisibility;
          p_is_adults_only: boolean;
          p_icon_path?: string | null;
        };
        Returns: undefined;
      };
      update_rules: { Args: { p_community_id: string; p_rules: Json }; Returns: undefined };
      delete_community: { Args: { p_community_id: string }; Returns: undefined };
      get_community: { Args: { p_slug: string }; Returns: CommunityDetailRpcRow[] };
      get_community_members: {
        Args: {
          p_slug: string;
          p_query?: string;
          p_cursor_status?: CommunityMemberStatus | null;
          p_cursor_joined_at?: string | null;
          p_cursor_user_id?: string | null;
          p_page_size?: number;
        };
        Returns: CommunityMemberRpcRow[];
      };
      community_invite_candidates: {
        Args: {
          p_community_id: string;
          p_query: string;
          p_cursor_username?: string | null;
          p_cursor_id?: string | null;
          p_page_size?: number;
        };
        Returns: SearchPersonRpcRow[];
      };
      my_communities: { Args: Record<string, never>; Returns: CommunityListRpcRow[] };
      discover_communities: {
        Args: {
          p_category?: CommunityCategory | null;
          p_query?: string;
          p_cursor_rank?: number | null;
          p_cursor_members?: number | null;
          p_cursor_id?: string | null;
          p_page_size?: number;
        };
        Returns: CommunityRow[];
      };
      suggested_communities: { Args: Record<string, never>; Returns: CommunityRow[] };
      community_notification_route: { Args: { p_community_id: string }; Returns: string | null };
      pin_post: { Args: { p_post_id: string; p_pinned: boolean }; Returns: undefined };
      increment_share: { Args: { post_id: string }; Returns: undefined };
      is_username_available: { Args: { name: string }; Returns: boolean };
      start_direct_conversation: { Args: { other_user: string }; Returns: string };
      create_group: { Args: { group_title: string; member_ids: string[] }; Returns: string };
      add_group_members: { Args: { p_conversation_id: string; p_member_ids: string[] }; Returns: undefined };
      remove_group_member: { Args: { p_conversation_id: string; p_user_id: string }; Returns: undefined };
      leave_group: { Args: { p_conversation_id: string }; Returns: undefined };
      mark_read: { Args: { p_conversation_id: string; p_up_to_message_id: string }; Returns: undefined };
      chat_is_active_member: { Args: { p_conversation_id: string; p_user_id?: string }; Returns: boolean };
      set_follow_status: { Args: Record<string, never>; Returns: unknown };
      update_post_counter: { Args: Record<string, never>; Returns: unknown };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Post = Database['public']['Tables']['posts']['Row'];
