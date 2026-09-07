"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const WELCOME = { id: "welcome", role: "assistant", content: "Hello! I'm AfriDeepAI. I can help with crops, livestock, soil, pests, plant diseases, animal management, agribusiness, and agriculture in Rwanda and around the world.", created_at: new Date().toISOString(), pinned: false };
const GUEST_KEY = "afrideepai_guest_chats_v2";
const guestId = () => `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const short = (text, n = 54) => text.length > n ? `${text.slice(0, n).trim()}…` : text;

const supabase = typeof window !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  : null;

function Icon({ name, size = 19 }) {
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>, close: <path d="M6 6l12 12M18 6L6 18"/>, plus: <path d="M12 5v14M5 12h14"/>, send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, stop: <rect x="7" y="7" width="10" height="10" rx="2"/>, copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>, edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-4 1 1-4Z"/></>, trash: <><path d="M4 7h16M10 11v5M14 11v5M9 7V4h6v3M6 7l1 13h10l1-13"/></>, pin: <><path d="M12 17v5"/><path d="M8 3h8l-1 5 3 3v2H6v-2l3-3Z"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.2-6 8-6s6.5 2 8 6"/></>, logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 4h7v16h-7"/></>, search: <><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></>, nav: <><path d="M5 5h14M5 12h14M5 19h10"/></>, share: <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></>, attach: <path d="m20.5 11.5-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>, refresh: <><path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/></>, arrow: <path d="m9 18 6-6-6-6"/>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [sidebar, setSidebar] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [controller, setController] = useState(null);
  const [activeMessage, setActiveMessage] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [query, setQuery] = useState("");
  const [session, setSession] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [authMessage, setAuthMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", newEmail: "", newPassword: "" });
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const activeChat = useMemo(() => chats.find(c => c.id === activeId), [chats, activeId]);
  const messages = activeChat?.messages || [];
  const visibleChats = useMemo(() => chats.filter(c => c.title.toLowerCase().includes(query.toLowerCase())), [chats, query]);
  const signedIn = !!session?.user;

  useEffect(() => { boot(); }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages.length, generating]);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 50); return () => clearTimeout(t); }, [activeId]);

  async function boot() {
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      supabase.auth.onAuthStateChange((_event, next) => setSession(next));
      if (data.session) return loadCloud(data.session.user.id);
    }
    loadGuest();
  }

  function loadGuest() {
    try {
      const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
      const list = saved.length ? saved : [{ id: guestId(), title: "Welcome to AfriDeepAI", pinned: false, created_at: new Date().toISOString(), messages: [WELCOME] }];
      setChats(list); setActiveId(list[0].id);
    } catch { setChats([{ id: guestId(), title: "Welcome to AfriDeepAI", pinned: false, created_at: new Date().toISOString(), messages: [WELCOME] }]); }
  }

  async function loadCloud(userId = session?.user?.id) {
    if (!supabase || !userId) return loadGuest();
    const { data: cloudChats } = await supabase.from("chats").select("*").eq("user_id", userId).order("pinned", { ascending: false }).order("updated_at", { ascending: false });
    const ids = (cloudChats || []).map(c => c.id);
    let cloudMessages = [];
    if (ids.length) ({ data: cloudMessages } = await supabase.from("messages").select("*").in("chat_id", ids).order("created_at", { ascending: true }));
    const list = (cloudChats || []).map(c => ({ ...c, messages: (cloudMessages || []).filter(m => m.chat_id === c.id) }));
    if (!list.length) {
      const { data: created } = await supabase.from("chats").insert({ user_id: userId, title: "Welcome to AfriDeepAI" }).select().single();
      if (created) list.push({ ...created, messages: [WELCOME] });
    }
    setChats(list); setActiveId(list[0]?.id || null);
  }

  function saveGuest(next) { setChats(next); localStorage.setItem(GUEST_KEY, JSON.stringify(next)); }
  function titleFrom(text) { const clean = text.replace(/\s+/g, " ").trim(); return short(clean || "New conversation", 46); }

  async function newChat() {
    if (signedIn && supabase) {
      const { data, error } = await supabase.from("chats").insert({ user_id: session.user.id, title: "New conversation" }).select().single();
      if (!error && data) { setChats(x => [{ ...data, messages: [] }, ...x]); setActiveId(data.id); }
      return;
    }
    const c = { id: guestId(), title: "New conversation", pinned: false, created_at: new Date().toISOString(), messages: [] };
    saveGuest([c, ...chats]); setActiveId(c.id);
  }

  async function persistMessage(chatId, message) {
    if (!signedIn || !supabase) return message;
    const { data } = await supabase.from("messages").insert({ chat_id: chatId, user_id: session.user.id, role: message.role, content: message.content, pinned: !!message.pinned }).select().single();
    return data || message;
  }

  async function persistChat(chatId, patch) {
    if (signedIn && supabase) await supabase.from("chats").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", chatId);
  }

  function patchChat(chatId, fn) {
    setChats(prev => { const next = prev.map(c => c.id === chatId ? fn(c) : c); if (!signedIn) localStorage.setItem(GUEST_KEY, JSON.stringify(next)); return next; });
  }

  async function sendMessage(override) {
    const text = (override ?? input).trim();
    if (!text || generating || !activeChat) return;
    const chatId = activeChat.id;
    let userMessage = { id: guestId(), role: "user", content: text, pinned: false, created_at: new Date().toISOString() };
    if (!signedIn) { patchChat(chatId, c => ({ ...c, title: c.title === "New conversation" ? titleFrom(text) : c.title, messages: [...c.messages, userMessage] })); }
    else {
      userMessage = await persistMessage(chatId, userMessage);
      const title = activeChat.title === "New conversation" ? titleFrom(text) : activeChat.title;
      patchChat(chatId, c => ({ ...c, title, messages: [...c.messages, userMessage] }));
      if (title !== activeChat.title) await persistChat(chatId, { title });
    }
    setInput(""); setGenerating(true);
    const ac = new AbortController(); setController(ac);
    try {
      const history = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }), signal: ac.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to generate a response.");
      let ai = { id: guestId(), role: "assistant", content: data.message, pinned: false, created_at: new Date().toISOString() };
      ai = await persistMessage(chatId, ai);
      patchChat(chatId, c => ({ ...c, messages: [...c.messages, ai] }));
      await persistChat(chatId, {});
    } catch (e) {
      if (e.name !== "AbortError") patchChat(chatId, c => ({ ...c, messages: [...c.messages, { id: guestId(), role: "assistant", content: `**AfriDeepAI could not complete that response.**\n\n${e.message}`, error: true, created_at: new Date().toISOString() }] }));
    } finally { setGenerating(false); setController(null); }
  }

  function stop() { controller?.abort(); setGenerating(false); setController(null); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); } catch {} }
  async function togglePin(message) { patchChat(activeId, c => ({ ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, pinned: !m.pinned } : m) })); if (signedIn && supabase && message.id && !message.id.startsWith("guest-")) await supabase.from("messages").update({ pinned: !message.pinned }).eq("id", message.id); }
  async function deleteMessage(message) { patchChat(activeId, c => ({ ...c, messages: c.messages.filter(m => m.id !== message.id) })); if (signedIn && supabase && !message.id.startsWith("guest-")) await supabase.from("messages").delete().eq("id", message.id); }
  async function saveEdit() { if (!editing || !editValue.trim()) return; const value = editValue.trim(); patchChat(activeId, c => ({ ...c, messages: c.messages.map(m => m.id === editing.id ? { ...m, content: value, edited: true } : m) })); if (signedIn && supabase && !editing.id.startsWith("guest-")) await supabase.from("messages").update({ content: value }).eq("id", editing.id); setEditing(null); setEditValue(""); }
  async function regenerate(message) { const before = messages.filter(m => m.created_at <= message.created_at && m.id !== message.id); await deleteMessage(message); const lastUser = [...before].reverse().find(m => m.role === "user"); if (lastUser) await sendMessage(lastUser.content); }
  async function renameChat(chat) { const title = prompt("Conversation name", chat.title); if (!title?.trim()) return; patchChat(chat.id, c => ({ ...c, title: title.trim() })); await persistChat(chat.id, { title: title.trim() }); }
  async function deleteChat(chat) { if (!confirm(`Delete “${chat.title}”?`)) return; if (signedIn && supabase) await supabase.from("chats").delete().eq("id", chat.id); const next = chats.filter(c => c.id !== chat.id); if (!signedIn) saveGuest(next); else setChats(next); if (activeId === chat.id) setActiveId(next[0]?.id || null); if (!next.length) newChat(); }
  async function toggleChatPin(chat) { const pinned = !chat.pinned; patchChat(chat.id, c => ({ ...c, pinned })); await persistChat(chat.id, { pinned }); setChats(prev => [...prev].sort((a,b) => Number(b.pinned)-Number(a.pinned))); }
  function shareChat() { const text = messages.map(m => `${m.role === "user" ? "You" : "AfriDeepAI"}:\n${m.content}`).join("\n\n"); copy(text); alert("Conversation copied. You can now paste it anywhere."); }

  async function authSubmit(e) {
    e.preventDefault(); if (!supabase) return setAuthMessage("Supabase environment variables are not configured yet.");
    setBusy(true); setAuthMessage("");
    try {
      if (authMode === "signup") { const { error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { name: form.name }, emailRedirectTo: `${location.origin}` } }); if (error) throw error; setAuthMessage("Account created. Check your email and verify your address before signing in."); }
      if (authMode === "signin") { const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password }); if (error) throw error; setSession(data.session); setAccountOpen(false); await loadCloud(data.user.id); }
      if (authMode === "reset") { const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: location.origin }); if (error) throw error; setAuthMessage("Password reset instructions were sent to your email."); }
      if (authMode === "email") { const { error } = await supabase.auth.updateUser({ email: form.newEmail }); if (error) throw error; setAuthMessage("A confirmation email was sent to your new address."); }
      if (authMode === "password") { const { error } = await supabase.auth.updateUser({ password: form.newPassword }); if (error) throw error; setAuthMessage("Password updated successfully."); }
    } catch (err) { setAuthMessage(err.message || "Something went wrong."); } finally { setBusy(false); }
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); setSession(null); setAccountOpen(false); loadGuest(); }
  async function deleteAccount() {
    if (!confirm("This permanently deletes your account and all cloud chats. Continue?")) return;
    if (!session?.access_token) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to delete the account.");
      await supabase?.auth.signOut(); setSession(null); setAccountOpen(false); loadGuest();
    } catch (e) { setAuthMessage(e.message || "Unable to delete the account."); } finally { setBusy(false); }
  }

  return <main className="app-shell">
    <aside className={`sidebar ${sidebar ? "" : "collapsed"}`}>
      <div className="brand"><img src="/logo.png" alt="AfriDeepAI"/><strong>AfriDeep<span>AI</span></strong><button className="icon-btn" onClick={() => setSidebar(false)}><Icon name="menu"/></button></div>
      <button className="new-chat" onClick={newChat}><Icon name="plus"/> New chat</button>
      <div className="chat-search"><Icon name="search" size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats"/></div>
      <div className="chat-list">{visibleChats.map(chat => <div key={chat.id} className={`chat-row ${chat.id === activeId ? "active" : ""}`}><button className="chat-select" onClick={() => setActiveId(chat.id)}>{chat.pinned && <span>📌</span>}{chat.title}</button><div className="chat-actions"><button onClick={() => renameChat(chat)}><Icon name="edit" size={15}/></button><button onClick={() => toggleChatPin(chat)}><Icon name="pin" size={15}/></button><button onClick={() => deleteChat(chat)}><Icon name="trash" size={15}/></button></div></div>)}</div>
      <button className="account" onClick={() => { setAuthMode(signedIn ? "account" : "signin"); setAuthMessage(""); setAccountOpen(true); }}><div className="avatar">{signedIn ? (session.user.email?.[0] || "U").toUpperCase() : <Icon name="user"/>}</div><div><strong>{signedIn ? session.user.user_metadata?.name || "Account" : "Guest"}</strong><span>{signedIn ? short(session.user.email || "", 28) : "Log in or create account"}</span></div></button>
    </aside>

    <section className="workspace">
      <header className="topbar"><button className="icon-btn show-sidebar" onClick={() => setSidebar(true)}><Icon name="menu"/></button><div><strong>{activeChat?.title || "AfriDeepAI"}</strong><span> Agriculture & livestock intelligence</span></div><div className="top-actions"><button className="icon-btn" onClick={() => setNavOpen(!navOpen)} title="Message navigator"><Icon name="nav"/></button><button className="icon-btn" onClick={shareChat} title="Share conversation"><Icon name="share"/></button></div></header>
      <div className="conversation" ref={scrollRef} onScroll={e => { const els = [...e.currentTarget.querySelectorAll("[data-message]")]; let best = null, distance = Infinity; els.forEach(el => { const d = Math.abs(el.getBoundingClientRect().top - e.currentTarget.getBoundingClientRect().top - 90); if (d < distance) { distance = d; best = el.dataset.message; } }); if (best) setActiveMessage(best); }}>
        <div className="conversation-inner">{!messages.length && <div className="empty"><img src="/logo.png" alt=""/><h1>How can I help with agriculture today?</h1><p>Ask about crops, livestock, soil, pests, diseases, farming or agribusiness.</p></div>}
        {messages.map(message => <article key={message.id} data-message={message.id} className={`message ${message.role}`}><div className="message-head"><span>{message.role === "user" ? "You" : "AfriDeepAI"}</span>{message.pinned && <span className="pinned">Pinned</span>}</div>{editing?.id === message.id ? <div className="edit-box"><textarea value={editValue} onChange={e => setEditValue(e.target.value)}/><div><button onClick={saveEdit}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></div></div> : <div className="message-content">{message.content.split("\n").map((line,i) => <p key={i}>{line || " "}</p>)}</div>}<div className="message-tools"><button onClick={() => copy(message.content)} title="Copy"><Icon name="copy" size={16}/></button><button onClick={() => togglePin(message)} title="Pin"><Icon name="pin" size={16}/></button>{message.role === "user" && <button onClick={() => { setEditing(message); setEditValue(message.content); }} title="Edit"><Icon name="edit" size={16}/></button>}{message.role === "assistant" && <button onClick={() => regenerate(message)} title="Regenerate"><Icon name="refresh" size={16}/></button>}<button onClick={() => deleteMessage(message)} title="Delete"><Icon name="trash" size={16}/></button></div></article>)}{generating && <div className="thinking"><span></span><span></span><span></span> AfriDeepAI is thinking…</div>}</div>
      </div>
      <div className="composer-wrap"><div className="composer"><textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generating ? stop() : sendMessage(); } }} placeholder="Ask AfriDeepAI about agriculture and livestock…" rows={1}/><button className="send" onClick={() => generating ? stop() : sendMessage()} title={generating ? "Stop" : "Send"}>{generating ? <Icon name="stop"/> : <Icon name="send"/>}</button></div><p>AfriDeepAI can make mistakes. Verify critical agricultural and veterinary decisions.</p></div>
    </section>

    <aside className={`navigator ${navOpen ? "open" : ""}`}><div className="navigator-head"><strong>Message navigator</strong><button className="icon-btn" onClick={() => setNavOpen(false)}><Icon name="close"/></button></div><div className="navigator-list">{messages.map((m,i) => <button key={m.id} className={activeMessage === m.id ? "active" : ""} onClick={() => { document.querySelector(`[data-message="${m.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActiveMessage(m.id); }}><span>{i+1}</span><em>{m.role === "user" ? "You" : "AI"}</em><strong>{short(m.content, 60)}</strong><i></i></button>)}</div></aside>

    {accountOpen && <div className="modal-backdrop" onMouseDown={() => setAccountOpen(false)}><section className="modal" onMouseDown={e => e.stopPropagation()}><button className="modal-close" onClick={() => setAccountOpen(false)}><Icon name="close"/></button>{authMode === "account" ? <><img src="/logo.png" alt="AfriDeepAI"/><h2>Your account</h2><p>{session?.user?.email}</p><button className="wide" onClick={() => setAuthMode("email")}>Change email</button><button className="wide" onClick={() => setAuthMode("password")}>Change password</button><button className="wide danger" onClick={deleteAccount}>Delete account</button><button className="wide" onClick={signOut}>Sign out</button></> : <><img src="/logo.png" alt="AfriDeepAI"/><h2>{authMode === "signup" ? "Create account" : authMode === "reset" ? "Reset password" : authMode === "email" ? "Change email" : authMode === "password" ? "Change password" : "Welcome back"}</h2><form onSubmit={authSubmit}>{authMode === "signup" && <input placeholder="Your name" value={form.name} onChange={e => setForm({...form,name:e.target.value})} required/>}{["signin","signup","reset"].includes(authMode) && <input type="email" placeholder="Email address" value={form.email} onChange={e => setForm({...form,email:e.target.value})} required/>}{["signin","signup"].includes(authMode) && <input type="password" placeholder="Password" value={form.password} onChange={e => setForm({...form,password:e.target.value})} required minLength="6"/>}{authMode === "email" && <input type="email" placeholder="New email address" value={form.newEmail} onChange={e => setForm({...form,newEmail:e.target.value})} required/>}{authMode === "password" && <input type="password" placeholder="New password" value={form.newPassword} onChange={e => setForm({...form,newPassword:e.target.value})} required minLength="6"/>}<button className="wide primary" disabled={busy}>{busy ? "Please wait…" : "Continue"}</button></form>{authMessage && <p className="auth-message">{authMessage}</p>}{authMode === "signin" && <div className="auth-links"><button onClick={() => setAuthMode("signup")}>Create account</button><button onClick={() => setAuthMode("reset")}>Forgot password?</button></div>}{authMode === "signup" && <div className="auth-links"><button onClick={() => setAuthMode("signin")}>Already have an account? Sign in</button></div>}</>}</section></div>}
  </main>;
}
