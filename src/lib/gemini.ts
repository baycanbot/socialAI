import { GoogleGenAI, Type } from "@google/genai";

export function getAIClient() {
  // Use dynamically selected API key if available, otherwise fallback to default
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string);
  return new GoogleGenAI({ apiKey });
}

export interface Concept {
  prompt: string;
  caption: string;
  hashtags: string;
  videoScript: string;
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export async function generateConcepts(posterBase64: string, mimeType: string, description: string, companyInfo: string): Promise<Concept[]> {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: posterBase64.split(',')[1], mimeType } },
          { text: `Analyze this informational poster and its description: "${description}". 
The company's purpose and services are: "${companyInfo}".

Your task is to act as an expert Instagram Creative Director. Create 3 distinct, highly visual, and engaging Instagram post concepts that visually represent the core message of this poster, while aligning with the company's purpose.

For each concept, provide:
1. 'prompt': An image generation prompt in English. Focus on metaphors, striking visuals, lifestyle shots, or abstract representations. ABSOLUTELY NO ENGLISH TEXT allowed in the visuals. If any text is to be included, it MUST be in Turkish and relevant to the message. Otherwise, avoid text entirely for a cleaner look. Explicitly instruct the image generator to leave negative space (empty/uncluttered area) in a specific corner for a logo.
2. 'caption': An engaging Instagram caption in Turkish. It must connect the visual metaphor to the company's services and the poster's original message. Use emojis.
3. 'hashtags': Relevant hashtags in Turkish (e.g., #yapayzeka #tasarim).
4. 'videoScript': A striking, effective, and goal-oriented video script/prompt in English. This script will be used to animate the generated image into a video. ABSOLUTELY NO ENGLISH TEXT should appear in the video. Any text overlays or signs must be in Turkish or absent. Describe dynamic movements, camera pans, or atmospheric changes that enhance the message.
5. 'logoPosition': The corner where you instructed the negative space to be (top-left, top-right, bottom-left, or bottom-right).` }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { 
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING },
            caption: { type: Type.STRING },
            hashtags: { type: Type.STRING },
            videoScript: { type: Type.STRING },
            logoPosition: { type: Type.STRING }
          },
          required: ["prompt", "caption", "hashtags", "videoScript", "logoPosition"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse concepts", e);
    return [];
  }
}

export async function generateImage(prompt: string): Promise<string | null> {
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { text: prompt },
        ],
      },
      config: {
        // @ts-ignore
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed for prompt:", prompt, error);
    return null;
  }
}

export async function generateVideo(prompt: string, imageBase64: string): Promise<string | null> {
  const ai = getAIClient();
  try {
    const mimeType = imageBase64.split(';')[0].split(':')[1] || 'image/png';
    
    // Ensure the prompt is striking and goal-oriented
    const enhancedPrompt = prompt.length < 20 ? `Animate this image with dynamic camera movement, cinematic lighting, and professional motion: ${prompt}` : prompt;

    // @ts-ignore - generateVideos might not be fully typed yet
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: enhancedPrompt,
      image: {
        imageBytes: imageBase64.split(',')[1],
        mimeType: mimeType,
      },
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '9:16' // Instagram Reels/Story format
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      // @ts-ignore
      operation = await ai.operations.getVideosOperation({operation: operation});
    }

    if (operation.error) {
      console.error("Video generation operation error:", operation.error);
      throw new Error((operation.error as any).message || "Video generation failed on server.");
    }
    
    if (operation.metadata?.state === 'FAILED') {
      console.error("Video generation failed. Metadata:", operation.metadata);
      throw new Error((operation.metadata.error as any)?.message || "Video generation failed due to safety or other server error.");
    }

    if ((operation.response as any)?.raiMediaFilteredReasons && (operation.response as any).raiMediaFilteredReasons.length > 0) {
      const reasons = (operation.response as any).raiMediaFilteredReasons.join(" ");
      console.error("Video generation filtered:", reasons);
      throw new Error(`Video generation filtered: ${reasons}`);
    }

    if (operation.response?.generatedVideos && operation.response.generatedVideos.length === 0) {
      console.error("Operation finished but generatedVideos is empty. Operation:", JSON.stringify(operation, null, 2));
      throw new Error("Video generation failed: No videos generated. This might be due to safety filters or an invalid prompt.");
    }

    const videoObj = operation.response?.generatedVideos?.[0]?.video;
    
    if (videoObj?.videoBytes) {
      // If the API returns bytes directly
      const byteString = atob(videoObj.videoBytes);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: videoObj.mimeType || 'video/mp4' });
      return URL.createObjectURL(blob);
    }

    const downloadLink = videoObj?.uri;
    if (!downloadLink) {
      console.error("Operation finished but no video URI or bytes. Operation:", JSON.stringify(operation, null, 2));
      throw new Error(`No video URI returned from the API. Operation: ${JSON.stringify(operation)}`);
    }

    const apiKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string);
    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey as string,
      },
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error("Video fetch failed:", response.status, errText);
      throw new Error(`Video fetch failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Video generation failed:", error);
    throw error;
  }
}
