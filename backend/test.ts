import { prisma } from "./db";

const res = await prisma.user.create({
    data: {
        email: "u@u.com",
        provider: "Github",
        name: "Ujjwal Kumar"
    }
})

console.log(res)