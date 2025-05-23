// frontend/src/features/agent-chat/tests/chat-service.test.ts
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as chatService from '../services/chat-service';
import { AgentChatSession, AgentMessage, StreamedMessageChunk } from '../types/api';

// Keep the mock for nanoid
vi.mock('nanoid', () => ({ nanoid: () => Math.random().toString(36).substring(7) }));

// Access mockMessages directly for state verification if needed (as exported in previous step)
// Note: This direct import for modification/verification is a specific pattern for this mock service.
// In a real service, you'd verify through API calls or observable state.
import { mockMessages, mockSessions } from '../services/chat-service';


describe('Chat Service', () => {
  let initialSessionsSnapshot: AgentChatSession[];
  let initialMessagesSnapshot: Record<string, AgentMessage[]>;

  beforeEach(async () => {
    // Create deep copies of the initial state of mockSessions and mockMessages
    // This helps in asserting changes specific to a test without interference from other tests
    // or previous state modifications within the same test.
    initialSessionsSnapshot = JSON.parse(JSON.stringify(await chatService.getChatSessions()));
    
    const tempMessages: Record<string, AgentMessage[]> = {};
    for (const session of initialSessionsSnapshot) {
        tempMessages[session.id] = JSON.parse(JSON.stringify(await chatService.getMessages(session.id)));
    }
    initialMessagesSnapshot = tempMessages;

    // Use fake timers for controlling setInterval/setTimeout in sendMessage
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
    // Clear any mocks to prevent state leakage between tests
    vi.clearAllMocks();
    // vi.resetAllMocks(); // If using jest.resetAllMocks() or similar for complete isolation

    // Restore mockSessions and mockMessages to their initial state before any test modifications
    // This is crucial because the mock service mutates these arrays directly.
    // A more robust mock service would have a dedicated reset function.
    chatService.mockSessions.length = 0;
    Array.prototype.push.apply(chatService.mockSessions, JSON.parse(JSON.stringify(initialSessionsSnapshot)));
    
    for (const sessionId in chatService.mockMessages) {
        delete chatService.mockMessages[sessionId];
    }
    for (const sessionId in initialMessagesSnapshot) {
        chatService.mockMessages[sessionId] = JSON.parse(JSON.stringify(initialMessagesSnapshot[sessionId]));
    }

  });

  test('getChatSessions returns initial sessions', async () => {
    const sessions = await chatService.getChatSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2); // Based on current mock data
    expect(sessions[0]).toHaveProperty('id');
    expect(sessions[0]).toHaveProperty('title');
  });

  test('getMessages returns messages for a valid chatId', async () => {
    const firstSessionId = initialSessionsSnapshot[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found for getMessages test.");
    
    const messages = await chatService.getMessages(firstSessionId);
    // Compare against the snapshot, as the actual mockMessages can be modified by other tests if not careful
    expect(messages.length).toBe(initialMessagesSnapshot[firstSessionId]?.length || 0);
    if (initialMessagesSnapshot[firstSessionId]?.length > 0) {
        expect(messages[0]).toHaveProperty('id');
        expect(messages[0]).toHaveProperty('chatId', firstSessionId);
    }
  });

  test('getMessages returns an empty array for an invalid chatId', async () => {
    const messages = await chatService.getMessages('invalid-chat-id');
    expect(messages).toEqual([]);
  });

  describe('sendMessage with Streaming', () => {
    test('correctly simulates streaming and calls callbacks', async () => {
      const chatId = initialSessionsSnapshot[0].id; // Use a valid session ID from snapshot
      const content = 'Test streaming message';
      
      const onStreamUpdate = vi.fn();
      const onStreamEnd = vi.fn();
      const onStreamError = vi.fn();

      const initialMessagesCount = (await chatService.getMessages(chatId)).length;
      const initialSessionState = (await chatService.getChatSessions()).find(s => s.id === chatId);


      const userMessage = await chatService.sendMessage(
        chatId,
        content,
        onStreamUpdate,
        onStreamEnd,
        onStreamError
      );

      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe(content);
      expect(userMessage.status).toBe('sent'); // As per current chat-service.ts

      // Check user message was added optimistically
      const messagesAfterUserSend = await chatService.getMessages(chatId);
      expect(messagesAfterUserSend.length).toBe(initialMessagesCount + 1);
      expect(messagesAfterUserSend.find(m => m.id === userMessage.id)).toBeDefined();
      
      // Session snippet should update for user message
      const sessionAfterUserSend = (await chatService.getChatSessions()).find(s => s.id === chatId);
      expect(sessionAfterUserSend?.lastMessageSnippet).toBe(`User: ${content.substring(0,30)}...`);
      expect(new Date(sessionAfterUserSend!.lastMessageAt).getTime()).toBe(new Date(userMessage.timestamp).getTime());


      // Fast-forward timers to trigger all chunks
      vi.runAllTimers();

      expect(onStreamUpdate).toHaveBeenCalled();
      // Based on the streamChunks in chat-service.ts:
      // 1st call: { type: 'text_chunk', content: 'Okay, I am looking into that for you. ', messageId: agentMessageId },
      // ...
      // Last call before end: { type: 'text_chunk', content: 'Please wait a moment.', messageId: agentMessageId },
      // End of stream call: { type: 'end_of_stream', messageId: agentMessageId }
      const streamUpdateCalls = onStreamUpdate.mock.calls;
      expect(streamUpdateCalls.length).toBe(5); // 4 text_chunks + 1 end_of_stream
      expect(streamUpdateCalls[0][0]).toEqual(expect.objectContaining({ type: 'text_chunk', content: 'Okay, I am looking into that for you. ' }));
      expect(streamUpdateCalls[4][0]).toEqual(expect.objectContaining({ type: 'end_of_stream' }));
      
      expect(onStreamEnd).toHaveBeenCalledOnce();
      const [finalAgentContent, agentMessageId] = onStreamEnd.mock.calls[0];
      
      expect(typeof finalAgentContent).toBe('string');
      expect(typeof agentMessageId).toBe('string');
      
      // Verify accumulated content based on mock stream
      expect(finalAgentContent).toBe(`Okay, I am looking into that for you. Your request about "${content.substring(0, 20)}..." is being processed. Please wait a moment.`);

      expect(onStreamError).not.toHaveBeenCalled();

      // Verify that the agent's message is eventually stored in mockMessages
      const messagesAfterStream = await chatService.getMessages(chatId);
      expect(messagesAfterStream.length).toBe(initialMessagesCount + 2); // User message + Agent message
      const streamedAgentMessage = messagesAfterStream.find(m => m.id === agentMessageId && m.role === 'agent');
      expect(streamedAgentMessage).toBeDefined();
      expect(streamedAgentMessage?.content).toBe(finalAgentContent);
      expect(streamedAgentMessage?.status).toBe('delivered');

      // Verify session update after agent message
      const sessionAfterAgentStream = (await chatService.getChatSessions()).find(s => s.id === chatId);
      expect(sessionAfterAgentStream?.lastMessageSnippet).toBe(`Agent: ${finalAgentContent.substring(0,30)}...`);
      expect(new Date(sessionAfterAgentStream!.lastMessageAt).getTime()).toBe(new Date(streamedAgentMessage!.timestamp).getTime());
    });
  });

  // Tests for editMessage and resendMessage (can remain similar to previous versions,
  // but ensure they use the snapshots for initial state if they modify data)
  test('editMessage updates user message content and timestamp', async () => {
    const chatId = initialSessionsSnapshot[0].id;
     // Add a temporary user message to edit, ensuring it's part of the snapshot logic if needed
    const tempUserMessage: AgentMessage = { 
        id: 'edit-test-user', chatId, role: 'user', content: 'Original for edit', timestamp: new Date().toISOString() 
    };
    mockMessages[chatId].push(tempUserMessage); // Add to current mock state for the test

    const originalTimestamp = tempUserMessage.timestamp;
    await new Promise(resolve => setTimeout(resolve, 10)); // Ensure time passes for timestamp check

    const newContent = "Updated content for edit test";
    const editedMessage = await chatService.editMessage(tempUserMessage.id, newContent);

    expect(editedMessage).not.toBeNull();
    expect(editedMessage?.content).toBe(newContent);
    expect(editedMessage?.timestamp).not.toBe(originalTimestamp);

    const messagesInSession = await chatService.getMessages(chatId);
    const messageInStore = messagesInSession.find(m => m.id === tempUserMessage.id);
    expect(messageInStore?.content).toBe(newContent);
    
    // Clean up: Remove the temporary message if it wasn't part of the initial snapshot logic
    mockMessages[chatId] = mockMessages[chatId].filter(m => m.id !== tempUserMessage.id);
  });

  test('resendMessage generates a new agent response and updates session', async () => {
    const chatId = initialSessionsSnapshot[0].id;
    const tempUserMessage: AgentMessage = { 
        id: 'resend-test-user', chatId, role: 'user', content: 'Original for resend', timestamp: new Date().toISOString() 
    };
    mockMessages[chatId].push(tempUserMessage);
    const initialMessagesCount = (await chatService.getMessages(chatId)).length;


    const agentResponse = await chatService.resendMessage(tempUserMessage.id);
    expect(agentResponse).not.toBeNull();
    expect(agentResponse?.role).toBe('agent');
    expect(agentResponse?.content).toContain('(Re-Ack) Agent received:');

    const messagesAfterResend = await chatService.getMessages(chatId);
    expect(messagesAfterResend.length).toBe(initialMessagesCount + 1);
    
    // Clean up
    mockMessages[chatId] = mockMessages[chatId].filter(m => m.id !== tempUserMessage.id);
  });

});
