import { json } from "@remix-run/node"
import { NavLink, Outlet, useLoaderData } from "@remix-run/react"
import { Button } from "~/components/ui/button"
import { db } from "~/config.server"

export async function loader() {
  const users = await db.user.findMany({
    select: {
      name: true,
      isAdmin: true,
      id: true,
    },
  })

  return json({ users })
}

async function removeUser(id:number) {
  await fetch(`/api/removeuser?id=${id}`, {
    method: 'POST',
  });
}

export default function AdminUsers() {
  const data = useLoaderData<typeof loader>();

  return (
    <div className="grid h-screen place-items-center p-8">
        <h1 className="text-2xl font-bold mb-4 px-4 py-2">Users</h1>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Admin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
          {data.users.map((user) =>
            <tr key={user.id}>
                <td>{user.name}</td>
                <td>{`${user.isAdmin}`}</td>
                <td><Button onClick={() => removeUser(user.id)}>
                    Remove
                </Button></td>
            </tr>
          )}
          </tbody>
        </table>
    </div>
  )
}
