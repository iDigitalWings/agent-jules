import { createFileRoute } from '@tanstack/react-router';
import { AgentChatView } from '@/features/agent-chat';

export const Route = createFileRoute('/_authenticated/agent-chat/')({
  component: AgentChatPage,
});

function AgentChatPage() {
  return <AgentChatView />;
}
