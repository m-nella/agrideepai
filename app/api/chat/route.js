import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SYSTEM = `You are AfriDeepAI, a warm, professional and highly capable AI assistant specialized primarily in agriculture and livestock. Help farmers, students, researchers and citizens with crop production, livestock, soil, pests, crop diseases, irrigation, climate-smart agriculture, farm management and agribusiness. Give practical, accurate answers for Rwanda and globally. For Rwanda-specific questions, consider realistic smallholder conditions and local context. Do not falsely diagnose crop or animal disease with certainty; explain uncertainty and recommend an agronomist or veterinarian for serious cases. For chemicals, emphasize following labels and local regulations. You may answer greetings and simple questions naturally. For unrelated requests, politely explain your specialization and redirect where appropriate. Use clean Markdown with headings, bullets and numbered steps when useful. Never invent sources, laws, prices, studies or current facts.`;

export async function POST(req) {
  try {
    const { messages } = await req.json();
    if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "AI server is not configured yet." }, { status: 500 });
    if (!Array.isArray(messages) || !messages.length) return NextResponse.json({ error: "Please send a message." }, { status: 400 });
    const clean = messages.slice(-24).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 12000) })).filter(m => m.content.trim());
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://agrideepai.agentdomains.co", "X-Title": "AfriDeepAI" },
      body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "system", content: SYSTEM }, ...clean], temperature: 0.35, max_tokens: 2200 })
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: data?.error?.message || "The AI service is temporarily unavailable." }, { status: response.status });
    return NextResponse.json({ message: data?.choices?.[0]?.message?.content || "I could not generate a response. Please try again." });
  } catch (e) {
    return NextResponse.json({ error: "Something went wrong while generating the response." }, { status: 500 });
  }
}


export async function DELETE(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Account deletion is not configured yet." }, { status: 400 });
    }
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) return NextResponse.json({ error: "Your session is invalid." }, { status: 401 });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(userData.user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete the account." }, { status: 500 });
  }
}
