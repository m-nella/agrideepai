"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const INITIAL_CONVERSATION = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hello! I'm AfriDeepAI, your agriculture and livestock intelligence assistant. I can help you explore crop production, livestock farming, plant diseases, animal management, soil health, agribusiness, and agriculture in Rwanda and around the world.",
    pinned: false
  }
];

const INITIAL_CHATS = [
  {
    id: "chat-1",
    title: "Welcome to AfriDeepAI",
    messages: INITIAL_CONVERSATION,
    createdAt: new Date().toISOString()
  }
];

function Icon({ name, size = 20, stroke = 1.8 }) {
  const icons = {
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    close: (
      <>
        <path d="M6 6l12 12M18 6L6 18" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    send: (
      <>
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </>
    ),
    stop: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v5M14 11v5" />
      </>
    ),
    pin: (
      <>
        <path d="M12 17v5" />
        <path d="M8 3h8l-1 5 3 3v2H6v-2l3-3-1-5z" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4-4" />
      </>
    ),
    attach: (
      <>
        <path d="M21.4 11.6l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.2-8.2" />
      </>
    ),
    regenerate: (
      <>
        <path d="M20 11a8 8 0 1 0 2 5" />
        <path d="M20 4v7h-7" />
      </>
    ),
    share: (
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
      </>
    ),
    check: (
      <>
        <path d="M5 12l4 4L19 6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c.8-4 3.5-6 8-6s7.2 2 8 6" />
      </>
    ),
    arrowDown: (
      <>
        <path d="M6 9l6 6 6-6" />
      </>
    )
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);

  const [chats, setChats] = useState(INITIAL_CHATS);
  const [activeChatId, setActiveChatId] = useState("chat-1");

  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState("");

  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId),
    [chats, activeChatId]
  );

  const messages = activeChat?.messages || [];

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        180
      )}px`;
    }
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: isGenerating ? "auto" : "smooth"
    });
  }, [messages.length, isGenerating]);

  function updateActiveChat(updateFunction) {
    setChats((currentChats) =>
      currentChats.map((chat) => {
        if (chat.id !== activeChatId) return chat;
        return updateFunction(chat);
      })
    );
  }

  function createNewChat() {
    const id = `chat-${Date.now()}`;

    const newChat = {
      id,
      title: "New conversation",
      messages: [],
      createdAt: new Date().toISOString()
    };

    setChats((current) => [newChat, ...current]);
    setActiveChatId(id);
    setInput("");
    setMobileSidebarOpen(false);
  }

  function generateChatTitle(text) {
    const clean = text.replace(/\s+/g, " ").trim();

    if (!clean) return "New conversation";

    if (clean.length <= 48) return clean;

    return `${clean.slice(0, 48).trim()}…`;
  }

  async function sendMessage() {
    const message = input.trim();

    if (!message || isGenerating) return;

    const userMessage = {
      id: `message-${Date.now()}`,
      role: "user",
      content: message,
      pinned: false
    };

    updateActiveChat((chat) => ({
      ...chat,
      title:
        chat.title === "New conversation"
          ? generateChatTitle(message)
          : chat.title,
      messages: [...chat.messages, userMessage]
    }));

    setInput("");
    setIsGenerating(true);

    window.setTimeout(() => {
      const assistantMessage = {
        id: `message-${Date.now() + 1}`,
        role: "assistant",
        content: `AfriDeepAI is ready for its real AI intelligence connection. You asked: "${message}"\n\nThe next development phases will connect this interface to the specialized agriculture and livestock intelligence system, conversation memory, current web information, uploaded files, and persistent accounts.`,
        pinned: false
      };

      updateActiveChat((chat) => ({
        ...chat,
        messages: [...chat.messages, assistantMessage]
      }));

      setIsGenerating(false);
    }, 650);
  }

  function stopGenerating() {
    setIsGenerating(false);
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (isGenerating) {
        stopGenerating();
      } else {
        sendMessage();
      }
    }
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);

      window.setTimeout(() => {
        setCopiedId(null);
      }, 1800);
    } catch {
      setCopiedId(null);
    }
  }

  function toggleMessagePin(messageId) {
    updateActiveChat((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.id === messageId
          ? { ...message, pinned: !message.pinned }
          : message
      )
    }));
  }

  function deleteMessage(messageId) {
    updateActiveChat((chat) => ({
      ...chat,
      messages: chat.messages.filter(
        (message) => message.id !== messageId
      )
    }));
  }

  function startEditing(message) {
    setEditingId(message.id);
    setEditingValue(message.content);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingValue("");
  }

  function saveEdit() {
    if (!editingId || !editingValue.trim()) return;

    updateActiveChat((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.id === editingId
          ? {
              ...message,
              content: editingValue.trim(),
              edited: true
            }
          : message
      )
    }));

    cancelEditing();
  }

  function scrollToMessage(messageId) {
    const element = document.getElementById(messageId);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }

    setNavigatorOpen(false);
  }

  return (
    <main className="app-shell">
      <div
        className={`mobile-backdrop ${
          mobileSidebarOpen ? "visible" : ""
        }`}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <aside
        className={`sidebar ${
          sidebarOpen ? "" : "collapsed"
        } ${mobileSidebarOpen ? "mobile-open" : ""}`}
      >
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-logo">
              <img src="/logo.png" alt="AfriDeepAI logo" />
            </div>

            <span className="brand-name">AfriDeepAI</span>
          </div>

          <button
            className="icon-button sidebar-collapse"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            <Icon name={sidebarOpen ? "close" : "menu"} />
          </button>
        </div>

        <div className="sidebar-new-chat">
          <button className="new-chat-button" onClick={createNewChat}>
            <Icon name="plus" size={19} />
            <span>New chat</span>
          </button>
        </div>

        <div className="chat-list">
          <div className="chat-list-heading">Chats</div>

          {chats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-item ${
                chat.id === activeChatId ? "active" : ""
              }`}
              onClick={() => {
                setActiveChatId(chat.id);
                setMobileSidebarOpen(false);
              }}
              title={chat.title}
            >
              <span className="chat-item-title">{chat.title}</span>

              <span className="chat-item-more">
                <Icon name="more" size={17} />
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-account">
          <button className="account-button">
            <div className="account-avatar">
              <Icon name="user" size={19} />
            </div>

            <div className="account-text">
              <strong>Guest</strong>
              <span>Log in or create account</span>
            </div>

            <Icon name="more" size={18} />
          </button>
        </div>
      </aside>

      <section className="chat-shell">
        <header className="chat-header">
          <div className="chat-header-left">
            <button
              className="icon-button mobile-menu-button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Icon name="menu" />
            </button>

            <div className="chat-title-area">
              <h1>{activeChat?.title || "AfriDeepAI"}</h1>
              <span>AfriDeepAI Agriculture Intelligence</span>
            </div>
          </div>

          <div className="chat-header-actions">
            <button
              className="icon-button"
              onClick={() => setNavigatorOpen((value) => !value)}
              title="Message navigator"
              aria-label="Open message navigator"
            >
              <Icon name="search" size={19} />
            </button>

            <button
              className="icon-button"
              onClick={createNewChat}
              title="New chat"
              aria-label="New chat"
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
        </header>

        <div className="conversation-layout">
          <div className="conversation-column">
            <div className="messages-area">
              {messages.length === 0 ? (
                <section className="empty-chat">
                  <div className="empty-logo">
                    <img src="/logo.png" alt="" />
                  </div>

                  <h2>How can AfriDeepAI help you?</h2>

                  <p>
                    Ask about crops, livestock, farming, soil, agricultural
                    diseases, agribusiness, Rwanda, or global agriculture.
                  </p>

                  <div className="suggestion-grid">
                    <button
                      onClick={() =>
                        setInput(
                          "What are the best practices for growing maize in Rwanda?"
                        )
                      }
                    >
                      <span>Crop production</span>
                      <strong>Growing maize in Rwanda</strong>
                    </button>

                    <button
                      onClick={() =>
                        setInput(
                          "How can I improve dairy cow feeding and milk production?"
                        )
                      }
                    >
                      <span>Livestock</span>
                      <strong>Improve dairy production</strong>
                    </button>

                    <button
                      onClick={() =>
                        setInput(
                          "How can I identify common tomato plant diseases?"
                        )
                      }
                    >
                      <span>Plant health</span>
                      <strong>Identify tomato diseases</strong>
                    </button>

                    <button
                      onClick={() =>
                        setInput(
                          "Give me ideas for starting a small agricultural business."
                        )
                      }
                    >
                      <span>Agribusiness</span>
                      <strong>Start an agricultural business</strong>
                    </button>
                  </div>
                </section>
              ) : (
                <div className="messages-list">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      id={message.id}
                      className={`message-row ${message.role}`}
                    >
                      {message.role === "assistant" && (
                        <div className="assistant-avatar">
                          <img src="/logo.png" alt="AfriDeepAI" />
                        </div>
                      )}

                      <div className="message-content-wrap">
                        {message.role === "assistant" && (
                          <div className="message-author">
                            AfriDeepAI
                            {message.pinned && (
                              <span className="pinned-indicator">
                                <Icon name="pin" size={14} />
                                Pinned
                              </span>
                            )}
                          </div>
                        )}

                        {editingId === message.id ? (
                          <div className="message-editor">
                            <textarea
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              autoFocus
                            />

                            <div className="message-editor-actions">
                              <button
                                className="secondary-action"
                                onClick={cancelEditing}
                              >
                                Cancel
                              </button>

                              <button
                                className="primary-action"
                                onClick={saveEdit}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="message-content">
                              {message.content
                                .split("\n")
                                .map((line, index) => (
                                  <p key={index}>{line || "\u00A0"}</p>
                                ))}
                            </div>

                            {message.edited && (
                              <span className="edited-label">Edited</span>
                            )}

                            <div className="message-actions">
                              <button
                                onClick={() => copyMessage(message)}
                                title="Copy message"
                                aria-label="Copy message"
                              >
                                {copiedId === message.id ? (
                                  <Icon name="check" size={17} />
                                ) : (
                                  <Icon name="copy" size={17} />
                                )}
                              </button>

                              {message.role === "user" && (
                                <button
                                  onClick={() => startEditing(message)}
                                  title="Edit message"
                                  aria-label="Edit message"
                                >
                                  <Icon name="edit" size={17} />
                                </button>
                              )}

                              <button
                                onClick={() =>
                                  toggleMessagePin(message.id)
                                }
                                title={
                                  message.pinned
                                    ? "Unpin message"
                                    : "Pin message"
                                }
                                aria-label="Pin message"
                                className={
                                  message.pinned ? "active-action" : ""
                                }
                              >
                                <Icon name="pin" size={17} />
                              </button>

                              {message.role === "assistant" && (
                                <>
                                  <button
                                    title="Regenerate response"
                                    aria-label="Regenerate response"
                                  >
                                    <Icon
                                      name="regenerate"
                                      size={17}
                                    />
                                  </button>

                                  <button
                                    title="Share response"
                                    aria-label="Share response"
                                  >
                                    <Icon name="share" size={17} />
                                  </button>
                                </>
                              )}

                              <button
                                onClick={() =>
                                  deleteMessage(message.id)
                                }
                                title="Delete message"
                                aria-label="Delete message"
                                className="danger-action"
                              >
                                <Icon name="trash" size={17} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </article>
                  ))}

                  {isGenerating && (
                    <article className="message-row assistant generating">
                      <div className="assistant-avatar">
                        <img src="/logo.png" alt="AfriDeepAI" />
                      </div>

                      <div className="thinking-indicator">
                        <span />
                        <span />
                        <span />
                      </div>
                    </article>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="composer-zone">
              <div className="composer">
                <button
                  className="composer-icon"
                  title="Attach a file"
                  aria-label="Attach a file"
                >
                  <Icon name="attach" size={20} />
                </button>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask AfriDeepAI about agriculture and livestock..."
                  rows={1}
                />

                <button
                  className={`send-button ${
                    isGenerating ? "stop" : ""
                  }`}
                  onClick={
                    isGenerating ? stopGenerating : sendMessage
                  }
                  disabled={!isGenerating && !input.trim()}
                  aria-label={
                    isGenerating ? "Stop generating" : "Send message"
                  }
                  title={
                    isGenerating ? "Stop generating" : "Send message"
                  }
                >
                  <Icon
                    name={isGenerating ? "stop" : "send"}
                    size={20}
                  />
                </button>
              </div>

              <p className="composer-note">
                AfriDeepAI specializes in agriculture and livestock.
                Important decisions should be verified with qualified local
                professionals where necessary.
              </p>
            </div>
          </div>

          <aside
            className={`message-navigator ${
              navigatorOpen ? "open" : ""
            }`}
          >
            <div className="navigator-header">
              <div>
                <strong>Message navigator</strong>
                <span>{messages.length} messages</span>
              </div>

              <button
                className="icon-button"
                onClick={() => setNavigatorOpen(false)}
                aria-label="Close message navigator"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="navigator-list">
              {messages.length === 0 ? (
                <div className="navigator-empty">
                  Messages in this conversation will appear here.
                </div>
              ) : (
                messages.map((message, index) => (
                  <button
                    key={message.id}
                    className={`navigator-message ${message.role}`}
                    onClick={() =>
                      scrollToMessage(message.id)
                    }
                  >
                    <span className="navigator-number">
                      {index + 1}
                    </span>

                    <span className="navigator-preview">
                      {message.content}
                    </span>

                    <span className="navigator-marker" />
                  </button>
                ))
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
