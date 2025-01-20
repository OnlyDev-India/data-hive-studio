import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const oldPath = path.join(__dirname, "..", "build", "preload.js");
const newPath = path.join(__dirname, "..", "build", "preload.mjs");

console.log(oldPath, newPath);

fs.access(oldPath, fs.constants.F_OK, (err) => {
  if (err) {
    console.error("preload.js does not exist.");
    return;
  }

  fs.access(newPath, fs.constants.F_OK, (err) => {
    if (!err) {
      fs.unlink(newPath, (err) => {
        if (err) {
          console.error("Error removing existing preload.mjs:", err);
          return;
        }
        renameFile();
      });
    } else {
      renameFile();
    }
  });
});

function renameFile() {
  fs.rename(oldPath, newPath, (err) => {
    if (err) {
      console.error("Error renaming file:", err);
    } else {
      console.log("File renamed successfully to preload.mjs");
    }
  });
}
