import { ActionArgs, json } from "@remix-run/node"
import { Message } from "ai";
import { auth, db } from "~/config.server"

export async function action({params, request}: ActionArgs) {
  const user = await auth.getCurrentUser(request);
  if (!user || !user.isAdmin) {
    throw new Error('Unauthorized')
  }

  let { chatId } = params;
  if (!chatId) {
    throw new Error("No chat id")
  }
  const chat = await db.chat.findUnique({ where: { id: chatId } })

  if (!chat) {
    throw new Error(`No chat with id ${chatId}`)
  }

  const messages = chat.transcript as any as Message[]
  const newMessages = messages.slice(0, -1)

  console.log(`Trimmed messages from chat ${chatId}.`)

  await db.chat.update({
    where: { id: chatId },
    data: { transcript: newMessages as any },
  })

  return json({ message: "Trimmed message in db" })
}