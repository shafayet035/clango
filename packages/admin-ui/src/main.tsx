import { mountAdminUi } from "@/lib/mount";

const container = document.getElementById("root");
if (container === null) throw new Error("The admin shell is missing its #root element.");

mountAdminUi(container);
