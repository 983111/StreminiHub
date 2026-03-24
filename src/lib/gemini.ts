const FALLBACK_API_ENDPOINT = 'https://research-hub.vishwajeetadkine705.workers.dev';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function generateAcademicContent(prompt: string, maxTokens = 4000) {
  const endpoint = import.meta.env.VITE_AI_ENDPOINT || FALLBACK_API_ENDPOINT;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream: false,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const rawContent = data.choices?.[0]?.message?.content?.trim() || '';
    return rawContent
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```thinking[\s\S]*?```/gi, '')
      .replace(/```reasoning[\s\S]*?```/gi, '')
      .trim();
  } catch (error) {
    console.error('AI API Error:', error);
    return '% Error generating content. Please check endpoint availability and CORS settings.';
  }
}
