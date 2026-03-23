const FALLBACK_API_ENDPOINT = 'https://research-hub.vishwajeetadkine705.workers.dev';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function generateAcademicContent(prompt: string) {
  const endpoint = import.meta.env.VITE_AI_ENDPOINT || FALLBACK_API_ENDPOINT;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (error) {
    console.error('AI API Error:', error);
    return '% Error generating content. Please check endpoint availability and CORS settings.';
  }
}
