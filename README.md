# tsradio
A very very basic radio/audio stream server

## Description

I made this since I could not get icecast2 to properly work on the server I was using, so I made this.
It includes basic features such as an audio stream (of course), order/shuffle toggle via .env, metadata path, and an album cover path.

## Requirements

- `ffmpeg`
- That's it

## Quick Start

1. Clone the repo `git clone https://github.com/BananaJeanss/tsradio.git`
2. Install dependencies `npm i`
3. Build the project `npm run build`
4. Make a folder named playlist in the project root, and drop your mp3 files in there
5. Copy .env.example and make any changes if needed
6. `npm run start`
7. Profit

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.