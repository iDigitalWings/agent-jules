// frontend/src/features/agent-chat/components/tests/agent-chat-view.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentChatView from '../agent-chat-view';
import * as chatService from '../../services/chat-service';
import { StreamedMessageChunk } from '../../types/api'; // Ensure StreamedMessageChunk is imported
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

// Mock the service
vi.mock('../../services/chat-service');

// Mock nanoid used by the service AND the component
vi.mock('nanoid', () => {
    let count = 0;
    return { nanoid: () => `mock-nanoid-${count++}` };
});

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn(),
  },
  writable: true,
});

// Mock scrollIntoView as it's not implemented in JSDOM
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock Tabler icons used in AgentChatView to avoid rendering issues in tests
vi.mock('@tabler/icons-react', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tabler/icons-react')>();
    return {
        ...original, // Keep other exports if any, or list them explicitly
        IconCopy: () => <div data-testid="icon-copy" />,
        IconPencil: () => <div data-testid="icon-pencil" />,
        IconSend: () => <div data-testid="icon-send" />,
        IconReload: () => <div data-testid="icon-reload" />,
        IconLoader2: () => <div data-testid="icon-loader" />,
    };
});


describe('AgentChatView Component with Streaming', () => {
  const getMockSessionsData = () => [
    { id: 's1', title: 'Chat 1 Stream', createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), lastMessageAt: new Date(Date.now() - 60000).toISOString(), lastMessageSnippet: 'Hello there!' },
    { id: 's2', title: 'Chat 2 Stream', createdAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString(), lastMessageAt: new Date(Date.now() - 2 * 60000).toISOString(), lastMessageSnippet: 'Hi again!' },
  ];

  const getMockMessagesData = () => ({
    s1: [
      { id: 'm1-s1', chatId: 's1', role: 'user' as const, content: 'User message 1 for s1', timestamp: new Date(Date.now() - 50000).toISOString(), status: 'delivered' as const },
      { id: 'm2-s1', chatId: 's1', role: 'agent' as const, content: 'Agent response 1 for s1', timestamp: new Date(Date.now() - 40000).toISOString() },
    ],
    s2: [{ id: 'm1-s2', chatId: 's2', role: 'user' as const, content: 'User message 1 for s2', timestamp: new Date(Date.now() - 30000).toISOString(), status: 'delivered' as const }],
  });

  let mockSessionsData: ReturnType<typeof getMockSessionsData>;
  let mockMessagesData: ReturnType<typeof getMockMessagesData>;

  beforeEach(() => {
    mockSessionsData = getMockSessionsData();
    mockMessagesData = getMockMessagesData();
    
    vi.useFakeTimers(); // Use fake timers for controlling stream simulation

    (chatService.getChatSessions as vi.Mock).mockResolvedValue(JSON.parse(JSON.stringify(mockSessionsData)));
    (chatService.getMessages as vi.Mock).mockImplementation(async (chatId: string) => 
        JSON.parse(JSON.stringify(mockMessagesData[chatId as keyof typeof mockMessagesData] || []))
    );
    
    (chatService.editMessage as vi.Mock).mockImplementation(async (messageId: string, newContent: string) => {
        // Simplified mock for editMessage
        for (const chatIdKey in mockMessagesData) {
            const typedChatIdKey = chatIdKey as keyof typeof mockMessagesData;
            const msgIndex = mockMessagesData[typedChatIdKey].findIndex(m => m.id === messageId);
            if (msgIndex !== -1 && mockMessagesData[typedChatIdKey][msgIndex].role === 'user') {
                const updatedMsg = { ...mockMessagesData[typedChatIdKey][msgIndex], content: newContent, timestamp: new Date().toISOString() };
                mockMessagesData[typedChatIdKey][msgIndex] = updatedMsg;
                return JSON.parse(JSON.stringify(updatedMsg));
            }
        }
        return null;
    });

    (chatService.resendMessage as vi.Mock).mockImplementation(async (messageId: string) => {
        // Simplified mock for resendMessage
        let originalMessage: any = null;
        let chatIdHoldingMessage: string | null = null;
        for (const chatIdKey in mockMessagesData) {
             const typedChatIdKey = chatIdKey as keyof typeof mockMessagesData;
            originalMessage = mockMessagesData[typedChatIdKey].find(m => m.id === messageId);
            if (originalMessage) {
                chatIdHoldingMessage = typedChatIdKey;
                break;
            }
        }
        if (originalMessage && chatIdHoldingMessage) {
            const agentResponse = {
                id: `resentAgent-${Math.random().toString(36).substring(2,9)}`,
                chatId: chatIdHoldingMessage,
                role: 'agent' as const,
                content: `(Re-Ack Stream) Agent received: "${originalMessage.content.substring(0, 30)}..."`,
                timestamp: new Date().toISOString(),
                status: 'delivered' as const
            };
            // Assume it gets added to the messages list by the component logic based on what resendMessage returns
            return JSON.parse(JSON.stringify(agentResponse)); 
        }
        return null;
    });

    // Mock the new sendMessage to simulate streaming
    (chatService.sendMessage as vi.Mock).mockImplementation(
      async (
        chatId: string,
        content: string,
        onStreamUpdate: (chunk: StreamedMessageChunk) => void,
        onStreamEnd: (finalAgentMessageContent: string, agentMessageId: string) => void,
        // onStreamError: (error: Error) => void // Can be added if testing error paths
      ) => {
        // This is the confirmed user message returned by the actual service.ts
        const userMessage = { 
            id: `user-${Math.random().toString(36).substring(2,9)}`, // Service confirms/generates final ID
            chatId, 
            role: 'user' as const, 
            content, 
            timestamp: new Date().toISOString(), 
            status: 'delivered' as const // Service confirms it's delivered/sent
        };
        
        const agentMessageId = `agent-stream-${Math.random().toString(36).substring(2,9)}`;
        const chunks: StreamedMessageChunk[] = [
          { type: 'agent_message_start', messageId: agentMessageId, chatId: chatId, timestamp: new Date().toISOString() },
          { type: 'text_chunk', content: 'Agent streaming: ', messageId: agentMessageId },
          { type: 'text_chunk', content: 'Echoing "', messageId: agentMessageId },
          { type: 'text_chunk', content: content, messageId: agentMessageId },
          { type: 'text_chunk', content: '" back to you.', messageId: agentMessageId },
          { type: 'end_of_stream', messageId: agentMessageId }
        ];
        
        let fullResponse = '';
        
        // Simulate async streaming with timeouts
        const stream = async () => {
          for (const chunk of chunks) {
            if (chunk.type === 'text_chunk' && chunk.content) fullResponse += chunk.content;
            // IMPORTANT: Wrap state-updating callbacks in act if they cause React state changes
            await act(async () => {
                onStreamUpdate(chunk);
                // Simulate network delay for each chunk
                await new Promise(resolve => setTimeout(resolve, 50)); 
            });
          }
          await act(async () => {
            onStreamEnd(fullResponse, agentMessageId);
          });
        };
        stream(); // Start the stream simulation (don't await here, it's async)
        
        return JSON.parse(JSON.stringify(userMessage)); // Return confirmed user message
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers(); // Restore real timers
  });

  test('sends a message and displays streaming response correctly', async () => {
    // userEvent.setup() is essential for fake timers to work with userEvent
    const user = userEvent.setup({ advanceStubs: vi.advanceTimersByTime }); 
    render(<AgentChatView />);
    
    // Wait for initial session to load and select it
    await waitFor(() => screen.getByText(mockSessionsData[0].title));
    await user.click(screen.getByText(mockSessionsData[0].title));
    await waitFor(() => screen.getByText(mockMessagesData.s1[0].content)); // Wait for messages of Chat 1

    const input = screen.getByPlaceholderText(/type your message/i);
    const sendButton = screen.getByRole('button', { name: /send/i });

    const testMessageContent = 'Hello Streaming Agent';
    await user.type(input, testMessageContent);
    
    // Click send button - this should trigger state updates
    // Wrapping in act because this user action leads to state changes (message list, isStreaming)
    await act(async () => {
      await user.click(sendButton);
    });

    // Check for optimistic user message (status: pending)
    // The nanoid mock will give predictable IDs: 'mock-nanoid-0', 'mock-nanoid-1', etc.
    // Assuming the first optimistic user message ID will be 'temp-user-mock-nanoid-0'
    expect(screen.getByText(testMessageContent)).toBeInTheDocument();
    // Check for "pending" status if your component shows it
    expect(screen.getByText(/sending.../i)).toBeInTheDocument(); 
    expect(sendButton).toBeDisabled(); // Or check for "Sending..." text or loader icon

    // Advance timers to simulate the stream processing
    await act(async () => {
        vi.runAllTimers(); // Process all simulated stream chunks and their timeouts
    });
    
    // Verify streaming UI updates
    await waitFor(() => {
      // Check for the initial part of the agent's message
      const agentStreamingMessage = screen.getByText(/Agent streaming: Echoing/i);
      expect(agentStreamingMessage).toBeInTheDocument();
      // Check for loader icon during streaming (if IconLoader2 is rendered)
      expect(screen.queryByTestId('icon-loader')).toBeInTheDocument(); 
    });
    
    // Verify final agent message after stream ends
    await waitFor(() => {
      const finalAgentMessage = screen.getByText(`Agent streaming: Echoing "${testMessageContent}" back to you.`);
      expect(finalAgentMessage).toBeInTheDocument();
      // Loader icon should be gone
      expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
      // Send button should be enabled again
      expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();
    }, { timeout: 2000 }); // Increased timeout for waitFor

    // Verify that sendMessage was called with the correct parameters
    expect(chatService.sendMessage).toHaveBeenCalledWith(
      mockSessionsData[0].id, // s1
      testMessageContent,
      expect.any(Function), // onStreamUpdate
      expect.any(Function), // onStreamEnd
      expect.any(Function)  // onStreamError
    );

    // Verify user message is updated from 'pending' to 'delivered'
    // The text "(sending...)" should disappear
    expect(screen.queryByText(/sending.../i)).not.toBeInTheDocument();
  });
});
