"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Send, Trash2 } from "lucide-react";

type ChatLanguage = "en" | "bn";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
};

const quickQuestions = [
  "আমার বাকি কত?",
  "আজকের বিক্রি কত?",
  "কম স্টক কোনগুলো?",
  "সবচেয়ে বেশি বাকি কার?",
  "This week's best seller?",
];

const timeFormatter = new Intl.DateTimeFormat("en-BD", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function TypingDots() {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
    </div>
  );
}

export default function AssistantPage() {
  const [language, setLanguage] = useState<ChatLanguage>("bn");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  const placeholder = useMemo(
    () =>
      language === "bn"
        ? "ব্যবসার প্রশ্ন লিখুন..."
        : "Ask a business question...",
    [language]
  );

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const userMessage: Message = {
      id: createId(),
      role: "user",
      text: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, language }),
      });

      const json = (await response.json()) as { reply?: string; error?: string };

      if (!response.ok || !json.reply) {
        const errText =
          json.error ||
          (language === "bn"
            ? "দুঃখিত, উত্তর আনতে সমস্যা হয়েছে।"
            : "Sorry, I couldn't fetch a response right now.");

        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: "assistant",
            text: errText,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const reply = json.reply ?? "";
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          text: reply,
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          text:
            language === "bn"
              ? "নেটওয়ার্ক সমস্যা হয়েছে। আবার চেষ্টা করুন।"
              : "Network error. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              language === "en" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage("bn")}
            className={`rounded-md px-3 py-1.5 font-medium transition ${
              language === "bn" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            বাংলা
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMessages([])}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear Chat
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
            {language === "bn"
              ? "SmartShodhai Assistant-কে যেকোনো ব্যবসায়িক প্রশ্ন করুন।"
              : "Ask SmartShodhai Assistant any business question."}
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] md:max-w-[70%] ${isUser ? "" : "flex items-start gap-2"}`}>
                  {!isUser && (
                    <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-sm">
                      🤖
                    </div>
                  )}
                  <div>
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        isUser
                          ? "bg-indigo-600 text-white"
                          : "border border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      {message.text}
                    </div>
                    <p className={`mt-1 text-[11px] text-slate-500 ${isUser ? "text-right" : "text-left"}`}>
                      {timeFormatter.format(message.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex justify-start">
            <div className="flex max-w-[70%] items-start gap-2">
              <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-sm">
                🤖
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-700">
                <TypingDots />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {quickQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => void sendMessage(question)}
              disabled={isSending}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-50"
            aria-label="Microphone (coming soon)"
            title="Microphone (coming soon)"
          >
            <Mic className="h-4 w-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="h-10 flex-1 rounded-full border border-slate-300 px-4 text-sm outline-none ring-indigo-200 focus:border-indigo-500 focus:ring-2"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="inline-flex h-10 items-center gap-1 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
