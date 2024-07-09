import Header from "~/components/header"
import { Link, useLoaderData } from "@remix-run/react"
import { ActionArgs, json } from "@remix-run/node"
import { auth, db } from "~/config.server"
import ValuesCard from "~/components/values-card"

export async function loader({ request }: ActionArgs) {
  if ((await auth.getCurrentUser(request))?.isAdmin !== true) {
    throw new Error("Unauthorized")
  }

  const values = (await db.valuesCard.findMany({
    orderBy: {
      title: "asc",
    },
    select: {
        id: true,
        canonicalCard: {
            select: {
            title: true,
            },
        },
        title: true,
        instructionsShort: true,
        instructionsDetailed: true,
        evaluationCriteria: true,
        createdAt: true,
        updatedAt: true,
    }
  }));

  return json({ values })
}

export default function AdminOriginalCardsScreen() {
  const { values } = useLoaderData<typeof loader>()
  return (
    <div className="flex flex-col w-screen">
      <div className="grid flex-grow place-items-center space-y-8 py-12 mx-3">
        <div className="flex flex-col justify-center items-center">
          <h1 className="text-3xl text-center">
            <b>{values.length}</b> Original Cards
          </h1>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mx-auto gap-4">
          {values.map((value) => (
            <div
            key={value.id}
            className="cursor-pointer hover:opacity-80 active:opacity-70 hover:duration-0 hover:transition-none opacity-100"
            >
            Canonical: {value.canonicalCard?.title}
            <ValuesCard inlineDetails card={value as any} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
