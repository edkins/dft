import { openai, chatModel } from "~/config.server"

export async function gpt4(systemPrompt: string, userMessage: string, temperature: number = 0.4) {
  const result = await openai.createChatCompletion({
    model: chatModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: temperature,
    stream: false,
  })
  const data = await result.json()
  return data.choices[0].message.content
}
