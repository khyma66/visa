export type Profile = {
  id: string;
  username: string;
  avatar_seed: string;
  bio: string | null;
  reputation: number;
};

export type Question = {
  id: string;
  author_id: string | null;
  author_username: string;
  author_avatar_seed: string;
  title: string;
  body: string;
  destination_country: string;
  visa_type: string;
  tags: string[];
  status: 'open' | 'closed' | 'archived';
  vote_score: number;
  answer_count: number;
  view_count: number;
  accepted_answer_id: string | null;
  created_at: string;
  updated_at: string;
  source?: 'visaflow' | 'apify';
  source_url?: string | null;
  source_label?: string | null;
  source_group?: string | null;
  post_kind?: 'question' | 'discussion' | 'promotion';
};

export type Answer = {
  id: string;
  question_id: string;
  author_id: string | null;
  author_username: string;
  author_avatar_seed: string;
  body: string;
  vote_score: number;
  is_accepted: boolean;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  source?: 'visaflow' | 'apify';
  source_url?: string | null;
};

export type RelatedQuestion = Pick<
  Question,
  'id' | 'title' | 'visa_type' | 'tags' | 'vote_score' | 'answer_count' | 'created_at'
> & { similarity_score?: number; matched_tags?: string[]; match_reason?: string };

export type Conversation = {
  id: string;
  other_user_id: string;
  other_username: string;
  other_avatar_seed: string;
  last_message: string | null;
  last_message_created_at: string | null;
  last_message_at: string;
  unread_count: number;
  request_status?: 'pending' | 'accepted' | 'declined' | 'blocked';
  requested_by?: string;
  blocked_by?: string | null;
};

export type DirectMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type CommunityUser = {
  id: string;
  email: string | null;
};

export type NewQuestion = {
  title: string;
  body: string;
  destination_country: string;
  visa_type: string;
  tags: string[];
};

export type CommunityFeed = {
  questions: Question[];
  answersByQuestionId: Record<string, Answer[]>;
  fetchedAt: string;
  source: {
    name: 'Apify';
    runId: string;
    status: 'live' | 'snapshot';
    totalItems: number;
    importedItems: number;
    emptyItems: number;
    duplicateItems: number;
    runCount?: number;
    commentCount?: number;
    runIds?: string[];
    capturedAt?: string;
    oldestRunAt?: string;
    newestRunAt?: string;
  };
};
