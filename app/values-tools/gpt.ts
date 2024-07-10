import { openai, chatModel } from "~/config.server"

export async function gpt4(systemPrompt: string, userMessage: string, temperature: number = 0.4) {
  const data = await openai.chat.completions.create({
    model: chatModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: temperature,
    stream: false,
  })
  return data.choices[0].message.content
}
