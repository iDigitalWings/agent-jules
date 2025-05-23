// frontend/src/features/agent-chat/tests/mock-chat-service.test.ts
import { vi } from 'vitest';
import * as chatService from '../services/mock-chat-service';
import { AgentChatSession, AgentMessage } from '../types/api';

// Mock nanoid as its actual implementation can vary and is not part of what's being tested here.
// This ensures predictable IDs if tests were to rely on them, and avoids external module issues.
vi.mock('nanoid', () => ({ nanoid: () => Math.random().toString(36).substring(7) }));


describe('Mock Chat Service', () => {
  let initialSessions: AgentChatSession[];
  // This will hold a snapshot of messages for a specific session, relevant for some tests.
  // let initialMessagesForFirstSession: AgentMessage[]; 

  beforeEach(async () => {
    // It's important to reset the state of the mock service if tests modify its underlying data.
    // The current mock-chat-service.ts resets its state upon module re-import if not carefully managed.
    // For these tests, we assume each test run gets a fresh state of the module or that modifications are tracked.
    // A more robust setup might involve a dedicated reset function in the mock service.

    initialSessions = await chatService.getChatSessions();
    // if (initialSessions.length > 0) {
    //   initialMessagesForFirstSession = await chatService.getMessages(initialSessions[0].id);
    // }
  });

  test('getChatSessions returns initial sessions', async () => {
    const sessions = await chatService.getChatSessions();
    // Based on the mock data, there should be at least 2 sessions.
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0]).toHaveProperty('id');
    expect(sessions[0]).toHaveProperty('title');
  });

  test('getMessages returns messages for a valid chatId', async () => {
    const firstSessionId = initialSessions[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found.");
    
    const messages = await chatService.getMessages(firstSessionId);
    // Based on mock data, the first session has at least one message.
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]).toHaveProperty('id');
    expect(messages[0]).toHaveProperty('chatId', firstSessionId);
  });

  test('getMessages returns an empty array for an invalid chatId', async () => {
    const messages = await chatService.getMessages('invalid-chat-id');
    expect(messages).toEqual([]);
  });

  test('sendMessage adds user and agent messages and updates session', async () => {
    const firstSessionId = initialSessions[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found.");
    
    const initialMessagesInSession = await chatService.getMessages(firstSessionId);
    const sessionBeforeSend = initialSessions.find(s => s.id === firstSessionId);
    const lastMessageAtBefore = sessionBeforeSend?.lastMessageAt;

    const content = 'A new test message from user';
    const { userMessage, agentMessage } = await chatService.sendMessage(firstSessionId, content);

    expect(userMessage.content).toBe(content);
    expect(userMessage.role).toBe('user');
    expect(userMessage.chatId).toBe(firstSessionId);
    expect(agentMessage.role).toBe('agent');
    expect(agentMessage.chatId).toBe(firstSessionId);
    expect(agentMessage.content).toContain('Agent response to:');

    const updatedMessagesInSession = await chatService.getMessages(firstSessionId);
    expect(updatedMessagesInSession.length).toBe(initialMessagesInSession.length + 2);
    expect(updatedMessagesInSession).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: userMessage.id }),
        expect.objectContaining({ id: agentMessage.id }),
    ]));
    
    const sessionsAfterSend = await chatService.getChatSessions();
    const sessionAfterSend = sessionsAfterSend.find(s => s.id === firstSessionId);
    expect(sessionAfterSend?.lastMessageAt).not.toBe(lastMessageAtBefore);
    expect(new Date(sessionAfterSend?.lastMessageAt || 0).getTime()).toBeGreaterThan(new Date(lastMessageAtBefore || 0).getTime());
    expect(sessionAfterSend?.lastMessageSnippet).toBe(agentMessage.content.substring(0,50));
  });

  test('editMessage updates user message content and timestamp', async () => {
    const firstSessionId = initialSessions[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found.");
    
    // Send a message to ensure there's a user message to edit
    const { userMessage: originalUserMessage } = await chatService.sendMessage(firstSessionId, "Original message to edit");
    const originalTimestamp = originalUserMessage.timestamp;

    // Allow some time to pass to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 10));

    const newContent = "Updated message content";
    const editedMessage = await chatService.editMessage(originalUserMessage.id, newContent);

    expect(editedMessage).not.toBeNull();
    expect(editedMessage?.id).toBe(originalUserMessage.id);
    expect(editedMessage?.content).toBe(newContent);
    expect(editedMessage?.timestamp).not.toBe(originalTimestamp); // Timestamp should be updated

    const messagesInSession = await chatService.getMessages(firstSessionId);
    const messageInStore = messagesInSession.find(m => m.id === originalUserMessage.id);
    expect(messageInStore?.content).toBe(newContent);
    expect(messageInStore?.timestamp).not.toBe(originalTimestamp);
  });

  test('editMessage does not edit agent messages', async () => {
    const firstSessionId = initialSessions[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found.");

    // Send a message to get an agent message
    const { agentMessage } = await chatService.sendMessage(firstSessionId, "Trigger agent message");
    const originalAgentContent = agentMessage.content;

    const newContentForAgent = "Attempt to edit agent message";
    const result = await chatService.editMessage(agentMessage.id, newContentForAgent);

    expect(result).toBeNull(); // Should return null as agent messages are not editable

    const messagesInSession = await chatService.getMessages(firstSessionId);
    const agentMessageInStore = messagesInSession.find(m => m.id === agentMessage.id);
    expect(agentMessageInStore?.content).toBe(originalAgentContent); // Content should not have changed
  });

  test('resendMessage generates a new agent response and updates session', async () => {
    const firstSessionId = initialSessions[0]?.id;
    if (!firstSessionId) throw new Error("Test setup error: No initial sessions found.");

    const { userMessage } = await chatService.sendMessage(firstSessionId, "Message to be resent");
    
    const messagesBeforeResend = await chatService.getMessages(firstSessionId);
    const sessionBeforeResend = (await chatService.getChatSessions()).find(s => s.id === firstSessionId);
    const lastMessageAtBefore = sessionBeforeResend?.lastMessageAt;

    // Allow some time to pass
    await new Promise(resolve => setTimeout(resolve, 10));

    const agentResponseOnResend = await chatService.resendMessage(userMessage.id);

    expect(agentResponseOnResend).not.toBeNull();
    expect(agentResponseOnResend?.role).toBe('agent');
    expect(agentResponseOnResend?.content).toContain("(Resent) Agent acknowledgment for:");
    expect(agentResponseOnResend?.chatId).toBe(firstSessionId);

    const messagesAfterResend = await chatService.getMessages(firstSessionId);
    expect(messagesAfterResend.length).toBe(messagesBeforeResend.length + 1); // One new agent message
    expect(messagesAfterResend).toContainEqual(expect.objectContaining({ id: agentResponseOnResend?.id }));
    
    // Check that the original user message status might be updated (e.g., to 'delivered')
    const originalUserMessageAfterResend = messagesAfterResend.find(m => m.id === userMessage.id);
    expect(originalUserMessageAfterResend?.status).toBe('delivered'); // As per mock service logic
    expect(originalUserMessageAfterResend?.timestamp).not.toBe(userMessage.timestamp); // Timestamp updated

    const sessionAfterResend = (await chatService.getChatSessions()).find(s => s.id === firstSessionId);
    expect(sessionAfterResend?.lastMessageAt).not.toBe(lastMessageAtBefore);
    expect(new Date(sessionAfterResend?.lastMessageAt || 0).getTime()).toBeGreaterThan(new Date(lastMessageAtBefore || 0).getTime());
    expect(sessionAfterResend?.lastMessageSnippet).toBe(agentResponseOnResend?.content.substring(0,50));
  });
});
