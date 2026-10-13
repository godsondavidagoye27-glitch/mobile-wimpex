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
        Row: { blocker_id: string; blocked_id: string; created_at: string };
        Insert: { blocker_id: string; blocked_id: string; created_at?: string };
        Update: { blocker_id?: string; blocked_id?: string; created_at?: string };
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
