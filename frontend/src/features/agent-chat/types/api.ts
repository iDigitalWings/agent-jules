// frontend/src/features/agent-chat/types/api.ts

export interface AgentMessage {
  id: string;
  chatId: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string; // ISO date string
  status?: 'pending' | 'sent' | 'delivered' | 'error';
  // Optional: For agent messages that might include interactive forms/elements
  agentForm?: {
    type: string; // e.g., 'order_status_form', 'product_query_form'
    fields: Array<{
      name: string;
      label: string;
      type: 'text' | 'select' | 'number';
      options?: Array<{ value: string; label: string }>;
      required?: boolean;
    }>;
    // Data submitted by the user for this form
    submittedData?: Record<string, any>;
  };
}

export interface AgentChatSession {
  id: string;
  title: string;
  createdAt: string; // ISO date string
  lastMessageAt: string; // ISO date string
  // May include a snippet of the last message or other metadata
  lastMessageSnippet?: string;
}

// Conceptual API endpoints (not actual code, but for documentation/type-safety)

// GET /api/agent-chats
export type GetAgentChatSessionsResponse = AgentChatSession[];

// GET /api/agent-chats/{chatId}/messages
export type GetAgentChatMessagesResponse = AgentMessage[];

// POST /api/agent-chats/{chatId}/messages
export interface PostAgentChatMessageRequest {
  chatId: string;
  message: Pick<AgentMessage, 'role' | 'content'>; // User sends role and content
}
export type PostAgentChatMessageResponse = AgentMessage; // Returns the created/agent response message

// PUT /api/agent-chats/messages/{messageId} (For editing a message)
export interface PutAgentMessageRequest {
  messageId: string;
  content: string;
}
export type PutAgentMessageResponse = AgentMessage;

// POST /api/agent-chats/messages/{messageId}/resend
export interface PostResendMessageRequest {
  messageId: string;
}
export type PostResendMessageResponse = AgentMessage; // Or just a status

// POST /api/agent-chats/agent-form-response
export interface PostAgentFormResponseRequest {
  messageIdWithForm: string; // ID of the agent message that contained the form
  formData: Record<string, any>;
}
export type PostAgentFormResponseResponse = AgentMessage; // Typically results in a new agent message
