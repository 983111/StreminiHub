export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight (OPTIONS request)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Change to your frontend domain in production
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 2. Only allow POST requests for the actual proxy
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { 
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      // 3. Extract messages from the frontend request
      const requestData = await request.json();
      
      // We force the specific model and default to streaming based on your cURL
      const payload = {
        model: "MBZUAI-IFM/K2-Think-v2",
        messages: requestData.messages || [{ role: "user", content: "hi there" }],
        stream: requestData.stream !== undefined ? requestData.stream : true
      };

      // 4. Send the request to the K2 API
      const k2Response = await fetch("https://api.k2think.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.K2_API_KEY}` // Injected via Cloudflare Secrets
        },
        body: JSON.stringify(payload)
      });

      // 5. Pipe the response directly back to the client
      // We grab the existing headers from K2's response and add CORS headers
      const responseHeaders = new Headers(k2Response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");

      // Return the raw response body. Since it's a stream, Cloudflare Workers 
      // will stream it automatically back to your client.
      return new Response(k2Response.body, {
        status: k2Response.status,
        headers: responseHeaders
      });

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