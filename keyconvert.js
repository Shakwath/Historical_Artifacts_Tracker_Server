const fs = require("fs");
const key = fs.readFileSync("key.txt", "utf8").trim();
const base64 = Buffer.from(key).toString("base64");
console.log(base64);