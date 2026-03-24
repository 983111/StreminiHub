export default {
  async fetch(request, env, ctx) {
    const stripReasoningFromText = (value = "") =>
      value
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/```thinking[\s\S]*?```/gi, "")
        .replace(/```reasoning[\s\S]*?```/gi, "")
        .trim();

    const sanitizeChoice = (choice) => {
      if (!choice || typeof choice !== "object") return choice;
      const nextChoice = { ...choice };

      if (nextChoice.message && typeof nextChoice.message === "object") {
        nextChoice.message = { ...nextChoice.message };
        if (typeof nextChoice.message.content === "string") {
          nextChoice.message.content = stripReasoningFromText(nextChoice.message.content);
        }
      }

      if (nextChoice.delta && typeof nextChoice.delta === "object") {
        nextChoice.delta = { ...nextChoice.delta };
        if (typeof nextChoice.delta.content === "string") {
          nextChoice.delta.content = stripReasoningFromText(nextChoice.delta.content);
        }
      }

      delete nextChoice.reasoning;
      delete nextChoice.reasoning_content;
      delete nextChoice.thinking;
      delete nextChoice.thinking_content;
      return nextChoice;
    };

    const sanitizeCompletionJson = (data) => {
      if (!data || typeof data !== "object") return data;
      const sanitized = { ...data };

      if (Array.isArray(sanitized.choices)) {
        sanitized.choices = sanitized.choices.map((choice) => sanitizeChoice(choice));
      }

      delete sanitized.reasoning;
      delete sanitized.reasoning_content;
      delete sanitized.thinking;
      delete sanitized.thinking_content;
      return sanitized;
    };

    const sanitizeSSEStream = (sourceStream) => {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";

      return new ReadableStream({
        start(controller) {
          const reader = sourceStream.getReader();

          const pump = () =>
            reader.read().then(({ done, value }) => {
              if (done) {
                if (buffer.length > 0) {
                  controller.enqueue(encoder.encode(buffer));
                }
                controller.close();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const events = buffer.split("\n\n");
              buffer = events.pop() || "";

              for (const event of events) {
                const lines = event.split("\n");
                const processedLines = lines.map((line) => {
                  if (!line.startsWith("data:")) return line;
                  const jsonPayload = line.slice(5).trim();
                  if (!jsonPayload || jsonPayload === "[DONE]") return line;

                  try {
                    const parsed = JSON.parse(jsonPayload);
                    const sanitized = sanitizeCompletionJson(parsed);
                    return `data: ${JSON.stringify(sanitized)}`;
                  } catch {
                    return line;
                  }
                });

                controller.enqueue(encoder.encode(`${processedLines.join("\n")}\n\n`));
              }

              return pump();
            });

          pump().catch((error) => controller.error(error));
        },
      });
    };

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      const requestData = await request.json();

      const payload = {
        model: "MBZUAI-IFM/K2-Think-v2",
        messages: requestData.messages || [{ role: "user", content: "hi there" }],
        temperature: 0.8,
        // Use max_tokens from the request, default 4000, cap at 8000
        max_tokens: Math.min(requestData.max_tokens || 4000, 8000),
        stream: requestData.stream !== undefined ? requestData.stream : true
      };

      const k2Response = await fetch("https://api.k2think.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.K2_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      const responseHeaders = new Headers(k2Response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");

      const contentType = k2Response.headers.get("content-type") || "";
      const isStreaming = payload.stream === true || contentType.includes("text/event-stream");

      if (!k2Response.body) {
        return new Response(null, {
          status: k2Response.status,
          headers: responseHeaders
        });
      }

      if (isStreaming) {
        return new Response(sanitizeSSEStream(k2Response.body), {
          status: k2Response.status,
          headers: responseHeaders
        });
      }

      const rawText = await k2Response.text();
      try {
        const parsed = JSON.parse(rawText);
        const sanitized = sanitizeCompletionJson(parsed);
        return new Response(JSON.stringify(sanitized), {
          status: k2Response.status,
          headers: responseHeaders
        });
      } catch {
        return new Response(rawText, {
          status: k2Response.status,
          headers: responseHeaders
        });
      }

    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  },
};
