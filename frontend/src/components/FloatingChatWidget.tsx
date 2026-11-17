import { useState, useRef, useEffect } from 'react';
import { useMailboxes, toMailbox } from '../context/MailboxContext';
import { processAgentPrompt, type ChatMessage } from '../services/agentService';
import { CopyButton } from './CopyButton';

export function FloatingChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const { active, addMailbox, setActive } = useMailboxes();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'f_init',
      sender: 'assistant',
      text: "👋 Hi! I'm your M-Ai-L assistant. Ask me to grab the latest OTP, check receive times, or generate an inbox.",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = {
      id: 'u_' + Date.now(),
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await processAgentPrompt(text, {
        activeMailbox: active ? toMailbox(active) : null,
        activeToken: active?.token || null,
        addMailbox: (m, t) => addMailbox(m, t),
        setActiveMailboxId: (id) => setActive(id),
      });
      setMessages((prev) => [...prev, reply]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          sender: 'assistant',
          text: `Error: ${e?.message || e}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {/* Expanded Chat Window */}
      {isOpen && (
        <div className="mb-3 flex h-[480px] w-[350px] sm:w-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#1e1f23]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-[#f6f8fc] px-4 py-3 dark:border-slate-800 dark:bg-[#25262b]">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs dark:bg-blue-900">✨</span>
              <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">Inbox AI Assistant</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'bg-[#0070f3] text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  <div className="whitespace-pre-line">{m.text}</div>

                  {/* Inline OTP / Latency cards */}
                  {m.dataCard?.otp && (
                    <div className="mt-2 rounded bg-white p-2 border border-slate-200 text-slate-900 dark:bg-slate-900 dark:border-slate-700">
                      <div className="text-[9px] uppercase font-bold text-slate-500">OTP Code</div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-lg font-bold text-[#0070f3]">{m.dataCard.otp}</span>
                        <CopyButton text={m.dataCard.otp} label="Copy" />
                      </div>
                    </div>
                  )}

                  {m.dataCard?.latencySeconds !== undefined && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      ⏱️ Latency: <b>{m.dataCard.latencySeconds}s</b>
                    </div>
                  )}
                </div>
                <span className="mt-0.5 text-[9px] text-slate-400">{m.timestamp}</span>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-500" />
                Thinking...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-center gap-1 border-t border-slate-200 p-2 dark:border-slate-800"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or request OTP..."
              className="flex-1 bg-transparent px-2.5 py-1.5 text-xs outline-none dark:text-white"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="rounded-lg bg-[#0070f3] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0070f3] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        title="AI Assistant"
      >
        <span className="text-xl">✨</span>
      </button>
    </div>
  );
}

