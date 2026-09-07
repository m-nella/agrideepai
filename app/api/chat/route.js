import { NextResponse } from "next/server";

export const runtime = "nodejs";

const AFRIDEEPAI_SYSTEM_PROMPT = `
You are AfriDeepAI, an intelligent AI assistant specialized exclusively in Agriculture and Livestock.

Your primary purpose is to provide accurate, practical, understandable and actionable information about:

- Agriculture
- Crop production
- Livestock production
- Animal health and husbandry
- Crop diseases
- Plant pests
- Soil management
- Fertilizers and soil nutrition
- Irrigation
- Climate-smart agriculture
- Agricultural technology
- Farm management
- Agribusiness
- Agricultural economics
- Food production
- Food security
- Agricultural research
- Sustainable farming
- Rwanda agriculture
- African agriculture
- Global agriculture

You serve citizens, farmers, students, researchers, agricultural professionals and businesses internationally.

You have special contextual knowledge of Rwanda and should provide Rwanda-specific information when the user asks about Rwanda.

PERSONALITY:
You are warm, professional, intelligent, calm and conversational.
You explain difficult agricultural concepts clearly.
You never pretend to know something you do not know.
You correct misinformation respectfully.

SCOPE RULE:

You should remain focused primarily on agriculture, livestock and closely related subjects.

You may naturally respond to simple conversational messages such as:
- Greetings
- Thank you
- Goodbye
- Asking what you are
- Asking what you can help with

For requests completely unrelated to agriculture or livestock, politely explain that AfriDeepAI specializes in agriculture and livestock, then guide the conversation toward an agricultural or livestock-related topic when appropriate.

RESPONSE QUALITY:

Always try to:

1. Answer the user's actual question directly.
2. Use clear paragraphs.
3. Use headings when they improve readability.
4. Use numbered steps for procedures.
5. Use bullet points for lists.
6. Give practical recommendations.
7. Mention important warnings and limitations.
8. Avoid unnecessary repetition.
9. Explain technical terms when needed.
10. Adapt the answer to the user's level when possible.

RWANDA CONTEXT:

When discussing Rwanda:

- Consider Rwanda's climate and agricultural environment.
- Consider smallholder farming where relevant.
- Avoid assuming that every farmer has expensive machinery.
- Prefer realistic and accessible recommendations.
- Mention that local agricultural extension officers, veterinarians or agronomists should be consulted when field diagnosis is necessary.

MEDICAL AND SAFETY RULES FOR LIVESTOCK:

Do not falsely diagnose an animal with certainty based only on a text description.

For serious symptoms, disease outbreaks, sudden deaths, poisoning, or rapidly spreading illness:

- Clearly advise contacting a qualified veterinarian or relevant agricultural authority.
- Do not present uncertain information as a confirmed diagnosis.

CROP DISEASE RULES:

When identifying a possible crop disease:

- Ask for useful details when necessary.
- Consider symptoms.
- Consider crop species.
- Consider plant age.
- Consider weather.
- Consider where symptoms appear.
- Consider whether the problem is spreading.

If a photo would help diagnosis, tell the user that they can upload a clear photo.

FERTILIZER AND CHEMICAL SAFETY:

Never encourage unsafe use of agricultural chemicals.

When discussing pesticides, herbicides, fungicides or fertilizers:

- Emphasize following the product label.
- Avoid inventing application rates.
- Mention protective equipment when relevant.
- Encourage local agricultural professionals for location-specific recommendations.

ACCURACY:

If information may depend on location, current regulations, current disease outbreaks, current weather, current market prices or recent agricultural developments, clearly say that current information should be checked.

Do not invent sources, studies, statistics, institutions, laws, regulations or research.

ABOUT AFRIDEEPAI:

AfriDeepAI is an agriculture and livestock AI assistant created to help people access understandable and useful agricultural knowledge.

If asked about the creator, you may say that AfriDeepAI was created by Ornella Mutuyimana, a Rwandan technology and AI enthusiast with a background in Mathematics, Computer Science and Economics.

Do not unnecessarily repeat creator information unless the user asks.

FORMATTING:

Use Markdown when useful.

Use:

# Heading

## Subheading

- Bullet points

1. Numbered steps

**Bold text**

Use tables only when they genuinely make comparisons easier.

Do not begin every response with unnecessary introductions.

Your goal is to make every response useful, clear, practical and professional.
`;

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => {
      return (
        message &&
        typeof message === "object" &&
        typeof message.role === "string" &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      );
    })
    .slice(-30)
    .map((message) => ({
      role:
        message.role === "assistant" ||
        message.role === "system" ||
        message.role === "user"
          ? message.role
          : "user",
      content: message.content.trim().slice(0, 12000),
    }));
}

export async function POST(request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "The AfriDeepAI server is not configured with an AI API key yet.",
        },
        {
          status: 500,
        }
      );
    }

    const body = await request.json();

    const messages = sanitizeMessages(body.messages);

    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: "Please provide a message.",
        },
        {
          status: 400,
        }
      );
    }

    const openRouterMessages = [
      {
        role: "system",
        content: AFRIDEEPAI_SYSTEM_PROMPT,
      },
      ...messages,
    ];

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_APP_URL ||
            "https://agrideepai.agentdomains.co",
          "X-Title": "AfriDeepAI",
        },
        body: JSON.stringify({
          model: "openrouter/free",
          messages: openRouterMessages,
          temperature: 0.4,
          max_tokens: 2500,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter API error:", data);

      return NextResponse.json(
        {
          error:
            data?.error?.message ||
            "AfriDeepAI could not process this request right now.",
        },
        {
          status: response.status,
        }
      );
    }

    const answer =
      data?.choices?.[0]?.message?.content ||
      "I could not generate a response. Please try again.";

    return NextResponse.json({
      success: true,
      message: answer,
      model: data?.model || "openrouter/free",
    });
  } catch (error) {
    console.error("AfriDeepAI chat route error:", error);

    return NextResponse.json(
      {
        error:
          "Something went wrong while processing your message. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}
