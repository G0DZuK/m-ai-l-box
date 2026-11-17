import { useState, useRef, useEffect } from 'react';
import { useMailboxes, toMailbox } from '../context/MailboxContext';
import { useUi } from '../context/UiContext';
import { processAgentPrompt, type ChatMessage } from '../services/agentService';
import { CopyButton } from '../components/CopyButton';

const INITIAL_PROMPTS = [
  { label: 'Create new mailbox', prompt: 'Create a new mailbox for testing' },
  { label: 'Check OTP & latency', prompt: 'Check latest email, extract OTP and delivery time' },
  { label: 'Try demo mailbox', prompt: 'Try demo mailbox with sample emails' },
  { label: 'Inspect email headers', prompt: 'What are the technical headers of the latest email?' },
];

export function ClaudeChatView() {
  const { active, addMailbox, setActive } = useMailboxes();
  const ui = useUi();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      sender: 'assistant',
      text: "Hello! I am your **M-Ai-L Box QA Agent**. I can autonomously create mailboxes, securely store access keys, watch for incoming emails, extract OTP codes, and analyze delivery latency for your test suite. What would you like to test?",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (userText: string) => {
    if (!userText.trim() || loading) return;
    const userMsg: ChatMessage = {
      id: 'u_' + Date.now(),
      sender: 'user',
      text: userText,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await processAgentPrompt(
        userText,
        {
          activeMailbox: active ? toMailbox(active) : null,
          activeToken: active?.token || null,
          addMailbox: (m, t) => addMailbox(m, t),
          setActiveMailboxId: (id) => setActive(id),
        },
      );
      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'err_' + Date.now(),
          sender: 'assistant',
          text: `Error processing request: ${err?.message || err}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#f6f8fc] dark:bg-[#1a1b1e]">
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-12 lg:px-24">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              {m.sender === 'assistant' && (
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#0070f3] dark:text-[#38bdf8]">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[10px] dark:bg-blue-900">✨</span>
                  M-Ai-L Agent
                </div>
              )}
              <div
                className={`max-w-[90%] rounded-2xl px-5 py-3.5 text-sm sm:text-base leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-[#0070f3] text-white shadow-sm'
                    : 'bg-white text-slate-800 shadow-sm border border-slate-200/70 dark:border-slate-800 dark:bg-[#25262b] dark:text-slate-100'
                }`}
              >
                <div className="whitespace-pre-line">{m.text}</div>

                {/* Structured Result Cards */}
                {m.dataCard && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#1e1f23]">
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-700/60">
                      <span className="font-semibold text-xs tracking-wider uppercase text-slate-600 dark:text-slate-300">
                        {m.dataCard.title}
                      </span>
                      {m.dataCard.otp && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          OTP Detected
                        </span>
                      )}
                    </div>

                    {/* OTP Big Banner */}
                    {m.dataCard.otp && (
                      <div className="my-3 flex items-center justify-between rounded-lg bg-white p-3 border border-emerald-300/60 dark:bg-slate-900">
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-500">One-Time Password</div>
                          <div className="font-mono text-2xl font-black text-[#0070f3] dark:text-emerald-400 tracking-wider">
                            {m.dataCard.otp}
                          </div>
                        </div>
                        <CopyButton text={m.dataCard.otp} label="Copy OTP" />
                      </div>
                    )}

                    {/* Key-Value Details */}
                    {m.dataCard.details && (
                      <div className="mt-2 space-y-1.5 text-xs">
                        {Object.entries(m.dataCard.details).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-4 py-0.5">
                            <span className="text-slate-500 dark:text-slate-400">{k}:</span>
                            <span className="font-mono font-medium text-slate-900 dark:text-slate-100 text-right truncate">
                              {String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Mailbox action button */}
                    {m.dataCard.mailbox && (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => ui.navigate('inbox')}
                          className="rounded-lg bg-[#0070f3] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-600 transition"
                        >
                          Open Inbox View →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span className="mt-1 px-1 text-[10px] text-slate-400">{m.timestamp}</span>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <span className="h-2 w-2 animate-ping rounded-full bg-[#0070f3]" />
              Agent is executing action...
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input area styled like Claude */}
      <div className="border-t border-slate-200/80 bg-white/70 p-4 backdrop-blur dark:border-slate-800 dark:bg-[#1a1b1e]/90">
        <div className="mx-auto max-w-3xl">
          {/* Quick chip buttons */}
          <div className="mb-3 flex flex-wrap gap-2">
            {INITIAL_PROMPTS.map((item) => (
              <button
                key={item.label}
                onClick={() => handleSend(item.prompt)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-xs hover:border-[#0070f3] hover:text-[#0070f3] dark:border-slate-700 dark:bg-[#25262b] dark:text-slate-300 dark:hover:text-blue-400 transition"
              >
                {item.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 shadow-sm focus-within:border-[#0070f3] focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700 dark:bg-[#25262b] dark:focus-within:ring-blue-900"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask agent: e.g. 'Create mailbox and wait for OTP'..."
              className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400 dark:text-white"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0070f3] text-white transition hover:bg-blue-600 disabled:opacity-40"
            >
              ↑
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

