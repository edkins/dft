import { json, LoaderArgs } from "@remix-run/node"
import { useLoaderData } from "@remix-run/react"
import { ExternalLink } from "~/components/external-link";
import { Button } from "~/components/ui/button"
import { auth, db } from "~/config.server"

export async function loader({request}: LoaderArgs) {
  const current_user = await auth.getCurrentUser(request);
  if (!current_user?.isAdmin) {
    return json({ error: "You are not an admin." }, { status: 401 });
  }
  const users = await db.user.findMany({
    select: {
      name: true,
      isAdmin: true,
      id: true,
    },
  });
  const invites = await db.inviteCode.findMany({
    select: {
      code: true,
      role: true,
      remaining: true,
    }
  })

  return json({ users, invites })
}

export async function action({ request }: LoaderArgs) {
  if (request.method !== 'DELETE') {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const current_user = await auth.getCurrentUser(request);
  if (!current_user?.isAdmin) {
    return json({ error: "You are not an admin." }, { status: 401 });
  }
  const id = parseInt(new URL(request.url).searchParams.get("id") || '');
  await db.user.delete({ where: { id } });
  return json({});
};

export default function AdminUsers() {
  const data = useLoaderData<typeof loader>();
  const removeUser = (id: number) => async () => {
    await fetch(`/admin/users?id=${id}`, { method: 'DELETE' });
    window.location.reload();
  };

  return (
    <div className="grid h-screen place-items-center p-8">
        <h1 className="text-2xl font-bold mb-4 px-4 py-2">Users</h1>
        <table>
          <thead>
            <tr>
              <th>Invite code</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {data.invites.map((invite) =>
              <tr key={invite.code}>
                <td>
                  <ExternalLink href={`http://localhost:3000/auth/invite?c=${invite.code}`}>
                    {invite.role}
                  </ExternalLink>
                </td>
                <td>
                  {invite.remaining}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
                <td><Button onClick={removeUser(user.id)}>
                    Remove
                </Button></td>
            </tr>
          )}
          </tbody>
        </table>
    </div>
  )
}
