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
  StreamedMessageChunk, // Import the new type
} from '@/features/agent-chat/services/chat-service';
import { IconCopy, IconPencil, IconSend, IconReload, IconLoader2 } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid'; // For temporary IDs

const AgentChatView: React.FC = () => {
  const [chatSessions, setChatSessions] = useState<AgentChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [editingMessage, setEditingMessage] = useState<AgentMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false); // New state for global streaming lock
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchSessions = async () => {
      const sessions = await getChatSessions();
      setChatSessions(sessions.sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()));
      if (sessions.length > 0 && !currentChatId) {
        setCurrentChatId(sessions[0].id);
      }
    };
    fetchSessions();
  }, []);

  useEffect(() => {
    if (currentChatId) {
      const fetchMessages = async () => {
        const fetchedMessages = await getMessages(currentChatId);
        setMessages(fetchedMessages);
        scrollToBottom();
      };
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [currentChatId]);

  useEffect(scrollToBottom, [messages]);

  const handleSelectChat = (sessionId: string) => {
    if (isStreaming) return; // Don't switch chats while streaming
    setCurrentChatId(sessionId);
    setEditingMessage(null);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !currentChatId || isStreaming || editingMessage) {
        // For now, if editing, use the old method. Streaming is for new messages.
        if (editingMessage && currentChatId) {
            const updatedMessage = await editMessage(editingMessage.id, newMessage);
            if (updatedMessage) {
                setMessages(prev => prev.map(msg => msg.id === updatedMessage.id ? updatedMessage : msg));
            }
            setNewMessage('');
            setEditingMessage(null);
        }
        return;
    }

    setIsStreaming(true);

    const tempUserMessageId = `temp-user-${nanoid()}`;
    const optimisticUserMessage: AgentMessage = {
      id: tempUserMessageId,
      chatId: currentChatId,
      role: 'user',
      content: newMessage,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    setMessages(prev => [...prev, optimisticUserMessage]);
    const messageToSend = newMessage;
    setNewMessage('');
    // scrollToBottom(); // Will be called by useEffect on messages change

    try {
      const confirmedUserMessage = await sendMessage(
        currentChatId,
        messageToSend,
        // onStreamUpdate
        (chunk: StreamedMessageChunk) => {
          setMessages(prevMessages => {
            const existingAgentMessageIndex = prevMessages.findIndex(
              msg => msg.id === chunk.messageId && msg.role === 'agent'
            );
            if (chunk.type === 'text_chunk') {
              if (existingAgentMessageIndex !== -1) {
                return prevMessages.map((msg, index) =>
                  index === existingAgentMessageIndex
                    ? { ...msg, content: msg.content + (chunk.content || ''), timestamp: new Date().toISOString() } // Update timestamp for sorting
                    : msg
                );
              } else if (chunk.messageId && currentChatId) { // Ensure currentChatId is available
                return [
                  ...prevMessages,
                  {
                    id: chunk.messageId,
                    chatId: currentChatId, // Use currentChatId from outer scope
                    role: 'agent',
                    content: chunk.content || '',
                    timestamp: new Date().toISOString(),
                    status: 'streaming',
                  },
                ];
              }
            }
            // TODO: Handle other chunk types like 'form_definition' or 'error_chunk'
            return prevMessages;
          });
          // scrollToBottom(); // useEffect on messages change handles this
        },
        // onStreamEnd
        (finalAgentMessageContent: string, agentMessageId: string) => {
          setMessages(prevMessages =>
            prevMessages.map(msg =>
              msg.id === agentMessageId && msg.role === 'agent'
                ? { ...msg, content: finalAgentMessageContent, status: 'delivered', timestamp: new Date().toISOString() }
                : msg
            )
          );
          if (currentChatId) { // Ensure currentChatId is available
            setChatSessions(prevSessions => 
                prevSessions.map(session => 
                    session.id === currentChatId 
                    ? { ...session, lastMessageAt: new Date().toISOString(), lastMessageSnippet: `Agent: ${finalAgentMessageContent.substring(0,30)}...` } 
                    : session
                ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
            );
          }
          setIsStreaming(false);
          // scrollToBottom(); // useEffect on messages change handles this
        },
        // onStreamError
        (error: Error) => {
          console.error("Streaming error:", error);
          setMessages(prev => prev.map(msg => 
            msg.id === tempUserMessageId 
            ? {...msg, status: 'error', content: `${msg.content}\n(Error sending: ${error.message})`} 
            // Potentially find and mark the streaming agent message as error too
            : msg 
          ));
          setIsStreaming(false);
        }
      );

      // Update user message with confirmed ID and status
      setMessages(prev => prev.map(msg => 
        msg.id === tempUserMessageId 
        ? {...confirmedUserMessage, status: 'delivered' } // Use all fields from confirmedUserMessage
        : msg
      ));
       // Update session for the user message as well
      if (currentChatId) {
        setChatSessions(prevSessions => 
            prevSessions.map(session => 
                session.id === currentChatId 
                ? { ...session, lastMessageAt: confirmedUserMessage.timestamp, lastMessageSnippet: `User: ${confirmedUserMessage.content.substring(0,30)}...` } 
                : session
            ).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        );
      }


    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages(prev => prev.map(msg => 
        msg.id === tempUserMessageId 
        ? {...msg, status: 'error', content: `${msg.content}\n(Failed to send)`} 
        : msg
      ));
      setIsStreaming(false);
    }
  };

  const handleEditMessage = (message: AgentMessage) => {
    if (isStreaming) return;
    if (message.role === 'user') {
      setEditingMessage(message);
      setNewMessage(message.content);
    }
  };

  const handleResendMessage = async (messageId: string) => {
    if (isStreaming || !currentChatId) return; // Do not allow resend if streaming or no chat selected
    
    // For simplicity, resend will use the non-streaming agent response for now.
    // If resend also needs to stream, this would need to be updated.
    setIsStreaming(true); // Temporarily set streaming to true to disable input
    const agentResponse = await resendMessage(messageId);
    if (agentResponse) {
      setMessages((prevMessages) => [...prevMessages, agentResponse]);
      setChatSessions(prevSessions => 
        prevSessions.map(session => 
          session.id === currentChatId 
          ? { ...session, lastMessageAt: agentResponse.timestamp, lastMessageSnippet: agentResponse.content.substring(0,50) } 
          : session
        ).sort((a,b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      );
    }
    setIsStreaming(false);
  };


  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(
      () => console.log('Message copied'),
      (err) => console.error('Failed to copy: ', err),
    );
  };

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] w-full">
      <aside className="w-1/4 border-r p-4 flex flex-col space-y-2 bg-muted/20">
        <h2 className="text-lg font-semibold mb-2 text-foreground">Chat History</h2>
        <ScrollArea className="flex-1">
          {chatSessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'p-2 rounded-md cursor-pointer hover:bg-muted',
                currentChatId === session.id && 'bg-primary text-primary-foreground hover:bg-primary/90',
                isStreaming && currentChatId !== session.id && 'opacity-50 cursor-not-allowed' 
              )}
              onClick={() => handleSelectChat(session.id)}
            >
              <div className="font-medium">{session.title}</div>
              <div className="text-xs text-muted-foreground truncate">
                {session.lastMessageSnippet || 'No messages yet'}
              </div>
              <div className="text-xs text-muted-foreground/80">
                {new Date(session.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </ScrollArea>
      </aside>

      <main className="flex flex-col flex-1">
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex flex-col group',
                  msg.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    'p-3 rounded-lg max-w-xs md:max-w-md lg:max-w-lg xl:max-w-xl break-words relative',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                    msg.status === 'pending' && 'opacity-70',
                    msg.status === 'error' && 'bg-destructive text-destructive-foreground',
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.role === 'agent' && msg.status === 'streaming' && (
                     <IconLoader2 className="animate-spin h-4 w-4 absolute bottom-1 right-1 text-xs" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {msg.status && msg.status !== 'streaming' && ` - ${msg.status}`}
                  {msg.status === 'pending' && ' (sending...)'}
                </div>
                { msg.status !== 'streaming' && msg.status !== 'pending' && (
                    <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopyMessage(msg.content)} title="Copy message">
                        <IconCopy size={16} />
                    </Button>
                    {msg.role === 'user' && msg.status !== 'error' && (
                        <>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditMessage(msg)} title="Edit message" disabled={isStreaming}>
                            <IconPencil size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleResendMessage(msg.id)} title="Resend message" disabled={isStreaming}>
                            <IconReload size={16} />
                        </Button>
                        </>
                    )}
                    </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {!currentChatId && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full">
              <p className="text-muted-foreground">Select a chat to start messaging.</p>
            </div>
          )}
        </ScrollArea>

        {currentChatId && (
          <div className="border-t p-4 flex items-center space-x-2 bg-background">
            <Input
              type="text"
              placeholder={
                isStreaming 
                ? "Agent is responding..." 
                : editingMessage 
                ? "Edit your message..." 
                : "Type your message..."
              }
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && !isStreaming && handleSendMessage()}
              className="flex-1"
              disabled={isStreaming || !!editingMessage} // Disable if streaming or if editing (use save/cancel for edit)
            />
             {editingMessage ? (
              <>
                <Button onClick={handleSendMessage} title="Save changes" disabled={isStreaming}>
                  <IconPencil size={18} /> <span className="ml-2 hidden sm:inline">Save</span>
                </Button>
                <Button variant="ghost" onClick={() => { setEditingMessage(null); setNewMessage(''); }} disabled={isStreaming}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={handleSendMessage} title="Send message" disabled={isStreaming || !newMessage.trim()}>
                {isStreaming ? <IconLoader2 className="animate-spin h-4 w-4" /> : <IconSend size={18} />}
                <span className="ml-2 hidden sm:inline">{isStreaming ? "Sending..." : "Send"}</span>
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default AgentChatView;
