import { mountAdminUi } from "./lib/mount";
import "./styles/globals.css";

const container = document.getElementById("root");
if (container === null) throw new Error("The admin shell is missing its #root element.");

mountAdminUi(container);
