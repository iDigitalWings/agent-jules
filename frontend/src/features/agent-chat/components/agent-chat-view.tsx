import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AgentChatSession,
  AgentMessage,
} from '@/features/agent-chat/types/api';
import {
  getChatSessions,
  getMessages,
  sendMessage,
  editMessage,
  resendMessage,
} from '@/features/agent-chat/services/mock-chat-service';
import { IconCopy, IconPencil, IconSend, IconReload } from '@tabler/icons-react';
import { cn } from '@/lib/utils'; // For conditional class names

const AgentChatView: React.FC = () => {
  const [chatSessions, setChatSessions] = useState<AgentChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [editingMessage, setEditingMessage] = useState<AgentMessage | null>(
    null,
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null); // For scrolling to bottom

  // Fetch initial chat sessions
  useEffect(() => {
    const fetchSessions = async () => {
      const sessions = await getChatSessions();
      setChatSessions(sessions);
      if (sessions.length > 0 && !currentChatId) {
        setCurrentChatId(sessions[0].id); // Select the first chat by default
      }
    };
    fetchSessions();
  }, []);

  // Fetch messages when currentChatId changes
  useEffect(() => {
    if (currentChatId) {
      const fetchMessages = async () => {
        const fetchedMessages = await getMessages(currentChatId);
        setMessages(fetchedMessages);
      };
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  // Scroll to bottom of messages when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSelectChat = (sessionId: string) => {
    setCurrentChatId(sessionId);
    setEditingMessage(null); // Clear editing state when switching chats
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentChatId) return;

    if (editingMessage) {
      // Handle editing existing message
      const updatedMessage = await editMessage(
        editingMessage.id,
        newMessage,
      );
      if (updatedMessage) {
        setMessages((prevMessages) =>
          prevMessages.map((msg) =>
            msg.id === updatedMessage.id ? updatedMessage : msg,
          ),
        );
      }
      setEditingMessage(null);
    } else {
      // Handle sending new message
      const { userMessage, agentMessage } = await sendMessage(
        currentChatId,
        newMessage,
      );
      setMessages((prevMessages) => [...prevMessages, userMessage, agentMessage]);
      // Update chat session list with new last message
      setChatSessions(prevSessions => 
        prevSessions.map(session => 
          session.id === currentChatId 
          ? { ...session, lastMessageAt: agentMessage.timestamp, lastMessageSnippet: agentMessage.content.substring(0,50) } 
          : session
        ).sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      );
    }
    setNewMessage('');
  };

  const handleEditMessage = (message: AgentMessage) => {
    if (message.role === 'user') {
      setEditingMessage(message);
      setNewMessage(message.content);
    }
  };

  const handleResendMessage = async (messageId: string) => {
    const agentResponse = await resendMessage(messageId);
    if (agentResponse && currentChatId) {
      setMessages((prevMessages) => [...prevMessages, agentResponse]);
      // Update chat session list with new last message
       setChatSessions(prevSessions => 
        prevSessions.map(session => 
          session.id === currentChatId 
          ? { ...session, lastMessageAt: agentResponse.timestamp, lastMessageSnippet: agentResponse.content.substring(0,50) } 
          : session
        ).sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      );
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(
      () => {
        // Optional: Show a success toast/notification
        console.log('Message copied to clipboard');
      },
      (err) => {
        // Optional: Show an error toast/notification
        console.error('Failed to copy message: ', err);
      },
    );
  };

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] w-full"> {/* Adjusted height */}
      {/* Sidebar for Chat History */}
      <aside className="w-1/4 border-r p-4 flex flex-col space-y-2 bg-muted/20">
        <h2 className="text-lg font-semibold mb-2 text-foreground">Chat History</h2>
        <ScrollArea className="flex-1">
          {chatSessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'p-2 rounded-md cursor-pointer hover:bg-muted',
                currentChatId === session.id && 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
              onClick={() => handleSelectChat(session.id)}
            >
              <div className="font-medium">{session.title}</div>
              <div className="text-xs text-muted-foreground truncate">
                {session.lastMessageSnippet || 'No messages yet'}
              </div>
              <div className="text-xs text-muted-foreground/80">
                {new Date(session.lastMessageAt).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </ScrollArea>
      </aside>

      {/* Main Chat Area */}
      <main className="flex flex-col flex-1">
        {/* Message Display Area */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex flex-col space-x-2 group',
                  msg.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    'p-3 rounded-lg max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl break-words',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <p className="text-sm">{msg.content}</p>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                  {msg.status && ` - ${msg.status}`}
                </div>
                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopyMessage(msg.content)}
                    title="Copy message"
                  >
                    <IconCopy size={16} />
                  </Button>
                  {msg.role === 'user' && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleEditMessage(msg)}
                        title="Edit message"
                      >
                        <IconPencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleResendMessage(msg.id)}
                        title="Resend message"
                      >
                        <IconReload size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} /> {/* For scrolling to bottom */}
          </div>
          {!currentChatId && (
            <div className="flex flex-col items-center justify-center h-full">
              <p className="text-muted-foreground">Select a chat to start messaging.</p>
            </div>
          )}
        </ScrollArea>

        {/* Message Input Area */}
        {currentChatId && (
          <div className="border-t p-4 flex items-center space-x-2 bg-background">
            <Input
              type="text"
              placeholder={editingMessage ? "Edit your message..." : "Type your message..."}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              className="flex-1"
            />
            <Button onClick={handleSendMessage} title={editingMessage ? "Save changes" : "Send message"}>
              {editingMessage ? <IconPencil size={18} /> : <IconSend size={18} />}
              <span className="ml-2 hidden sm:inline">{editingMessage ? "Save" : "Send"}</span>
            </Button>
            {editingMessage && (
              <Button variant="ghost" onClick={() => { setEditingMessage(null); setNewMessage(''); }}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default AgentChatView;
