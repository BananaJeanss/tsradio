import fs from "fs";
import path from "path";
import express from "express";
import dotenv from "dotenv";
import { parseFile } from "music-metadata";
import { spawn } from "child_process";
import cors from "cors";

dotenv.config();

const PORT = process.env.PORT || 3000;
const USESHUFFLE = process.env.USESHUFFLE === "true";
const SHOWINDEXPAGE = process.env.SHOWINDEXPAGE === "true";

const app = express();
const srcFolder: string =
  process.env.SRCFOLDER || path.join(process.cwd(), "playlist");
if (!fs.existsSync(srcFolder)) {
  console.error(`Source folder "${srcFolder}" does not exist.`);
  process.exit(1);
}

const files = [] as string[];
let folderCount = 1;

function scanDirectory(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
      folderCount++;
    } else if (
      entry.isFile() &&
      path.extname(entry.name).toLowerCase() === ".mp3"
    ) {
      files.push(path.relative(srcFolder, fullPath));
    }
  }
}

scanDirectory(srcFolder);
console.log(
  `Found ${files.length} .mp3 files in ${folderCount} folders in playlist folder`
);

let current = 0;
let songInfo = {
  title: "Unknown",
  artist: "Unknown Artist",
  album: "Unknown Album",
  length: 0,
  genre: "Unknown Genre",
};

// because otherwise doesn't work in some environments
app.use(
  cors({
    origin: "*",
  })
);

const listeners = new Set<express.Response>();

if (files.length === 0) {
  console.error("No .mp3 files found in the specified directory.");
  process.exit(1);
}

let LastCurrentShuffle = -1;
let ffmpeg: ReturnType<typeof spawn> | null = null;

if (USESHUFFLE && files.length > 0) {
  current = Math.floor(Math.random() * files.length);
  LastCurrentShuffle = current;
}

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

  ffmpeg = spawn("ffmpeg", ["-re", "-i", filePath, "-vn", "-f", "mp3", "-"]);

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

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

let canUsePlaceholderImage = true;
let placeholderImage: Buffer;
try {
  placeholderImage = fs.readFileSync(path.join(process.cwd(), "src", "public", "placeholder.jpg"));
} catch (err) {
  console.warn("Placeholder image not found");
  canUsePlaceholderImage = false;
}

app.get("/albumcover", (req, res) => {
  const file = files[current];
  if (!file) {
    res.status(404).send("No file currently playing");
    return;
  }
  const filePath = path.join(srcFolder, file);

  parseFile(filePath)
    .then((metadata) => {
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const picture = metadata.common.picture[0];
        if (!picture || !picture.data) {
          if (!canUsePlaceholderImage) {
            res.status(404).send("No album art available");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "image/jpg",
            "Content-Length": placeholderImage.length,
          });
          res.end(placeholderImage);
          return;
        }
        res.writeHead(200, {
          "Content-Type": picture.format,
          "Content-Length": picture.data.length,
        });
        res.end(picture.data);
      } else {
        if (!canUsePlaceholderImage) {
          res.status(404).send("No album art available");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "image/jpg",
          "Content-Length": placeholderImage.length,
        });
        res.end(placeholderImage);
      }
    })
    .catch((err) => {
      console.error(`Error reading metadata for ${filePath}:`, err);
      res.status(500).send("Error retrieving album art");
    });
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
