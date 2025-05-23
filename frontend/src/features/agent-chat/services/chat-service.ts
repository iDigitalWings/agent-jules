import { AgentChatSession, AgentMessage } from '../types/api'; 
import { nanoid } from 'nanoid';

export interface StreamedMessageChunk {
  type: 'text_chunk' | 'form_definition' | 'error_chunk' | 'end_of_stream';
  content?: string; 
  formDefinition?: any; 
  error?: string; 
  messageId?: string; 
}

let mockSessions: AgentChatSession[] = [
  { id: nanoid(), title: 'Order Inquiry Stream', createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(), lastMessageSnippet: 'Agent: Processing...' },
  { id: nanoid(), title: 'Tech Support Stream', createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(), lastMessageSnippet: 'User: My device is broken.' },
];

let mockMessages: Record<string, AgentMessage[]> = {
  [mockSessions[0].id]: [
    { id: nanoid(), chatId: mockSessions[0].id, role: 'user', content: 'I need to track my order.', timestamp: new Date(Date.now() - 5 * 60000).toISOString(), status: 'delivered' },
    { id: nanoid(), chatId: mockSessions[0].id, role: 'agent', content: 'Sure, I can help with that. What is your order ID?', timestamp: new Date(Date.now() - 4 * 60000).toISOString() },
  ],
   [mockSessions[1].id]: [
    { id: nanoid(), chatId: mockSessions[1].id, role: 'user', content: 'My device is broken.', timestamp: new Date(Date.now() - 10 * 60000).toISOString(), status: 'delivered' },
  ],
};

export const getChatSessions = async (): Promise<AgentChatSession[]> => {
  return [...mockSessions];
};

export const getMessages = async (chatId: string): Promise<AgentMessage[]> => {
  return [...(mockMessages[chatId] || [])];
};

export const sendMessage = async (
  chatId: string,
  content: string,
  onStreamUpdate: (chunk: StreamedMessageChunk) => void,
  onStreamEnd: (finalAgentMessageContent: string, agentMessageId: string) => void,
  onStreamError: (error: Error) => void
): Promise<AgentMessage> => { 

  const userMessage: AgentMessage = {
    id: nanoid(),
    chatId,
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    status: 'sent', 
  };

  if (!mockMessages[chatId]) {
    mockMessages[chatId] = [];
  }
  mockMessages[chatId].push(userMessage);
  
  const session = mockSessions.find(s => s.id === chatId);
  if (session) {
    session.lastMessageAt = userMessage.timestamp;
    session.lastMessageSnippet = `User: ${userMessage.content.substring(0,30)}...`;
    // Re-sort sessions to bring the active one to the top if desired by UI
    mockSessions = mockSessions.sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  const agentMessageId = nanoid(); 
  let currentAgentContent = '';

  const streamChunks: StreamedMessageChunk[] = [
    { type: 'text_chunk', content: 'Okay, I am looking into that for you. ', messageId: agentMessageId },
    { type: 'text_chunk', content: 'Your request about "', messageId: agentMessageId },
    { type: 'text_chunk', content: content.substring(0, 20) + '..." ', messageId: agentMessageId },
    { type: 'text_chunk', content: 'is being processed. ', messageId: agentMessageId },
    // { type: 'form_definition', formDefinition: { name: 'order_details', fields: [{name: 'order_id', type: 'text', label: 'Order ID'}] }, messageId: agentMessageId },
    { type: 'text_chunk', content: 'Please wait a moment.', messageId: agentMessageId },
    { type: 'end_of_stream', messageId: agentMessageId }
  ];

  let chunkIndex = 0;
  const intervalId = setInterval(() => {
    try {
      if (chunkIndex < streamChunks.length) {
        const chunk = streamChunks[chunkIndex];
        onStreamUpdate(chunk); 
        if (chunk.type === 'text_chunk' && chunk.content) {
          currentAgentContent += chunk.content;
        }
        
        if (chunk.type === 'end_of_stream') {
           clearInterval(intervalId);
           const finalAgentMessage: AgentMessage = {
            id: agentMessageId,
            chatId,
            role: 'agent',
            content: currentAgentContent,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };
          if (!mockMessages[chatId]) { 
             mockMessages[chatId] = [];
          }
          mockMessages[chatId].push(finalAgentMessage); 
          
          if (session) {
            session.lastMessageAt = finalAgentMessage.timestamp;
            session.lastMessageSnippet = `Agent: ${finalAgentMessage.content.substring(0,30)}...`;
            mockSessions = mockSessions.sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
          }
          onStreamEnd(currentAgentContent, agentMessageId);
        }
        chunkIndex++;
      } else { 
        // Should have been cleared by end_of_stream, but as a fallback:
        clearInterval(intervalId);
      }
    } catch (e) {
      clearInterval(intervalId);
      const error = e instanceof Error ? e : new Error('Streaming simulation failed');
      onStreamError(error);
    }
  }, 500); 

  return userMessage; 
};

export const editMessage = async (messageId: string, newContent: string): Promise<AgentMessage | null> => {
  for (const chatId in mockMessages) {
    const msgIndex = mockMessages[chatId].findIndex(m => m.id === messageId);
    if (msgIndex !== -1 && mockMessages[chatId][msgIndex].role === 'user') {
      mockMessages[chatId][msgIndex].content = newContent;
      mockMessages[chatId][msgIndex].timestamp = new Date().toISOString();
      return { ...mockMessages[chatId][msgIndex] };
    }
  }
  return null;
};

export const resendMessage = async (messageId: string): Promise<AgentMessage | null> => {
  console.warn("Resend functionality might need to be re-evaluated with streaming.");
  let originalMessage: AgentMessage | null = null;
  let chatIdHoldingMessage: string | null = null;

  for (const chatId in mockMessages) {
    originalMessage = mockMessages[chatId].find(m => m.id === messageId) || null;
    if (originalMessage) {
      chatIdHoldingMessage = chatId;
      break;
    }
  }
   if (originalMessage && chatIdHoldingMessage) {
    const agentResponse: AgentMessage = {
      id: nanoid(),
      chatId: chatIdHoldingMessage,
      role: 'agent',
      content: `(Re-Ack) Agent received: "${originalMessage.content.substring(0, 30)}..."`,
      timestamp: new Date().toISOString(),
    };
    mockMessages[chatIdHoldingMessage].push(agentResponse);
    
    const session = mockSessions.find(s => s.id === chatIdHoldingMessage);
    if (session) {
        session.lastMessageAt = agentResponse.timestamp;
        session.lastMessageSnippet = agentResponse.content.substring(0,50);
        mockSessions = mockSessions.sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    }
    return agentResponse;
  }
  return null;
};
