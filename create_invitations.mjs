import { PrismaClient, Prisma } from "@prisma/client";

async function main() {
    const db = new PrismaClient();
    const user_code = generate_random_code();
    const admin_code = generate_random_code();
    await db.inviteCode.deleteMany({});
    await db.inviteCode.createMany({
        data: [
            {code: user_code, remaining: 50, role: 'USER'},
            {code: admin_code, remaining: 1, role: 'ADMIN'},
        ]
    });
    console.log(`Admin invite link: http://localhost:3000/auth/invite?c=${admin_code}`);
    console.log(`User invite link:  http://localhost:3000/auth/invite?c=${user_code}`);
}

function generate_random_code() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 20; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        code += characters[randomIndex];
    }
    return code;
}

main();
