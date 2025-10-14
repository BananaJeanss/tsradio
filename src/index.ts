import fs from "fs";
import path from "path";
import express from "express";
import dotenv from "dotenv";
import { parseFile } from "music-metadata";
import { spawn } from "child_process";

dotenv.config();

const app = express();
const srcFolder: string =
  process.env.SRCFOLDER || path.join(process.cwd(), "playlist");
if (!fs.existsSync(srcFolder)) {
  console.error(`Source folder "${srcFolder}" does not exist.`);
  process.exit(1);
}
const files = fs.readdirSync(srcFolder).filter((f) => f.endsWith(".mp3"));
const PORT = process.env.PORT || 3000;
const USESHUFFLE = process.env.USESHUFFLE === "true";
const SHOWINDEXPAGE = process.env.SHOWINDEXPAGE === "true";

let current = 0;
let songInfo = {
  title: "Unknown",
  artist: "Unknown Artist",
  album: "Unknown Album",
  length: 0,
  genre: "Unknown Genre",
};

const listeners = new Set<express.Response>();

if (files.length === 0) {
  console.error("No .mp3 files found in the specified directory.");
  process.exit(1);
}

let LastCurrentShuffle = -1;
let ffmpeg: ReturnType<typeof spawn> | null = null;

async function getSongAndUpdateInfo(filePath: string) {
  try {
    const metadata = await parseFile(filePath);
    songInfo.title = metadata.common.title || "Unknown";
    songInfo.artist = metadata.common.artist || "Unknown Artist";
    songInfo.album = metadata.common.album || "Unknown Album";
    songInfo.genre =
      (metadata.common.genre && metadata.common.genre[0]) || "Unknown Genre";
    songInfo.length = metadata.format.duration || 0;
  } catch (err) {
    console.error(`Error reading metadata for ${filePath}:`, err);
  }
}

async function playNext() {
  const file = files[current];
  if (!file) {
    console.error("No file found at current index");
    return;
  }

  const filePath = path.join(srcFolder, file);
  await getSongAndUpdateInfo(filePath);

  if (ffmpeg) {
    ffmpeg.kill("SIGKILL");
  }

  ffmpeg = spawn("ffmpeg", ["-re", "-i", filePath, "-f", "mp3", "-"]);

  if (ffmpeg.stdout) {
    ffmpeg.stdout.on("data", (chunk) => {
      for (const res of listeners) {
        res.write(chunk);
      }
    });
  }

  ffmpeg.on("exit", () => {
    if (USESHUFFLE) {
      do {
        current = Math.floor(Math.random() * files.length);
      } while (files.length > 1 && current === LastCurrentShuffle);
      LastCurrentShuffle = current;
    } else {
      current = (current + 1) % files.length;
    }

    playNext();
  });
}

app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
  });

  listeners.add(res);

  req.on("close", () => {
    listeners.delete(res);
  });
});

app.get("/metadata", (req, res) => {
  res.json(songInfo);
});

if (SHOWINDEXPAGE) {
  app.use(express.static(path.join(process.cwd(), "public")));
} else {
  app.get("/", (req, res) => {
    res.redirect("/stream");
  });
}

playNext();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
