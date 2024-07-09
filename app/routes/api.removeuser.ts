import { json, LoaderArgs } from "@remix-run/node";
import { useCurrentUser } from "~/root";
import { auth, db } from "~/config.server";

export async function action({ request }: LoaderArgs) {
    const user = await auth.getCurrentUser(request);
    if (user === null || !user.isAdmin) {
        throw new Error("Not authorized");
    }
    const id = parseInt(new URL(request.url).searchParams.get("id") || '');
    await db.user.delete({ where: { id } });
    return json({});
};
