import { AgentChatSession, AgentMessage } from '../types/api';
import { nanoid } from 'nanoid'; // You might need to install nanoid: pnpm add nanoid -w (run in frontend dir if needed)

let mockSessions: AgentChatSession[] = [
  { id: nanoid(), title: 'Order Inquiry', createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(), lastMessageSnippet: 'Agent: We are checking...' },
  { id: nanoid(), title: 'Tech Support', createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(), lastMessageSnippet: 'User: My device isn’t working.' },
];

let mockMessages: Record<string, AgentMessage[]> = {
  [mockSessions[0].id]: [
    { id: nanoid(), chatId: mockSessions[0].id, role: 'user', content: 'Hello, I have a question about my recent order.', timestamp: new Date(Date.now() - 5 * 60000).toISOString(), status: 'delivered' },
    { id: nanoid(), chatId: mockSessions[0].id, role: 'agent', content: 'Hi there! I can help with that. What is your order number?', timestamp: new Date(Date.now() - 4 * 60000).toISOString() },
  ],
  [mockSessions[1].id]: [
    { id: nanoid(), chatId: mockSessions[1].id, role: 'user', content: 'My device isn’t working.', timestamp: new Date(Date.now() - 10 * 60000).toISOString(), status: 'delivered' },
  ],
};

export const getChatSessions = async (): Promise<AgentChatSession[]> => {
  return [...mockSessions];
};

export const getMessages = async (chatId: string): Promise<AgentMessage[]> => {
  return [...(mockMessages[chatId] || [])];
};

export const sendMessage = async (chatId: string, content: string): Promise<{ userMessage: AgentMessage, agentMessage: AgentMessage }> => {
  const userMessage: AgentMessage = {
    id: nanoid(),
    chatId,
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    status: 'delivered',
  };
  if (!mockMessages[chatId]) mockMessages[chatId] = [];
  mockMessages[chatId].push(userMessage);

  // Simulate agent response
  const agentMessage: AgentMessage = {
    id: nanoid(),
    chatId,
    role: 'agent',
    content: `Agent response to: "${content.substring(0, 30)}..."`,
    timestamp: new Date().toISOString(),
  };
  mockMessages[chatId].push(agentMessage);
  
  // Update session's last message time
  const session = mockSessions.find(s => s.id === chatId);
  if (session) {
    session.lastMessageAt = new Date().toISOString();
    session.lastMessageSnippet = agentMessage.content.substring(0, 50);
  }

  return { userMessage, agentMessage };
};

export const editMessage = async (messageId: string, newContent: string): Promise<AgentMessage | null> => {
  for (const chatId in mockMessages) {
    const msgIndex = mockMessages[chatId].findIndex(m => m.id === messageId);
    if (msgIndex !== -1 && mockMessages[chatId][msgIndex].role === 'user') {
      mockMessages[chatId][msgIndex].content = newContent;
      mockMessages[chatId][msgIndex].timestamp = new Date().toISOString(); // Update timestamp
      return { ...mockMessages[chatId][msgIndex] };
    }
  }
  return null;
};

export const resendMessage = async (messageId: string): Promise<AgentMessage | null> => {
  // Simulate resending: find the message, create a new "agent response" to it.
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
    originalMessage.status = 'delivered'; // Mark as delivered
    originalMessage.timestamp = new Date().toISOString(); // Update timestamp

    const agentResponse: AgentMessage = {
      id: nanoid(),
      chatId: chatIdHoldingMessage,
      role: 'agent',
      content: `(Resent) Agent acknowledgment for: "${originalMessage.content.substring(0, 30)}..."`,
      timestamp: new Date().toISOString(),
    };
    mockMessages[chatIdHoldingMessage].push(agentResponse);
    
    const session = mockSessions.find(s => s.id === chatIdHoldingMessage);
    if (session) {
        session.lastMessageAt = new Date().toISOString();
        session.lastMessageSnippet = agentResponse.content.substring(0, 50);
    }
    return agentResponse; // Or could return the original message with updated status
  }
  return null;
};
