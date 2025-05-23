// frontend/src/features/agent-chat/types/api.ts

// Existing AgentMessage and AgentChatSession (ensure AgentMessage has all statuses)
export interface AgentMessage {
  id: string;
  chatId: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string; // ISO date string
  status?: 'pending' | 'sent' | 'delivered' | 'error' | 'streaming'; // Added 'streaming'
  agentForm?: {
    type: string;
    fields: Array<{
      name: string;
      label: string;
      type: 'text' | 'select' | 'number';
      options?: Array<{ value: string; label: string }>;
      required?: boolean;
    }>;
    submittedData?: Record<string, any>;
  };
}

export interface AgentChatSession {
  id: string;
  title: string;
  createdAt: string; // ISO date string
  lastMessageAt: string; // ISO date string
  lastMessageSnippet?: string;
}

// --- New/Updated types for Streaming API ---

// Represents a chunk of data received from the streaming API
export interface StreamedMessageChunk {
  type: 'text_chunk' | 'form_definition' | 'error_chunk' | 'end_of_stream' | 'agent_message_start';
  content?: string;         // For 'text_chunk'
  formDefinition?: any;   // For 'form_definition' (consider a more specific type)
  error?: string;           // For 'error_chunk'
  messageId: string;       // ID of the agent message being streamed. Sent with 'agent_message_start' and possibly other chunks.
  chatId?: string;          // Associated chat ID, could be sent with 'agent_message_start'
  timestamp?: string;       // Timestamp of the chunk or the message it belongs to
}

// Request payload for POST /api/chat (or the specific streaming endpoint)
export interface PostStreamingChatMessageRequest {
  chatId: string; // Assuming new messages are always associated with an existing chat for simplicity here
  message: {
    id: string; // Client-generated ID for the user's message
    role: 'user';
    content: string;
    // No timestamp needed from client here, server can set it on receipt/processing
  };
  // userId?: string; // If backend requires explicit user identification beyond auth token
}

// Conceptual response for POST /api/chat
// The actual response is a stream of StreamedMessageChunk objects.
// For documentation, you can represent it like this:
// Note: 'ReadableStream' is a global type available in modern browsers and Node.js.
// You might need to ensure your TypeScript environment recognizes it (e.g., "dom" in tsconfig.json lib).
export type PostStreamingChatMessageResponse = ReadableStream<StreamedMessageChunk>;


// --- Keeping older conceptual API types for non-streaming actions if still needed ---
// GET /api/agent-chats
export type GetAgentChatSessionsResponse = AgentChatSession[];

// GET /api/agent-chats/{chatId}/messages
export type GetAgentChatMessagesResponse = AgentMessage[];

// POST /api/agent-chats/{chatId}/messages (Non-streaming, if kept for some reason)
/* // Commenting out as per instruction if fully replaced
export interface PostAgentChatMessageRequest {
  chatId: string;
  message: Pick<AgentMessage, 'role' | 'content'>; 
}
export type PostAgentChatMessageResponse = AgentMessage; 
*/

// PUT /api/agent-chats/messages/{messageId} (For editing a message)
export interface PutAgentMessageRequest {
  messageId: string;
  content: string;
}
export type PutAgentMessageResponse = AgentMessage;

// POST /api/agent-chats/messages/{messageId}/resend (Non-streaming, if kept for some reason)
/* // Commenting out as per instruction if fully replaced
export interface PostResendMessageRequest {
  messageId: string;
}
export type PostResendMessageResponse = AgentMessage;
*/

// POST /api/agent-chats/agent-form-response (Non-streaming, if kept for some reason)
/* // Commenting out as per instruction if fully replaced
export interface PostAgentFormResponseRequest {
  messageIdWithForm: string; 
  formData: Record<string, any>;
}
export type PostAgentFormResponseResponse = AgentMessage; 
*/
